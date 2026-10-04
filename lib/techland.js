const BaseScraper = require('./baseScraper');
const {
  firstText,
  firstAttr,
  makeProduct,
  parseJsonLd,
  parseEmbeddedProducts,
  parseGenericLinkedProducts,
  absoluteUrl
} = require('./scraperUtils');

class TechLandScraper extends BaseScraper {
  constructor() {
    super('TechLand', 'https://www.techlandbd.com');
  }

  parseCards($) {
    const products = [];
    const seen = new Set();

    $('.product-layout, .product-thumb, .product-grid, .product-item, [class*="product-card"], [class*="product-item"], article').each((_, el) => {
      if (products.length >= 30) return false;

      const $e = $(el);
      const rawUrl = firstAttr($e, ['a[href]'], 'href');
      let url = '';
      try { url = this.absoluteUrl(rawUrl || ''); } catch {}

      if (!url || !this.isSameHost(url)) return;

      const path = new URL(url).pathname.toLowerCase();
      if (/\/(category|search|brand|cart|checkout|login|register|wishlist|compare|blog|news|about|contact)(\/|$)/i.test(path)) return;

      const text = ($e.text() || '').replace(/\s+/g, ' ').trim();
      const name =
        firstText($e, ['.caption h4', '.product-title', '.product-name', '.name', 'h2', 'h3', 'h4']) ||
        $e.find('a[title]').first().attr('title') ||
        $e.find('img').first().attr('alt') || '';

      const price =
        firstText($e, ['.price-new', '.special-price', '.sale-price', '.price', '[class*="price"]']) ||
        ((text.match(/(?:৳|Tk\.?|BDT\.?|\bTaka\b)\s*[0-9][0-9,]*/i) || [])[0] || '');

      const originalPrice = firstText($e, ['.price-old', '.old-price', '.regular-price', 'del']);
      const image =
        firstAttr($e, ['img'], 'src') ||
        firstAttr($e, ['img'], 'data-src') ||
        firstAttr($e, ['img'], 'data-lazy-src') ||
        firstAttr($e, ['img'], 'data-original']);

      if (!name || !price) return;

      const key = url.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      const product = makeProduct(this, {
        name, price, originalPrice, url, image,
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
      .filter(p => p && p.url && this.isSameHost(p.url))
      .map(p => ({ ...p, isOfficial: false }));
  }

  queryTokens(query) {
    return String(query).toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
  }

  score(product, query) {
    const tokens = this.queryTokens(query);
    const name = String(product.name || '').toLowerCase();
    const url = String(product.url || '').toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (name.includes(token)) score += token.length >= 4 ? 10 : 5;
      else if (url.includes(token)) score += 2;
    }
    if (tokens.length && tokens.every(t => name.includes(t))) score += 25;
    return score;
  }

  buildCandidates(query) {
    const q = encodeURIComponent(String(query).trim());
    const raw = String(query).trim().toLowerCase();
    const candidates = [
      this.baseUrl + '/search?search=' + q,
      this.baseUrl + '/index.php?route=product/search&search=' + q,
      this.baseUrl + '/search?q=' + q
    ];

    const addPages = (base, count = 6) => {
      for (let page = 1; page <= count; page++) {
        candidates.push(base + (base.includes('?') ? '&' : '?') + 'page=' + page);
      }
    };

    const brandMap = [
      ['logitech', '/logitech-brand'],
      ['tp-link', '/tp-link-router'],
      ['tplink', '/tp-link-router'],
      ['asus', '/asus-brand'],
      ['samsung', '/samsung-brand'],
      ['xiaomi', '/xiaomi-brand'],
      ['d-link', '/d-link-brand'],
      ['dlink', '/d-link-brand'],
      ['tenda', '/tenda-brand'],
      ['netgear', '/netgear-brand'],
      ['corsair', '/corsair-brand'],
      ['razer', '/razer-brand']
    ];

    const brand = brandMap.find(([key]) => raw.includes(key));
    if (brand) addPages(this.baseUrl + brand[1], 6);

    if (/deco|router|wifi|wi-fi|mesh/i.test(raw)) {
      addPages(this.baseUrl + '/server-networking/shop-routers/tp-link-router', 10);
    } else if (/mouse/i.test(raw)) {
      addPages(this.baseUrl + '/accessories/shop-computer-mouse', 8);
    } else if (/keyboard/i.test(raw)) {
      addPages(this.baseUrl + '/accessories/computer-keyboard', 6);
    } else if (/headset|headphone|earbuds/i.test(raw)) {
      addPages(this.baseUrl + '/accessories/headphone-speaker/shop-headphones-headsets', 6);
    } else if (/laptop|notebook/i.test(raw)) {
      addPages(this.baseUrl + '/laptop', 6);
    } else {
      addPages(this.baseUrl + '/accessories', 4);
    }

    return [...new Set(candidates)];
  }

  async search(query) {
    const candidates = this.buildCandidates(query);
    const deadline = Date.now() + 5600;
    const results = await Promise.allSettled(candidates.map(async url => {
      const remaining = deadline - Date.now();
      if (remaining < 700) return [];
      try {
        const html = await this.fetchPage(url, { timeout: Math.min(2000, remaining), retries: 0 });
        if (!html) return [];
        return this.parsePage(this.loadHTML(html));
      } catch {
        return [];
      }
    }));

    const unique = new Map();
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const product of result.value || []) {
        const key = String(product.url || '').toLowerCase();
        if (!key || unique.has(key)) continue;
        unique.set(key, product);
      }
    }

    const products = Array.from(unique.values())
      .map(product => ({ product, score: this.score(product, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.product.price) - Number(b.product.price))
      .map(item => item.product);

    return products.slice(0, 30);
  }
}

module.exports = TechLandScraper;
