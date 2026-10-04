const { normalizeText } = require('./normalize');

const VARIANT_CONFLICT_PATTERNS = [
  /\b(x\s+superlight|superlight\s+x)\b/i,
  /\b(superlight|ultralight)\b/i,
  /\bmini\b/i,
  /\bmax\b/i,
  /\bultra\b/i,
  /\bplus\b/i,
  /\bpro\b/i
];

const STOP_WORDS = new Set([
  'the','and','with','for','from','new','original','official','wireless','wired',
  'gaming','mouse','keyboard','headphone','headset','monitor','laptop','phone',
  'smartphone','mobile','black','white','blue','red','green','pink','orange',
  'gb','tb','ram','storage','inch','in'
]);

function tokens(value = '') {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean);
}

function modelTokens(value = '') {
  return tokens(value).filter(token =>
    /^(?=.*\d)[a-z0-9.]+$/i.test(token) &&
    token.length >= 2
  );
}

function significantTokens(value = '') {
  return tokens(value).filter(token => !STOP_WORDS.has(token));
}

function getBrand(product = {}, name = '') {
  const explicit = normalizeText(product.brand || '');
  if (explicit) return explicit;

  const parts = tokens(name);
  if (!parts.length) return '';

  // Conservative fallback: the first alphabetic word is usually the brand.
  // Do not infer a brand from a numeric/model token.
  if (/^[a-z]+$/i.test(parts[0]) && parts[0].length >= 2) return parts[0];
  return '';
}

function getModels(product = {}, name = '') {
  const explicit = normalizeText(product.model || '');
  const explicitModels = modelTokens(explicit);
  if (explicitModels.length) return explicitModels;

  return modelTokens(name);
}

function getAttributes(product = {}) {
  return {
    storage: normalizeText(product.storage || ''),
    ram: normalizeText(product.ram || ''),
    screenSize: normalizeText(product.screenSize || ''),
    color: normalizeText(product.color || '')
  };
}

function queryProfile(query = '') {
  const normalized = normalizeText(query);
  return {
    normalized,
    tokens: tokens(normalized),
    significant: significantTokens(normalized),
    models: modelTokens(normalized),
    variants: VARIANT_CONFLICT_PATTERNS.filter(pattern => pattern.test(normalized)).map(String)
  };
}

function productProfile(product = {}) {
  const name = normalizeText(product.name || '');
  return {
    normalizedName: name,
    brand: getBrand(product, name),
    models: getModels(product, name),
    attrs: getAttributes(product),
    tokens: tokens(name),
    significant: significantTokens(name)
  };
}

function hasVariantConflict(query, product) {
  const q = query.normalized;
  const p = product.normalizedName;

  // Explicit query variants must be present in the product.
  for (const pattern of VARIANT_CONFLICT_PATTERNS) {
    if (pattern.test(q) && !pattern.test(p)) return true;
  }

  // A model-only query must not absorb clearly different premium/variant lines.
  if (query.models.length === 1 && !query.normalized.includes('superlight')) {
    if (/\b(g304|g305)\b/i.test(q) && /\b(x\s+superlight|superlight)\b/i.test(p)) return true;
  }

  return false;
}

function attributesCompatible(query, product) {
  const pairs = [
    ['storage', 'storage'],
    ['ram', 'ram'],
    ['screenSize', 'screenSize']
  ];

  for (const [qKey, pKey] of pairs) {
    const qMatch = query.normalized.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*' + (qKey === 'screenSize' ? '(?:inch|in)' : qKey), 'i'));
    if (qMatch && product.attrs[pKey] && normalizeText(product.attrs[pKey]) !== normalizeText(qMatch[1] + (qKey === 'screenSize' ? 'inch' : qKey === 'storage' ? 'gb' : 'gb'))) {
      // Do not reject when the scraper did not normalize units consistently.
      const pDigits = String(product.attrs[pKey]).match(/\d+(?:\.\d+)?/);
      if (!pDigits || pDigits[0] !== qMatch[1]) return false;
    }
  }

  return true;
}

function exactMatch(query, product) {
  const profile = productProfile(product);

  if (profile.normalizedName === query.normalized) {
    return { matched: true, reason: 'Exact normalized product name' };
  }

  if (hasVariantConflict(query, profile)) {
    return { matched: false, reason: 'Variant conflict' };
  }

  if (!attributesCompatible(query, profile)) {
    return { matched: false, reason: 'Variant/specification mismatch' };
  }

  if (query.models.length) {
    const hasAllModels = query.models.every(model => profile.models.includes(model));
    if (!hasAllModels) return { matched: false, reason: 'Model mismatch' };

    const queryBrand = query.tokens[0] && /^[a-z]+$/i.test(query.tokens[0]) ? query.tokens[0] : '';
    if (queryBrand && profile.brand && queryBrand !== profile.brand) {
      return { matched: false, reason: 'Brand mismatch' };
    }

    return {
      matched: true,
      reason: queryBrand ? 'Brand + model match' : 'Model/MPN match'
    };
  }

  const qSignificant = query.significant;
  const overlap = qSignificant.filter(token => profile.significant.includes(token));
  if (qSignificant.length && overlap.length === qSignificant.length) {
    return { matched: true, reason: 'Normalized name token match' };
  }

  return { matched: false, reason: 'No exact identity match' };
}

function similarMatch(query, product) {
  const profile = productProfile(product);

  if (exactMatch(query, product).matched) return { matched: false };

  if (hasVariantConflict(query, profile)) return { matched: false };

  const queryModels = query.models;
  const sharedModels = queryModels.filter(model => profile.models.includes(model));

  // Same model family with an explicit variant is similar, not exact.
  if (sharedModels.length) {
    return { matched: true, reason: 'Same model family / different variant' };
  }

  const familyMatch = queryModels.some(queryModel => profile.models.some(productModel => {
    const q = queryModel.match(/^([a-z]+)(\\d+)$/i);
    const p = productModel.match(/^([a-z]+)(\\d+)$/i);
    return q && p && q[1] === p[1] && Math.abs(Number(q[2]) - Number(p[2])) <= 2;
  }));
  if (familyMatch) return { matched: true, reason: 'Related model family' };

  const queryBrand = query.tokens[0] && /^[a-z]+$/i.test(query.tokens[0]) ? query.tokens[0] : '';
  const sameBrand = queryBrand && profile.brand && queryBrand === profile.brand;

  if (sameBrand) {
    const qSignificant = new Set(query.significant);
    const shared = profile.significant.filter(token => qSignificant.has(token));
    if (shared.length >= 1) {
      return { matched: true, reason: 'Same brand with related model' };
    }
  }

  return { matched: false };
}

function sortProducts(products) {
  return [...products].sort((a, b) =>
    Number(b._score || 0) - Number(a._score || 0) ||
    Number(a.price || Infinity) - Number(b.price || Infinity)
  );
}

function classifyProducts(products, query) {
  const profile = queryProfile(query);
  const exact = [];
  const similar = [];

  for (const product of products) {
    const exactResult = exactMatch(profile, product);

    if (exactResult.matched) {
      exact.push({
        ...product,
        matchType: 'exact',
        matchReason: exactResult.reason
      });
      continue;
    }

    const similarResult = similarMatch(profile, product);
    if (similarResult.matched) {
      similar.push({
        ...product,
        matchType: 'similar',
        matchReason: similarResult.reason
      });
    }
  }

  return {
    exactProducts: sortProducts(exact),
    similarProducts: sortProducts(similar)
  };
}

function matchProducts(products, query) {
  const { exactProducts, similarProducts } = classifyProducts(products, query);

  return {
    products: [...exactProducts, ...similarProducts],
    exactProducts,
    similarProducts,
    exactProductCount: exactProducts.length,
    similarProductCount: similarProducts.length,
    matchStats: {
      total: products.length,
      exact: exactProducts.length,
      similar: similarProducts.length,
      unmatched: Math.max(0, products.length - exactProducts.length - similarProducts.length)
    }
  };
}

module.exports = {
  queryProfile,
  productProfile,
  exactMatch,
  similarMatch,
  matchProducts
};
