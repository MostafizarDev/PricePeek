const BaseScraper = require('./baseScraper');
const { searchWithCandidates, firstText, firstAttr, makeProduct, parseJsonLd, parseEmbeddedProducts } = require('./scraperUtils');

class RokomariScraper extends BaseScraper {
  constructor() { super('Rokomari', 'https://www.rokomari.com'); }

  parseCards($) {
    const products = [];
    const seen = new Set();
    $('.book-list-wrapper .book-card, .book-list-wrapper > div, .product-list .product-item, .product-item, [class*="product-card"], [class*="book-card"]').each((_, el) => {
      if (products.length >= 30) return false;
      const $e = $(el);
      const url = this.absoluteUrl(firstAttr($e, ['a'], 'href'));
      if (!url || !this.isSameHost(url) || !/(?:\/book\/|\/product\/|\/electronics\/|\/superstore\/)/i.test(new URL(url).pathname)) return;
      const text = ($e.text() || '').replace(/\s+/g, ' ').trim();
      const name = firstText($e, ['.book-title', '.product-name', '.product-title', '.title', 'h3 a', 'h3', 'h4']);
      const price = firstText($e, ['.book-price .current-price', '.price .new-price', '.product-price', '.current-price', '.price', '[class*="price"]']);
      const originalPrice = firstText($e, ['.book-price .old-price', '.price .regular-price', '.original-price', 'del']);
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
      this.baseUrl + '/search?term=' + q,
      this.baseUrl + '/search?q=' + q,
      this.baseUrl + '/search?query=' + q,
      this.baseUrl + '/search?search=' + q
    ];
    return searchWithCandidates(this, candidates, $ => {
      let products = this.parseCards($);
      if (!products.length) products = parseJsonLd($, this.baseUrl, this.marketplace);
      if (!products.length) products = parseEmbeddedProducts($, this.baseUrl, this.marketplace);
      return products.filter(p => p && p.url && this.isSameHost(p.url)).slice(0, 30);
    });
  }

  async getProductFromUrl(url) {
    try {
      const html = await this.fetchPage(url);
      if (!html) return null;
      const $ = this.loadHTML(html);
      const body = $('body');
      const name = firstText(body, ['h1.product-title', 'h1.book-title', 'h1.product-name', 'h1']);
      const price = firstText(body, ['.product-price .current-price', '.book-price .current-price', '.price .new-price', '.current-price', '.price']);
      const originalPrice = firstText(body, ['.product-price .old-price', '.book-price .old-price', '.price .regular-price']);
      const image = firstAttr(body, ['.product-image img', '.book-image img', 'img'], 'src');
      const p = makeProduct(this, { name, price, originalPrice, url, image, inStock: !/out of stock|stock out|sold out|unavailable/i.test(body.text()), isOfficial: false });
      return p ? { ...p, url } : null;
    } catch (error) {
      console.error('[Rokomari] getProductFromUrl:', error.message);
      return null;
    }
  }
}

module.exports = RokomariScraper;
