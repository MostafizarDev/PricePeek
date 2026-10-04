const BaseScraper = require('./baseScraper');
const {
  searchWithCandidates,
  firstText,
  firstAttr,
  makeProduct,
  parseJsonLd,
  parseEmbeddedProducts
} = require('./scraperUtils');

class AjkerDealScraper extends BaseScraper {
  constructor() {
    super('AjkerDeal', 'https://ajkerdeal.com');
  }

  queryTokens(query) {
    return String(query || '')
      .toLowerCase()
      .replace(/[^a-z0-9\u0980-\u09ff]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 10);
  }

  isProductUrl(url) {
    try {
      const u = new URL(url);
      if (!this.isSameHost(url)) return false;
      const p = u.pathname.toLowerCase();
      return /^\/en\/product\/\d+\//i.test(p) ||
             /^\/en\/product\/\d+$/i.test(p) ||
             /^\/product\/\d+\//i.test(p) ||
             /^\/product\/\d+$/i.test(p);
    } catch {
      return false;
    }
  }

  parseCards($, query) {
    const products = [];
    const seen = new Set();
    const tokens = this.queryTokens(query);

    $('a[href]').each((_, anchor) => {
      if (products.length >= 50) return false;

      let url = '';
      try {
        url = this.absoluteUrl($(anchor).attr('href') || '');
        if (!this.isProductUrl(url)) return;
      } catch {
        return;
      }

      const key = url.toLowerCase();
      if (seen.has(key)) return;

      const $a = $(anchor);
      let $card = $a.closest(
        '[class*="product"], [class*="Product"], [class*="deal"], [class*="Deal"], article, li'
      );
      if (!$card.length) $card = $a.parent();

      const text = ($card.text() || '').replace(/\s+/g, ' ').trim();
      const name =
        firstText($card, [
          '.product-title',
          '.deal-title',
          '.product-name',
          '.name',
          '[class*="title"]',
          '[class*="Title"]',
          'h2',
          'h3',
          'h4'
        ]) ||
        $a.attr('title') ||
        $a.find('img').attr('alt') ||
        $a.text().trim();

      const price =
        firstText($card, [
          '.deal-price',
          '.sale-price',
          '.selling-price',
          '.current-price',
          '.price',
          '[class*="price"]',
          '[class*="Price"]'
        ]) ||
        ((text.match(/(?:৳|Tk|BDT|Taka)\s*[\d,]+(?:\.\d+)?/i) || [])[0] || '');

      const originalPrice =
        firstText($card, [
          'del',
          's',
          '.old-price',
          '.regular-price',
          '.original-price',
          '[class*="old-price"]',
          '[class*="original"]'
        ]) ||
        ((text.match(/(?:৳|Tk|BDT|Taka)\s*[\d,]+(?:\.\d+)?/gi) || []).slice(1, 2)[0] || '');

      const image =
        firstAttr($card, ['img'], 'src') ||
        firstAttr($card, ['img'], 'data-src') ||
        firstAttr($card, ['img'], 'data-original') ||
        firstAttr($card, ['img'], 'data-lazy-src');

      if (!name || !price) return;

      const lowerName = name.toLowerCase();
      const score = tokens.reduce((n, token) => n + (lowerName.includes(token) ? 1 : 0), 0);
      if (tokens.length && score === 0) return;

      seen.add(key);

      const p = makeProduct(this, {
        name,
        price,
        originalPrice,
        url,
        image,
        inStock: !/out of stock|stock out|sold out|unavailable/i.test(text),
        isOfficial: false
      });

      if (p) {
        p.searchScore = score;
        products.push(p);
      }
    });

    return products.sort((a, b) => (b.searchScore || 0) - (a.searchScore || 0));
  }

  parsePage($, query) {
    let products = this.parseCards($, query);

    if (!products.length) {
      products = parseJsonLd($, this.baseUrl, this.marketplace)
        .filter(p => p && p.url && this.isProductUrl(p.url))
        .map(p => ({ ...p, isOfficial: false }));
    }

    if (!products.length) {
      products = parseEmbeddedProducts($, this.baseUrl, this.marketplace)
        .filter(p => p && p.url && this.isProductUrl(p.url))
        .map(p => ({ ...p, isOfficial: false }));
    }

    return products.slice(0, 50);
  }

  async search(query) {
    const q = encodeURIComponent(String(query).trim());
    const raw = String(query || '').toLowerCase();

    const candidates = [
      this.baseUrl + '/search?query=' + q,
      this.baseUrl + '/search?q=' + q,
      this.baseUrl + '/en/search?query=' + q,
      this.baseUrl + '/en/search?q=' + q,
      this.baseUrl + '/en/category/computer-accessories'
    ];

    if (/mouse|keyboard|monitor|router|webcam|headphone|speaker|computer|laptop|pc/i.test(raw)) {
      candidates.push(this.baseUrl + '/en/category/computer-accessories');
    }

    if (/mouse/i.test(raw)) {
      candidates.push(this.baseUrl + '/en/category/computer-accessories-mouse-toy-shaped-mouse');
      candidates.push(this.baseUrl + '/en/category/computer-accessories-mouse-wireless');
      candidates.push(this.baseUrl + '/en/category/computer-accessories-mouse-gaming-mouse');
    }

    if (/logitech/i.test(raw)) {
      candidates.push(this.baseUrl + '/en/brand/logitech');
    }

    const uniqueCandidates = [...new Set(candidates)];

    const results = await Promise.all(
      uniqueCandidates.map(async url => {
        try {
          const $ = await this.fetchPage(url, { timeout: 1800, retries: 0 });
          return this.parsePage($, query);
        } catch {
          return [];
        }
      })
    );

    const dedup = new Map();

    for (const list of results) {
      for (const p of list) {
        if (!p || !p.url) continue;
        const key = p.url.toLowerCase();
        if (!dedup.has(key)) dedup.set(key, p);
      }
    }

    return [...dedup.values()]
      .sort((a, b) => (b.searchScore || 0) - (a.searchScore || 0))
      .slice(0, 30);
  }

  async getProductFromUrl(url) {
    try {
      const $ = await this.fetchPage(url, { timeout: 3000, retries: 0 });
      const products = parseJsonLd($, this.baseUrl, this.marketplace)
        .filter(p => p && p.url && this.isProductUrl(p.url))
        .map(p => ({ ...p, isOfficial: false }));

      if (products.length) return products[0];

      const parsed = this.parseCards($, '');
      return parsed[0] ? { ...parsed[0], isOfficial: false } : null;
    } catch {
      return null;
    }
  }
}

module.exports = AjkerDealScraper;
