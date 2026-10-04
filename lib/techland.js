const BaseScraper = require('./baseScraper');
const { searchWithCandidates, firstText, firstAttr, makeProduct, parseJsonLd, parseEmbeddedProducts } = require('./scraperUtils');

class TechLandScraper extends BaseScraper {
  constructor() { super('TechLand', 'https://www.techlandbd.com'); }

  parseCards($) {
    const products = [];
    const seen = new Set();
    $('.product-layout, .product-thumb, .product-grid, [class*="product-card"], [class*="product-item"]').each((_, el) => {
      if (products.length >= 30) return false;
      const $e = $(el);
      const url = this.absoluteUrl(firstAttr($e, ['a'], 'href'));
      if (!url || !this.isSameHost(url) || !/\/(?:product|products|item)\//i.test(new URL(url).pathname)) return;
      const text = ($e.text() || '').replace(/\s+/g, ' ').trim();
      const name = firstText($e, ['.caption h4', '.product-title', '.product-name', '.name', 'h3', 'h4']);
      const price = firstText($e, ['.price-new', '.special-price', '.sale-price', '.price', '[class*="price"]']);
      const originalPrice = firstText($e, ['.price-old', '.old-price', '.regular-price', 'del']);
      const image = firstAttr($e, ['img'], 'src') || firstAttr($e, ['img'], 'data-src') || firstAttr($e, ['img'], 'data-original');
      if (!name || !price || seen.has(url.toLowerCase())) return;
      seen.add(url.toLowerCase());
      const p = makeProduct(this, { name, price, originalPrice, url, image, inStock: !/out of stock|stock out|sold out|unavailable/i.test(text), isOfficial: false });
      if (p) products.push(p);
    });
    return products;
  }

  async search(query) {
    const q = encodeURIComponent(String(query).trim());
    const candidates = [
      this.baseUrl + '/search?search=' + q,
      this.baseUrl + '/index.php?route=product/search&search=' + q,
      this.baseUrl + '/shop-laptop-computer?search=' + q
    ];
    return searchWithCandidates(this, candidates, $ => {
      let products = this.parseCards($);
      if (!products.length) products = parseJsonLd($, this.baseUrl, this.marketplace);
      if (!products.length) products = parseEmbeddedProducts($, this.baseUrl, this.marketplace);
      return products.filter(p => p && p.url && this.isSameHost(p.url)).slice(0, 30);
    });
  }
}

module.exports = TechLandScraper;
