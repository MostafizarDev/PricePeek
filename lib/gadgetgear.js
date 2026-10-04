const BaseScraper = require('./baseScraper');
const {
  firstText,
  firstAttr,
  makeProduct,
  parseJsonLd,
  parseEmbeddedProducts
} = require('./scraperUtils');

class GadgetGearScraper extends BaseScraper {
  constructor() {
    super('GadgetGear', 'https://gadgetandgear.com');
  }

  normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  queryTokens(query) {
    return this.normalize(query)
      .split(/\s+/)
      .filter(token => token.length >= 2)
      .slice(0, 12);
  }

  isProductUrl(url) {
    try {
      const u = new URL(url);
      return this.isSameHost(url) && /^\/product\/[^/]+/i.test(u.pathname);
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

      const key = url.split('#')[0].replace(/\/$/, '').toLowerCase();
      if (seen.has(key)) return;

      const $a = $(anchor);
      let $card = $a.closest(
        '[class*="product-card"], [class*="product-item"], [class*="product"], article, li'
      );
      if (!$card.length) $card = $a.parent();

      const text = ($card.text() || '').replace(/\s+/g, ' ').trim();
      const name =
        firstText($card, [
          '.product-title',
          '.product-name',
          '[class*="product-title"]',
          '[class*="product-name"]',
          'h2',
          'h3',
          'h4'
        ]) ||
        $a.attr('title') ||
        $a.find('img').attr('alt') ||
        $a.text().replace(/\s+/g, ' ').trim();

      const prices = [...text.matchAll(/(?:৳|Tk\.?|BDT\.?|Taka)\s*([0-9][0-9,]*(?:\.\d+)?)/gi)]
        .map(m => Number(String(m[1]).replace(/,/g, '')))
        .filter(n => Number.isFinite(n) && n > 0);

      const price =
        firstText($card, [
          '.sale-price',
          '.price-new',
          '.special-price',
          '.price',
          '[class*="sale-price"]',
          '[class*="selling-price"]',
          '[class*="price"]'
        ]) || (prices.length ? String(prices[0]) : '');

      const originalPrice =
        firstText($card, [
          'del',
          '.old-price',
          '.compare-price',
          '.regular-price',
          '[class*="old-price"]'
        ]) || (prices.length > 1 ? String(prices[1]) : '');

      const image =
        firstAttr($card, ['img'], 'src') ||
        firstAttr($card, ['img'], 'data-src') ||
        firstAttr($card, ['img'], 'data-original') ||
        firstAttr($card, ['img'], 'data-lazy-src') ||
        '';

      if (!name || !price) return;

      const normalizedName = this.normalize(name);
      const score = tokens.reduce((sum, token) => {
        return sum + (normalizedName.includes(token) ? (token.length >= 3 ? 3 : 1) : 0);
      }, 0);

      if (tokens.length && score === 0) return;

      const product = makeProduct(this, {
        name,
        price,
        originalPrice,
        url,
        image,
        inStock: !/out of stock|stock out|sold out|unavailable/i.test(text),
        isOfficial: true
      });

      if (product) {
        product.searchScore = score;
        seen.add(key);
        products.push(product);
      }
    });

    return products.sort((a, b) =>
      (b.searchScore || 0) - (a.searchScore || 0) ||
      (a.price || Infinity) - (b.price || Infinity)
    );
  }

  parsePage($, query) {
    let products = this.parseCards($, query);

    if (!products.length) {
      products = parseJsonLd($, this.baseUrl, this.marketplace)
        .filter(p => p && p.url && this.isProductUrl(p.url))
        .map(p => ({ ...p, isOfficial: true }));
    }

    if (!products.length) {
      products = parseEmbeddedProducts($, this.baseUrl, this.marketplace)
        .filter(p => p && p.url && this.isProductUrl(p.url))
        .map(p => ({ ...p, isOfficial: true }));
    }

    const tokens = this.queryTokens(query);
    return products
      .map(product => {
        const n = this.normalize(product.name);
        const score = tokens.reduce((sum, token) => sum + (n.includes(token) ? (token.length >= 3 ? 3 : 1) : 0), 0);
        return { product, score };
      })
      .filter(item => !tokens.length || item.score > 0)
      .sort((a, b) => b.score - a.score || (a.product.price || Infinity) - (b.product.price || Infinity))
      .map(item => item.product)
      .slice(0, 30);
  }

  slugify(query) {
    return this.normalize(query).replace(/\s+/g, '-');
  }

  async search(query) {
    const rawQuery = String(query || '').trim();
    if (!rawQuery) return [];

    const q = encodeURIComponent(rawQuery);
    const normalized = this.normalize(rawQuery);
    const candidates = [
      this.baseUrl + '/search/' + q,
      this.baseUrl + '/search/' + this.slugify(rawQuery),
      this.baseUrl + '/search?q=' + q,
      this.baseUrl + '/search?query=' + q,
      this.baseUrl + '/shop?search=' + q
    ];

    // Current Gadget & Gear catalog pages are reliable fallbacks.
    const brand = this.queryTokens(rawQuery)[0] || '';
    if (brand) {
      candidates.push(this.baseUrl + '/brand/' + encodeURIComponent(brand));
    }

    const categoryMap = [
      ['mouse', '/category/mouse'],
      ['keyboard', '/category/keyboard'],
      ['headphone', '/category/headphone'],
      ['headphones', '/category/headphone'],
      ['headset', '/category/headphone'],
      ['earbuds', '/category/earbuds'],
      ['laptop', '/category/laptop'],
      ['monitor', '/category/monitor'],
      ['phone', '/category/mobile-phone'],
      ['smartphone', '/category/mobile-phone'],
      ['tablet', '/category/tablet'],
      ['camera', '/category/camera'],
      ['router', '/category/router'],
      ['ssd', '/category/ssd'],
      ['ram', '/category/ram'],
      ['gaming', '/category/video-games']
    ];

    for (const [keyword, path] of categoryMap) {
      if (normalized.includes(keyword)) candidates.push(this.baseUrl + path);
    }

    // For common exact product searches, the current site uses a stable
    // /product/<slug> URL. This gives us a deterministic last-mile lookup.
    candidates.push(this.baseUrl + '/product/' + this.slugify(rawQuery));

    const uniqueCandidates = [...new Set(candidates)];
    const deadline = Date.now() + 5000;

    for (const url of uniqueCandidates) {
      const remaining = deadline - Date.now();
      if (remaining < 500) break;

      try {
        const html = await this.fetchPage(url, {
          timeout: Math.min(2200, remaining),
          retries: 0
        });
        if (!html) continue;

        const products = this.parsePage(this.loadHTML(html), rawQuery);
        if (products.length) return products;
      } catch (error) {
        console.warn('[GadgetGear] ' + error.message);
      }
    }

    return [];
  }
}

module.exports = GadgetGearScraper;
