const { normalizeText } = require('./normalize');

const STOP_WORDS = new Set([
  'the','with','for','and','inch','ips','fhd','hd','led','lcd','hz',
  'new','latest','original','genuine','rgb','gaming','official','warranty',
  'price','offer','best','edition','version','black','white'
]);

function tokenize(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function extractSearchKey(name = '') {
  const tokens = tokenize(name);
  const priority = tokens.filter(t => /\d/.test(t) || /^[a-z]+\d/i.test(t));
  return [...new Set([...priority, ...tokens])].slice(0, 10).join(' ');
}

function similarity(a = '', b = '') {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;

  let intersection = 0;
  for (const token of A) {
    if (B.has(token)) intersection++;
  }

  const union = new Set([...A, ...B]).size;
  const jaccard = union ? intersection / union : 0;
  const containment = intersection / Math.min(A.size, B.size);

  return jaccard * 0.45 + containment * 0.55;
}

function sameOrCompatible(a, b, field) {
  if (!a[field] || !b[field]) return true;
  const x = normalizeText(a[field]);
  const y = normalizeText(b[field]);
  return x === y || x.includes(y) || y.includes(x);
}

function variantCompatible(a, b) {
  // If both stores expose a model/brand/variant attribute, a conflict means
  // they are not the same offer group.
  if (a.brand && b.brand && normalizeText(a.brand) !== normalizeText(b.brand)) return false;

  if (a.model && b.model && !sameOrCompatible(a, b, 'model')) return false;
  if (a.storage && b.storage && normalizeText(a.storage) !== normalizeText(b.storage)) return false;
  if (a.ram && b.ram && normalizeText(a.ram) !== normalizeText(b.ram)) return false;
  if (a.screenSize && b.screenSize && normalizeText(a.screenSize) !== normalizeText(b.screenSize)) return false;

  return true;
}

function matchScore(a, b) {
  if (!variantCompatible(a, b)) return 0;

  let score = similarity(a.name, b.name) * 0.60;
  const fields = [
    ['brand', 0.10],
    ['model', 0.20],
    ['storage', 0.04],
    ['ram', 0.04],
    ['screenSize', 0.02]
  ];

  for (const [field, weight] of fields) {
    if (!a[field] || !b[field]) continue;
    const x = normalizeText(a[field]);
    const y = normalizeText(b[field]);

    if (x === y) score += weight;
    else if (x.includes(y) || y.includes(x)) score += weight * 0.35;
  }

  return Math.min(1, score);
}

function groupProducts(products = [], threshold = 0.78) {
  const groups = [];

  for (const product of products) {
    let target = null;
    let bestScore = 0;

    for (const group of groups) {
      const score = matchScore(product, group.anchor);
      if (score > bestScore) {
        bestScore = score;
        target = group;
      }
    }

    if (target && bestScore >= threshold) {
      target.products.push(product);
      target.score = Math.max(target.score, bestScore);
    } else {
      groups.push({
        key: extractSearchKey(product.name),
        anchor: product,
        products: [product],
        score: 1
      });
    }
  }

  return groups.map(group => {
    const available = group.products.filter(p => p.inStock && p.price != null);
    const prices = available.map(p => p.price);
    const lowestPrice = prices.length ? Math.min(...prices) : null;
    const highestPrice = prices.length ? Math.max(...prices) : null;
    const bestOffer = available.find(p => p.price === lowestPrice) || group.products[0];

    return {
      key: group.key,
      title: group.anchor.name,
      products: group.products,
      offerCount: group.products.length,
      lowestPrice,
      highestPrice,
      savings: lowestPrice != null && highestPrice != null
        ? Math.max(0, highestPrice - lowestPrice)
        : 0,
      bestOffer,
      matchScore: Number(group.score.toFixed(3))
    };
  });
}

module.exports = {
  extractSearchKey,
  similarity,
  matchScore,
  groupProducts
};
