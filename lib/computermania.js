// lib/computermania.js
const BaseScraper = require('./baseScraper');
const {
  searchWithCandidates,
  firstText,
  firstAttr,
  makeProduct,
  parseJsonLd,
  parseEmbeddedProducts,
  parseGenericLinkedProducts
} = require('./scraperUtils');

class ComputerManiaScraper extends BaseScraper {
  constructor() {
    super('ComputerMania', 'https://computermania.com.bd');
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
      .slice(0, 10);
  }

  isProductUrl(url) {
    try {
      const u = new URL(url);
      return this.isSameHost(url) && /^\/product\//i.test(u.pathname);
    } catch {
      return false;
    }
  }

  parseCards($, query) {
    const products = [];
    const seen = new Set();
    const tokens = this.queryTokens(query);

    $('a[href]').each((_, anchor) => {
      if (products.length >= 30) return false;

      const url = this.absoluteUrl($(anchor).attr('href') || '');
      if (!this.isProductUrl(url)) return;

      const key = url.split('#')[0].replace(/\/$/, '').toLowerCase();
      if (seen.has(key)) return;

      const $a = $(anchor);
      let $card = $a.closest(
        'li.product, .product, .product-item, .product-card, .product-small, article, .woocommerce-loop-product__link'
      );
      if (!$card.length) $card = $a.parent();

      const cardText = ($card.text() || '').replace(/\s+/g, ' ').trim();

      const name =
        firstText($card, [
          '.woocommerce-loop-product__title',
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

      if (!name || name.length < 3 || name.length > 280) return;

      const prices = [...cardText.matchAll(
        /(?:৳|Tk\.?|BDT\.?|Taka)\s*([0-9][0-9,]*(?:\.\d+)?)/gi
      )]
        .map(m => Number(String(m[1]).replace(/,/g, '')))
        .filter(n => Number.isFinite(n) && n > 0);

      const price =
        firstText($card, [
          '.price ins .amount',
          '.price .amount',
          '.woocommerce-Price-amount',
          '.sale-price',
          '.price-new',
          '.special-price',
          '[class*="sale-price"]',
          '[class*="product-price"]',
          '[class*="price"]'
        ]) || (prices.length ? String(prices[0]) : '');

      const originalPrice =
        firstText($card, [
          '.price del .amount',
          '.price del',
          'del',
          '.old-price',
          '.regular-price',
          '[class*="old-price"]',
          '[class*="regular-price"]'
        ]) || (prices.length > 1 ? String(prices[1]) : '');

      const image =
        firstAttr($card, ['img'], 'data-src') ||
        firstAttr($card, ['img'], 'data-lazy-src') ||
        firstAttr($card, ['img'], 'data-original') ||
        firstAttr($card, ['img'], 'src') ||
        '';

      const normalizedName = this.normalize(name);
      const score = tokens.reduce(
        (sum, token) => sum + (normalizedName.includes(token) ? (token.length >= 3 ? 3 : 1) : 0),
        0
      );

      if (tokens.length && score === 0) return;

      const product = makeProduct(this, {
        name,
        price,
        originalPrice,
        url,
        image,
        inStock: !/out of stock|stock out|sold out|unavailable/i.test(cardText),
        isOfficial: true
      });

      if (!product) return;
      product.searchScore = score;
      seen.add(key);
      products.push(product);
    });

    return products.sort(
      (a, b) => (b.searchScore || 0) - (a.searchScore || 0) ||
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

    if (!products.length) {
      products = parseGenericLinkedProducts($, this.baseUrl, this.marketplace)
        .filter(p => p && p.url && this.isProductUrl(p.url));
    }

    const tokens = this.queryTokens(query);
    return products
      .map(product => {
        const n = this.normalize(product.name);
        const score = tokens.reduce(
          (sum, token) => sum + (n.includes(token) ? (token.length >= 3 ? 3 : 1) : 0),
          0
        );
        return { product, score };
      })
      .filter(item => !tokens.length || item.score > 0)
      .sort((a, b) => b.score - a.score || (a.product.price || Infinity) - (b.product.price || Infinity))
      .map(item => item.product)
      .slice(0, 30);
  }

  async search(query) {
    const rawQuery = String(query || '').trim();
    if (!rawQuery) return [];

    const q = encodeURIComponent(rawQuery);
    const normalized = this.normalize(rawQuery);

    // Computer Mania is a WordPress/WooCommerce-style catalog. Try the
    // native product search first, then the shop search and relevant
    // category pages as controlled fallbacks.
    const candidates = [
      this.baseUrl + '/?s=' + q + '&post_type=product',
      this.baseUrl + '/shop/?s=' + q + '&post_type=product',
      this.baseUrl + '/shop/?s=' + q,
      this.baseUrl + '/?post_type=product&s=' + q
    ];

    const categoryMap = [
      ['laptop', '/product-category/laptop/'],
      ['mouse', '/product-category/mouse/'],
      ['keyboard', '/product-category/keyboard/'],
      ['monitor', '/product-category/monitor/'],
      ['headphone', '/product-category/headphone/'],
      ['headset', '/product-category/headphone/'],
      ['earbuds', '/product-category/earbuds/'],
      ['ssd', '/product-category/ssd/'],
      ['ram', '/product-category/ram/'],
      ['graphics', '/product-category/graphics-card/'],
      ['gpu', '/product-category/graphics-card/'],
      ['printer', '/product-category/printer/'],
      ['camera', '/product-category/camera/']
    ];

    for (const [keyword, path] of categoryMap) {
      if (normalized.includes(keyword)) candidates.push(this.baseUrl + path);
    }

    return searchWithCandidates(this, [...new Set(candidates)], $ => this.parsePage($, rawQuery));
  }
}

module.exports = ComputerManiaScraper;
