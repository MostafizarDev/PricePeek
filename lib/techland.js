const BaseScraper = require('./baseScraper');
const {
  firstText,
  firstAttr,
  makeProduct,
  parseJsonLd,
  parseEmbeddedProducts,
  parseGenericLinkedProducts
} = require('./scraperUtils');

class TechLandScraper extends BaseScraper {
  constructor() {
    super('TechLand', 'https://www.techlandbd.com');
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

    $('.product-layout, .product-thumb, .product-grid, .product-item, [class*="product-card"], [class*="product-item"], article').each((_, el) => {
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
      if (/\/(category|search|brand|cart|checkout|login|register|wishlist|compare|blog|news|about|contact)(\/|$)/i.test(path)) {
        return;
      }

      const text = ($card.text() || '').replace(/\s+/g, ' ').trim();
      const name =
        firstText($card, ['.caption h4', '.product-title', '.product-name', '.name', 'h2', 'h3', 'h4']) ||
        $card.find('a[title]').first().attr('title') ||
        $card.find('img').first().attr('alt') ||
        '';

      const price =
        firstText($card, ['.price-new', '.special-price', '.sale-price', '.price', '[class*="price"]']) ||
        ((text.match(/(?:৳|Tk\.?|BDT\.?|\bTaka\b)\s*[0-9][0-9,]*/i) || [])[0] || '');

      const originalPrice = firstText($card, ['.price-old', '.old-price', '.regular-price', 'del']);
      const image =
        firstAttr($card, ['img'], 'src') ||
        firstAttr($card, ['img'], 'data-src') ||
        firstAttr($card, ['img'], 'data-lazy-src') ||
        firstAttr($card, ['img'], 'data-original');

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

    if (!products.length) {
      products = parseJsonLd($, this.baseUrl, this.marketplace);
    }
    if (!products.length) {
      products = parseEmbeddedProducts($, this.baseUrl, this.marketplace);
    }
    if (!products.length) {
      products = parseGenericLinkedProducts($, this.baseUrl, this.marketplace);
    }

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
      if (name.includes(token)) {
        score += token.length >= 4 ? 10 : 5;
      } else if (url.includes(token)) {
        score += 3;
      }
    }

    if (tokens.length && tokens.every(token => name.includes(token))) {
      score += 30;
    }

    return score;
  }

  buildCandidates(query) {
    const raw = String(query || '').trim().toLowerCase();
    const encoded = encodeURIComponent(raw);
    const candidates = [
      this.baseUrl + '/search?search=' + encoded,
      this.baseUrl + '/index.php?route=product/search&search=' + encoded,
      this.baseUrl + '/search?q=' + encoded
    ];

    if (/deco|router|wifi|wi-fi|mesh|tp[- ]?link/i.test(raw)) {
      candidates.push(this.baseUrl + '/server-networking/shop-routers/tp-link-router');
    }

    if (/mouse/i.test(raw)) {
      candidates.push(this.baseUrl + '/accessories/shop-computer-mouse');
      candidates.push(this.baseUrl + '/accessories/shop-computer-mouse/logitech-mouse-bd');
    }

    if (/keyboard/i.test(raw)) {
      candidates.push(this.baseUrl + '/accessories/computer-keyboard');
    }

    if (/headset|headphone|earbuds/i.test(raw)) {
      candidates.push(this.baseUrl + '/accessories/headphone-speaker/shop-headphones-headsets');
    }

    if (/laptop|notebook/i.test(raw)) {
      candidates.push(this.baseUrl + '/laptop');
    }

    return [...new Set(candidates)];
  }

  extractSitemapUrls(xml, query) {
    const tokens = this.queryTokens(query);
    if (!xml || !tokens.length) return [];

    const urls = [];
    const matches = String(xml).match(/<loc>[^<]+<\/loc>/gi) || [];

    for (const item of matches) {
      const url = item.replace(/^<loc>/i, '').replace(/<\/loc>$/i, '').trim();
      const lower = url.toLowerCase();

      if (!/^https?:\/\/([a-z0-9-]+\.)?techlandbd\.com\//i.test(url)) continue;

      const hits = tokens.filter(token => lower.includes(token)).length;
      if (hits >= Math.min(2, tokens.length)) {
        urls.push({ url, hits });
      }
    }

    return urls
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 8)
      .map(item => item.url);
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
    const deadline = Date.now() + 5600;
    const candidates = this.buildCandidates(query);

    const pageResults = await Promise.allSettled(
      candidates.map(url => this.fetchParsed(url, 1800))
    );

    const unique = new Map();

    for (const result of pageResults) {
      if (result.status !== 'fulfilled') continue;

      for (const product of result.value || []) {
        const key = String(product.url || '').toLowerCase();
        if (key && !unique.has(key)) {
          unique.set(key, product);
        }
      }
    }

    const ranked = Array.from(unique.values())
      .map(product => ({ product, score: this.score(product, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.product.price) - Number(b.product.price));

    if (ranked.length >= 10 || Date.now() >= deadline - 1200) {
      return ranked.slice(0, 30).map(item => item.product);
    }

    try {
      const remaining = deadline - Date.now();
      if (remaining > 900) {
        const sitemap = await this.fetchPage(this.baseUrl + '/sitemap.xml', {
          timeout: Math.min(1200, remaining - 200),
          retries: 0
        });

        const sitemapUrls = this.extractSitemapUrls(sitemap, query);
        const productResults = await Promise.allSettled(
          sitemapUrls.map(url => this.fetchParsed(url, Math.min(1200, Math.max(700, remaining - 300))))
        );

        for (const result of productResults) {
          if (result.status !== 'fulfilled') continue;

          for (const product of result.value || []) {
            const key = String(product.url || '').toLowerCase();
            if (key && !unique.has(key)) {
              unique.set(key, product);
            }
          }
        }
      }
    } catch (_) {
      // Sitemap is only an additional fallback.
    }

    return Array.from(unique.values())
      .map(product => ({ product, score: this.score(product, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.product.price) - Number(b.product.price))
      .slice(0, 30)
      .map(item => item.product);
  }
}

module.exports = TechLandScraper;
