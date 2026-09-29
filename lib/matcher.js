const { normalizeText } = require('./normalize');

const STOP_WORDS = new Set(['the','with','for','and','inch','ips','fhd','hd','led','lcd','hz','new','latest','original','genuine','rgb','gaming','chair','mouse','keyboard','monitor','official','warranty','price','offer','best']);

function tokenize(value = '') {
  return normalizeText(value).split(' ').filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function extractSearchKey(name = '') {
  const tokens = tokenize(name);
  const priority = tokens.filter(t => /\d/.test(t) || /^[a-z]+\d/i.test(t));
  return [...new Set([...priority, ...tokens])].slice(0, 8).join(' ');
}

function similarity(a = '', b = '') {
  const A = new Set(tokenize(a)), B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection++;
  const jaccard = intersection / new Set([...A, ...B]).size;
  const containment = intersection / Math.min(A.size, B.size);
  return jaccard * 0.45 + containment * 0.55;
}

function matchScore(a, b) {
  let score = similarity(a.name, b.name) * 0.55;
  const fields = [['brand',.10],['model',.25],['storage',.08],['ram',.08],['screenSize',.04]];
  for (const [field, weight] of fields) {
    if (!a[field] || !b[field]) continue;
    const x = normalizeText(a[field]), y = normalizeText(b[field]);
    if (x === y) score += weight;
    else if (x.includes(y) || y.includes(x)) score += weight * .45;
  }
  return Math.min(1, score);
}

function groupProducts(products = [], threshold = 0.72) {
  const groups = [];
  for (const product of products) {
    let target = null, bestScore = 0;
    for (const group of groups) {
      const score = matchScore(product, group.anchor);
      if (score > bestScore) { bestScore = score; target = group; }
    }
    if (target && bestScore >= threshold) {
      target.products.push(product);
      target.score = Math.max(target.score, bestScore);
    } else {
      groups.push({ key: extractSearchKey(product.name), anchor: product, products: [product], score: 1 });
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
      savings: lowestPrice != null && highestPrice != null ? Math.max(0, highestPrice-lowestPrice) : 0,
      bestOffer,
      matchScore: Number(group.score.toFixed(3))
    };
  });
}

module.exports = { extractSearchKey, similarity, matchScore, groupProducts };