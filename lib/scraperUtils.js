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
function parseGenericLinkedProducts($, baseUrl, marketplace) {
  const products = [];
  const blocked = /^(javascript:|#|mailto:)/i;
  const hrefLooksLikeProduct = href => {
    if (!href || blocked.test(href)) return false;
    try {
      const u = new URL(href, baseUrl);
      const path = u.pathname.toLowerCase();
      if (marketplace === 'Pickaboo') return path.includes('/product-detail/');
      if (marketplace === 'GadgetGear' || marketplace === 'Dazzle' || marketplace === 'SumashTech' || marketplace === 'AppleGadgets') return path.includes('/product/');
      if (marketplace === 'Rokomari') return /\/(product|book|electronics|superstore)\//.test(path);
      if (marketplace === 'Chaldal' || marketplace === 'Othoba') return /\/(p|product|products|item)\//.test(path);
      if (marketplace === 'Ryans' || marketplace === 'TechLand' || marketplace === 'AjkerDeal') {
        return !/\/(category|search|brand|page|cart|checkout|login|register|wishlist|compare|blog|news|about|contact)(\/|$)/.test(path)
          && path.split('/').filter(Boolean).length >= 1;
      }
      return /\/(product|item|deal|p)(\/|$)/.test(path);
    } catch { return false; }
  };

  $('a[href]').each((_, anchor) => {
    if (products.length >= 20) return false;
    const href = $(anchor).attr('href') || '';
    if (!hrefLooksLikeProduct(href)) return;

    const $a = $(anchor);
    const name = ($a.text() || $a.attr('title') || $a.find('img').attr('alt') || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length < 4 || name.length > 240) return;

    let $card = $a.closest('.product-item, .product-card, .product-thumb, .product-layout, .category-single-product, article, li');
    if (!$card.length) $card = $a.parent();
    const text = ($card.text() || '').replace(/\s+/g, ' ').trim();
    const prices = [...text.matchAll(/(?:৳|Tk\.?|BDT\.?|\bTaka\b)\s*([0-9][0-9,]*(?:\.\d+)?)/gi)]
      .map(m => Number(String(m[1]).replace(/,/g, '')))
      .filter(n => Number.isFinite(n) && n > 0);
    if (!prices.length) return;

    const $img = $card.find('img').first();
    const image = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('data-original') || $a.find('img').attr('src');
    products.push({
      name,
      marketplace,
      price: prices[0],
      originalPrice: prices[1] || prices[0],
      discount: 0,
      image: absoluteUrl(baseUrl, image),
      url: absoluteUrl(baseUrl, href),
      inStock: !/out of stock|stock out|sold out|unavailable/i.test(text),
      isOfficial: true,
      rating: null,
      reviewCount: null,
      soldCount: null,
      coupons: [],
      cashback: []
    });
  });
  return products;
}
function parseEmbeddedProducts($, baseUrl, marketplace) {
  const products = [];
  const seenObjects = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object' || products.length >= 30) return;
    if (seenObjects.has(node)) return;
    seenObjects.add(node);
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const name = node.name || node.title || node.productName || node.product_name;
    const priceRaw = node.price ?? node.salePrice ?? node.sellingPrice ?? node.specialPrice ?? node.currentPrice;
    const urlRaw = node.url || node.link || node.href || node.productUrl || node.product_url;
    const imageRaw = node.image || node.imageUrl || node.thumbnail || node.thumbnailUrl;
    const price = Number.parseFloat(String(priceRaw ?? '').replace(/[^0-9.]/g, ''));
    if (name && Number.isFinite(price) && price > 0 && urlRaw) {
      products.push({
        name: String(name).replace(/\s+/g, ' ').trim(), marketplace, price,
        originalPrice: Number.parseFloat(String(node.originalPrice ?? node.oldPrice ?? node.compareAtPrice ?? '').replace(/[^0-9.]/g, '')) || price,
        discount: 0, image: absoluteUrl(baseUrl, Array.isArray(imageRaw) ? imageRaw[0] : imageRaw),
        url: absoluteUrl(baseUrl, urlRaw), inStock: node.inStock !== false && !/outofstock|soldout/i.test(String(node.availability || '')),
        isOfficial: true, rating: null, reviewCount: null, soldCount: null, coupons: [], cashback: []
      });
      return;
    }
    Object.values(node).forEach(visit);
  };
  $('script').each((_, el) => {
    const text = $(el).contents().text().trim();
    if (!text || text.length > 1000000) return;
    try { visit(JSON.parse(text)); } catch {}
  });
  return dedupe(products);
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
  const deadline = Date.now() + 5200;
  for (const url of candidates) {
    const remaining = deadline - Date.now();
    if (remaining < 500) break;
    try {
      const html = await scraper.fetchPage(url, { timeout: Math.min(4200, remaining) });
      if (!html) continue;
      const $ = scraper.loadHTML(html);

      let products = parseCards($) || [];
      if (!products.length) products = parseJsonLd($, scraper.baseUrl, scraper.marketplace);
      if (!products.length) products = parseEmbeddedProducts($, scraper.baseUrl, scraper.marketplace);
      if (!products.length) products = parseGenericLinkedProducts($, scraper.baseUrl, scraper.marketplace);

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
    discount: scraper.parseDiscount(price, originalPrice), image: absoluteUrl(scraper.baseUrl, data.image), url: absoluteUrl(scraper.baseUrl, data.url),
    inStock: data.inStock !== false, isOfficial: data.isOfficial !== false, rating: data.rating || null, reviewCount: data.reviewCount || null, soldCount: null, coupons: [], cashback: []
  };
}
module.exports = { absoluteUrl, firstText, firstAttr, parseJsonLd, parseEmbeddedProducts, parseGenericLinkedProducts, searchWithCandidates, makeProduct };
