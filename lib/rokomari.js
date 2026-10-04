const BaseScraper = require('./baseScraper');
const {
  firstText,
  firstAttr,
  makeProduct,
  parseJsonLd,
  parseEmbeddedProducts,
  parseGenericLinkedProducts
} = require('./scraperUtils');

class RokomariScraper extends BaseScraper {
  constructor() {
    super('Rokomari', 'https://www.rokomari.com');
  }

  queryTokens(query) {
    return String(query || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(token => token.length >= 2);
  }

  parseCards($) {
    const products = [];
    const seen = new Set();

    $('.book-list-wrapper .book-card, .book-list-wrapper > div, .product-list .product-item, .product-item, [class*="product-card"], [class*="book-card"], article').each((_, el) => {
      if (products.length >= 30) return false;

      const $card = $(el);
      let url = '';
      try {
        url = this.absoluteUrl(firstAttr($card, ['a[href]'], 'href') || '');
      } catch (_) {
        return;
      }

      if (!url || !this.isSameHost(url)) return;

      const path = new URL(url).pathname.toLowerCase();
      if (/\/(category|category-brand|search|cart|checkout|login|register|wishlist|compare|author|publisher|brand)(\/|$)/i.test(path)) {
        return;
      }

      if (!/\/(book|product|electronics|superstore)\//i.test(path)) return;

      const text = ($card.text() || '').replace(/\s+/g, ' ').trim();
      const name =
        firstText($card, ['.book-title', '.product-name', '.product-title', '.title', 'h3 a', 'h3', 'h4']) ||
        $card.find('a[title]').first().attr('title') ||
        $card.find('img').first().attr('alt') ||
        '';

      const price =
        firstText($card, ['.book-price .current-price', '.price .new-price', '.product-price', '.current-price', '.price', '[class*="price"]']) ||
        ((text.match(/(?:৳|TK\.?|BDT\.?|\bTaka\b)\s*[0-9][0-9,]*/i) || [])[0] || '');

      const originalPrice = firstText($card, ['.book-price .old-price', '.price .regular-price', '.original-price', 'del']);
      const image =
        firstAttr($card, ['img'], 'src') ||
        firstAttr($card, ['img'], 'data-src') ||
        firstAttr($card, ['img'], 'data-original']);

      if (!name || !price) return;

      const key = url.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      const product = makeProduct(this, {
        name,
        price,
        originalPrice,
        url,
        image,
        inStock: !/out of stock|stock out|sold out|unavailable/i.test(text),
        isOfficial: false
      });

      if (product) products.push(product);
    });

    return products;
  }

  parsePage($) {
    let products = this.parseCards($);

    if (!products.length) products = parseJsonLd($, this.baseUrl, this.marketplace);
    if (!products.length) products = parseEmbeddedProducts($, this.baseUrl, this.marketplace);
    if (!products.length) products = parseGenericLinkedProducts($, this.baseUrl, this.marketplace);

    return products
      .filter(product => product && product.url && this.isSameHost(product.url))
      .map(product => ({ ...product, isOfficial: false }));
  }

  score(product, query) {
    const tokens = this.queryTokens(query);
    const name = String(product.name || '').toLowerCase();
    const url = String(product.url || '').toLowerCase();

    let score = 0;

    for (const token of tokens) {
      if (name.includes(token)) score += token.length >= 4 ? 10 : 5;
      else if (url.includes(token)) score += 3;
    }

    if (tokens.length && tokens.every(token => name.includes(token))) score += 30;
    return score;
  }

  buildCandidates(query) {
    const raw = String(query || '').trim().toLowerCase();
    const encoded = encodeURIComponent(raw);

    const candidates = [
      this.baseUrl + '/search?term=' + encoded,
      this.baseUrl + '/search?q=' + encoded,
      this.baseUrl + '/search?query=' + encoded,
      this.baseUrl + '/search?search=' + encoded
    ];

    if (/logitech/i.test(raw)) {
      candidates.push(this.baseUrl + '/category-brand/2051/Logitech/5848');
    }

    if (/tp[- ]?link/i.test(raw)) {
      candidates.push(this.baseUrl + '/category-brand/2024/tp-link/5848');
    }

    if (/xiaomi|mi\b/i.test(raw)) {
      candidates.push(this.baseUrl + '/category-brand/2024/xiaomi/5848');
    }

    if (/samsung/i.test(raw)) {
      candidates.push(this.baseUrl + '/category-brand/2024/samsung/5848');
    }

    return [...new Set(candidates)];
  }

  async fetchParsed(url, timeout = 1800) {
    try {
      const html = await this.fetchPage(url, { timeout, retries: 0 });
      if (!html) return [];
      return this.parsePage(this.loadHTML(html));
    } catch (_) {
      return [];
    }
  }

  async search(query) {
    const candidates = this.buildCandidates(query);

    const results = await Promise.allSettled(
      candidates.map(url => this.fetchParsed(url, 1800))
    );

    const unique = new Map();

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;

      for (const product of result.value || []) {
        const key = String(product.url || '').toLowerCase();
        if (key && !unique.has(key)) unique.set(key, product);
      }
    }

    return Array.from(unique.values())
      .map(product => ({ product, score: this.score(product, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.product.price) - Number(b.product.price))
      .slice(0, 30)
      .map(item => item.product);
  }

  async getProductFromUrl(url) {
    try {
      const html = await this.fetchPage(url, { timeout: 3000, retries: 0 });
      if (!html) return null;

      const $ = this.loadHTML(html);
      const body = $('body');

      const name = firstText(body, ['h1.product-title', 'h1.book-title', 'h1.product-name', 'h1']);
      const price = firstText(body, ['.product-price .current-price', '.book-price .current-price', '.price .new-price', '.current-price', '.price']);
      const originalPrice = firstText(body, ['.product-price .old-price', '.book-price .old-price', '.price .regular-price', 'del']);
      const image =
        firstAttr(body, ['.product-image img', '.book-image img', 'img'], 'src') ||
        firstAttr(body, ['img'], 'data-src');

      const product = makeProduct(this, {
        name,
        price,
        originalPrice,
        url,
        image,
        inStock: !/out of stock|stock out|sold out|unavailable/i.test(body.text()),
        isOfficial: false
      });

      return product ? { ...product, url } : null;
    } catch (_) {
      return null;
    }
  }
}

module.exports = RokomariScraper;
