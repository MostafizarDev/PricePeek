const BaseScraper = require('./baseScraper');
const {
  firstText,
  firstAttr,
  makeProduct,
  parseJsonLd,
  parseEmbeddedProducts,
  parseGenericLinkedProducts
} = require('./scraperUtils');

class OthobaScraper extends BaseScraper {
  constructor() {
    super('Othoba', 'https://othoba.com');
  }

  queryTokens(query) {
    return String(query || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(token => token.length >= 2);
  }

  isProductUrl(url) {
    try {
      const u = new URL(url);
      if (!this.isSameHost(url)) return false;

      const path = u.pathname.toLowerCase().replace(/\/$/, '');
      if (!path || path === '') return false;

      // Othoba product pages are usually root-level slug URLs.
      if (/\/(search|category|categories|brand|brands|cart|checkout|login|register|wishlist|compare|account|contact|about|privacy|terms|seller|shop|store|blog|help)(\/|$)/i.test(path)) {
        return false;
      }

      // Avoid obvious static/media and utility routes.
      if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|xml|pdf)$/i.test(path)) return false;

      return path.split('/').filter(Boolean).length <= 2;
    } catch (_) {
      return false;
    }
  }

  parseCards($) {
    const products = [];
    const seen = new Set();

    const selectors = [
      '[class*="product-card"]',
      '[class*="ProductCard"]',
      '[class*="product-item"]',
      '[class*="product-item-container"]',
      '.ty-grid-list__item',
      '.grid-list',
      'article'
    ].join(', ');

    $(selectors).each((_, el) => {
      if (products.length >= 30) return false;

      const $card = $(el);
      const anchor = $card.find('a[href]').filter((__, a) => {
        try { return this.isProductUrl(this.absoluteUrl($(a).attr('href') || '')); } catch (_) { return false; }
      }).first();

      if (!anchor.length) return;

      const url = this.absoluteUrl(anchor.attr('href') || '');
      const text = ($card.text() || '').replace(/\s+/g, ' ').trim();

      const name =
        firstText($card, [
          '.product-name',
          '.product-title',
          '[class*="product-name"]',
          '[class*="product-title"]',
          '.ty-grid-list__item-name',
          'h2',
          'h3',
          'h4'
        ]) ||
        anchor.attr('title') ||
        anchor.find('img').first().attr('alt') ||
        '';

      const price =
        firstText($card, [
          '.price',
          '.sale-price',
          '.price-new',
          '.special-price',
          '.ty-price',
          '[class*="price"]'
        ]) ||
        ((text.match(/(?:৳|Tk\.?|BDT\.?|Taka)\s*[0-9][0-9,]*/i) || [])[0] || '');

      const originalPrice =
        firstText($card, [
          'del',
          '.old-price',
          '.regular-price',
          '.original-price',
          '[class*="old-price"]'
        ]);

      const image =
        firstAttr($card, ['img'], 'src') ||
        firstAttr($card, ['img'], 'data-src') ||
        firstAttr($card, ['img'], 'data-original') ||
        firstAttr($card, ['img'], 'data-lazy-src');

      if (!url || !name || !price) return;

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
    const raw = String(query || '').trim();
    const encoded = encodeURIComponent(raw);

    const candidates = [
      this.baseUrl + '/ts/search/' + encoded + '/?pagenumber=1&q=' + encoded + '&t=t',
      this.baseUrl + '/search?text=' + encoded,
      this.baseUrl + '/search?q=' + encoded,
      this.baseUrl + '/?q=' + encoded
    ];

    // Othoba exposes useful brand/catalog pages, so use them as
    // lightweight fallbacks when a direct search route does not render.
    if (/logitech/i.test(raw)) {
      candidates.push(this.baseUrl + '/exclusive-logitech-gear');
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
      let products = this.parsePage($);

      const product = products.find(item =>
        String(item.url || '').replace(/\/$/, '') === String(url || '').replace(/\/$/, '')
      ) || products[0];

      return product ? { ...product, url, isOfficial: false } : null;
    } catch (_) {
      return null;
    }
  }
}

module.exports = OthobaScraper;
