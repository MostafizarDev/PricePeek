// lib/cartup.js
const BaseScraper = require('./baseScraper');
const {
  searchWithCandidates,
  firstText,
  firstAttr,
  makeProduct,
  parseJsonLd,
  parseEmbeddedProducts
} = require('./scraperUtils');

class CartupScraper extends BaseScraper {
  constructor() {
    super('Cartup', 'https://cartup.com');
  }

  cleanUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return '';
    }
  }

  isProductUrl(url) {
    try {
      const parsed = new URL(url);
      return this.isSameHost(url) && /^\/product\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  extractBrand(name, $card) {
    const explicit = firstText($card, [
      '[itemprop="brand"]',
      '.brand',
      '.product-brand',
      '[class*="brand"]'
    ]);
    if (explicit) return explicit;

    const value = String(name || '').trim();
    const knownBrands = [
      'Logitech', 'A4Tech', 'Fantech', 'Razer', 'HP', 'Dell', 'Lenovo',
      'Asus', 'ASUS', 'Apple', 'Samsung', 'Xiaomi', 'Redmi', 'Anker',
      'Baseus', 'Havit', 'Rapoo', 'Corsair', 'JBL', 'Sony', 'UGREEN',
      'TP-Link', 'Tenda', 'MSI', 'Gigabyte', 'AOC', 'Acer', 'Walton',
      'Vision', 'Singer', 'Philips', 'Panasonic', 'Miyako'
    ];

    const lower = value.toLowerCase();
    return knownBrands.find(brand => lower.startsWith(brand.toLowerCase() + ' ') || lower === brand.toLowerCase()) || null;
  }

  parseSearchResults($) {
    const products = [];
    const seen = new Set();

    const add = data => {
      const product = makeProduct(this, data);
      if (!product || !product.url || !this.isProductUrl(product.url)) return;

      const key = this.cleanUrl(product.url).replace(/\/$/, '').toLowerCase();
      if (!key || seen.has(key)) return;

      seen.add(key);
      products.push(product);
    };

    // Cartup product URLs are the most stable signal:
    // https://cartup.com/product/<slug>_<numeric-id>_<suffix>
    $('a[href*="/product/"]').each((_, anchor) => {
      if (products.length >= 30) return false;

      const href = $(anchor).attr('href') || '';
      const url = this.cleanUrl(this.absoluteUrl(href));
      if (!this.isProductUrl(url)) return;

      const $a = $(anchor);
      let $card = $a.closest(
        '[class*="product-card"], [class*="product-item"], [class*="product"], article, li'
      );

      if (!$card.length) $card = $a.parent();
      if (!$card.length) return;

      const cardText = ($card.text() || '').replace(/\s+/g, ' ').trim();

      const name =
        firstText($card, [
          '[itemprop="name"]',
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

      if (!name || name.length < 3 || name.length > 300) return;

      const prices = [...cardText.matchAll(
        /(?:৳|Tk\.?|BDT\.?|Taka)\s*([0-9][0-9,]*(?:\.\d+)?)/gi
      )]
        .map(match => Number(String(match[1]).replace(/,/g, '')))
        .filter(value => Number.isFinite(value) && value > 0);

      const priceText = firstText($card, [
        '.price-new',
        '.sale-price',
        '.selling-price',
        '.special-price',
        '[class*="sale-price"]',
        '[class*="selling-price"]',
        '[class*="current-price"]',
        '[class*="product-price"]',
        '[class*="price"]'
      ]);

      const oldPriceText = firstText($card, [
        'del',
        '.price-old',
        '.old-price',
        '.regular-price',
        '[class*="old-price"]',
        '[class*="regular-price"]'
      ]);

      const price = priceText || (prices.length ? String(prices[0]) : '');
      const originalPrice = oldPriceText || (prices.length > 1 ? String(prices[1]) : '');

      const image =
        firstAttr($card, ['img'], 'src') ||
        firstAttr($card, ['img'], 'data-src') ||
        firstAttr($card, ['img'], 'data-lazy-src') ||
        firstAttr($card, ['img'], 'data-original') ||
        firstAttr($card, ['img'], 'data-srcset') ||
        $a.find('img').attr('src') ||
        '';

      const lowerText = cardText.toLowerCase();
      const official = /official store|official seller|verified seller|mall|authorized/i.test(cardText);

      add({
        name,
        price,
        originalPrice,
        url,
        image,
        brand: this.extractBrand(name, $card),
        inStock: !/out of stock|stock out|sold out|unavailable/i.test(lowerText),
        isOfficial: official
      });
    });

    return products;
  }

  parseEmbedded($) {
    const products = parseEmbeddedProducts($, this.baseUrl, this.marketplace)
      .filter(product => this.isProductUrl(product.url));

    return products.map(product => ({
      ...product,
      isOfficial: false
    }));
  }

  parseJson($) {
    const products = parseJsonLd($, this.baseUrl, this.marketplace)
      .filter(product => this.isProductUrl(product.url));

    return products.map(product => ({
      ...product,
      isOfficial: false
    }));
  }

  async search(query) {
    const q = encodeURIComponent(String(query || '').trim());

    // Cartup's storefront/search implementation can change route naming.
    // Try the common SSR search routes in order, then fall back to embedded/JSON-LD data.
    const candidates = [
      `${this.baseUrl}/search?query=${q}`,
      `${this.baseUrl}/search?q=${q}`,
      `${this.baseUrl}/search?keyword=${q}`,
      `${this.baseUrl}/search?search=${q}`,
      `${this.baseUrl}/search?term=${q}`,
      `${this.baseUrl}/?q=${q}`,
      `${this.baseUrl}/?query=${q}`
    ];

    return searchWithCandidates(this, candidates, $ => {
      let products = this.parseSearchResults($);

      if (!products.length) products = this.parseJson($);
      if (!products.length) products = this.parseEmbedded($);

      const unique = new Map();
      for (const product of products) {
        if (!product || !product.name || !product.price || !product.url) continue;

        const key = this.cleanUrl(product.url).replace(/\/$/, '').toLowerCase();
        if (!this.isProductUrl(key)) continue;

        if (!unique.has(key)) unique.set(key, product);
      }

      return Array.from(unique.values()).slice(0, 30);
    });
  }

  async getProductFromUrl(url) {
    try {
      const productUrl = this.cleanUrl(url);
      if (!this.isProductUrl(productUrl)) return null;

      const html = await this.fetchPage(productUrl, { timeout: 4500, retries: 1 });
      if (!html) return null;

      const $ = this.loadHTML(html);
      const pageText = $('body').text().replace(/\s+/g, ' ').trim();

      const name = firstText($, [
        'h1',
        '[itemprop="name"]',
        '.product-title',
        '.product-name',
        '[class*="product-title"]',
        '[class*="product-name"]'
      ]);

      const prices = [...pageText.matchAll(
        /(?:৳|Tk\.?|BDT\.?|Taka)\s*([0-9][0-9,]*(?:\.\d+)?)/gi
      )]
        .map(match => Number(String(match[1]).replace(/,/g, '')))
        .filter(value => Number.isFinite(value) && value > 0);

      const price = firstText($, [
        '.price-new',
        '.sale-price',
        '.selling-price',
        '.special-price',
        '[class*="current-price"]',
        '[class*="selling-price"]',
        '[class*="product-price"]',
        '[class*="price"]'
      ]) || (prices.length ? String(prices[0]) : '');

      const originalPrice = firstText($, [
        'del',
        '.price-old',
        '.old-price',
        '.regular-price',
        '[class*="old-price"]',
        '[class*="regular-price"]'
      ]) || (prices.length > 1 ? String(prices[1]) : '');

      const image =
        firstAttr($, ['meta[property="og:image"]'], 'content') ||
        firstAttr($, ['img'], 'src') ||
        firstAttr($, ['img'], 'data-src') ||
        '';

      const sellerName = firstText($, [
        '[class*="seller"]',
        '[class*="store"]',
        '[class*="shop"]'
      ]) || null;

      const sellerRating = firstText($, [
        '[class*="seller-rating"]',
        '[class*="positive-seller"]'
      ]) || null;

      const inStock = !/out of stock|stock out|sold out|temporarily unavailable|unavailable/i.test(pageText);
      const official = /official store|official seller|authorized/i.test(pageText);

      const product = makeProduct(this, {
        name,
        price,
        originalPrice,
        url: productUrl,
        image,
        inStock,
        isOfficial: official
      });

      if (!product) return null;

      return {
        ...product,
        sellerName,
        sellerRating
      };
    } catch (error) {
      console.warn('[Cartup] getProductFromUrl failed:', error.message);
      return null;
    }
  }
}

module.exports = CartupScraper;
