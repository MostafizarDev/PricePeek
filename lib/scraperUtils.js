const BaseScraper = require('./baseScraper');

function absoluteUrl(baseUrl, raw) {
  if (!raw) return '';
  try { return new URL(raw, baseUrl).href; } catch { return ''; }
}
function firstText($el, selectors) {
  for (const selector of selectors) {
    const value = $el.find(selector).first().text().replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return '';
}
function firstAttr($el, selectors, attr) {
  for (const selector of selectors) {
    const value = $el.find(selector).first().attr(attr);
    if (value) return value || '';
  }
  return '';
}
function parseJsonLd($, baseUrl, marketplace) {
  const products = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      const walk = node => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (node['@graph']) walk(node['@graph']);
        const type = node['@type'];
        if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
          const offers = Array.isArray(node.offers) ? node.offers[0] : (node.offers || {});
          const price = Number.parseFloat(String(offers.price || '').replace(/[^0-9.]/g, ''));
          if (node.name && Number.isFinite(price) && price > 0) {
            products.push({
              name: String(node.name).replace(/\s+/g, ' ').trim(), marketplace, price,
              originalPrice: price, discount: 0,
              image: absoluteUrl(baseUrl, Array.isArray(node.image) ? node.image[0] : node.image),
              url: absoluteUrl(baseUrl, node.url),
              inStock: !offers.availability || !/outofstock|soldout/i.test(String(offers.availability)),
              isOfficial: true, rating: null, reviewCount: null, soldCount: null, coupons: [], cashback: []
            });
          }
        }
      };
      walk(parsed);
    } catch {}
  });
  return products;
}
function dedupe(products) {
  const seen = new Set();
  return products.filter(p => {
    const key = (p.url || '') + '|' + (p.name || '') + '|' + (p.price || '');
    if (!p.name || !p.price || !p.url || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
async function searchWithCandidates(scraper, candidates, parseCards) {
  for (const url of candidates) {
    try {
      const html = await scraper.fetchPage(url);
      if (!html) continue;
      const $ = scraper.loadHTML(html);
      let products = parseCards($) || [];
      if (!products.length) products = parseJsonLd($, scraper.baseUrl, scraper.marketplace);
      products = dedupe(products).slice(0, 20);
      if (products.length) return products;
    } catch (error) {
      console.warn('[' + scraper.marketplace + '] ' + error.message);
    }
  }
  return [];
}
function makeProduct(scraper, data) {
  const price = scraper.parsePrice(data.price);
  const originalPrice = scraper.parsePrice(data.originalPrice) || price;
  if (!data.name || !price || price <= 0 || !data.url) return null;
  return {
    id: scraper.marketplace.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
    name: scraper.cleanProductName(data.name), marketplace: scraper.marketplace, price, originalPrice,
    discount: scraper.parseDiscount(price, originalPrice), image: absoluteUrl(scraper.baseUrl, data.image),
    url: absoluteUrl(scraper.baseUrl, data.url), inStock: data.inStock !== false, isOfficial: data.isOfficial !== false,
    rating: data.rating || null, reviewCount: data.reviewCount || null, soldCount: null, coupons: [], cashback: []
  };
}
module.exports = { absoluteUrl, firstText, firstAttr, parseJsonLd, searchWithCandidates, makeProduct };
