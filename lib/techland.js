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
      let rawUrl = firstAttr($e, ['a'], 'href');
      let url = '';
      try {
        url = this.absoluteUrl(rawUrl || '');
      } catch {
        url = '';
      }

      if (!url || !this.isSameHost(url)) return;

      const path = new URL(url).pathname.toLowerCase();
      if (/\/(category|search|brand|cart|checkout|login|register|wishlist|compare|blog|news|about|contact)(\/|$)/i.test(path)) return;

      const text = ($e.text() || '').replace(/\s+/g, ' ').trim();
      const name =
        firstText($e, [
          '.caption h4',
          '.product-title',
          '.product-name',
          '.name',
          'h2',
          'h3',
          'h4'
        ]) ||
        $e.find('a[title]').first().attr('title') ||
        $e.find('img').first().attr('alt') ||
        '';

      const price =
        firstText($e, [
          '.price-new',
          '.special-price',
          '.sale-price',
          '.price',
          '[class*="price"]'
        ]) ||
        (text.match(/(?:৳|Tk\.?|BDT\.?|\bTaka\b)\s*[0-9][0-9,]*/i) || [])[0] ||
        '';

      const originalPrice =
        firstText($e, [
          '.price-old',
          '.old-price',
          '.regular-price',
          'del'
        ]);

      const image =
        firstAttr($e, ['img'], 'src') ||
        firstAttr($e, ['img'], 'data-src') ||
        firstAttr($e, ['img'], 'data-lazy-src') ||
        firstAttr($e, ['img'], 'data-original');

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

  rankProducts(products, query) {
    const tokens = String(query)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(token => token.length >= 2);

    return products
      .map(product => {
        const name = String(product.name || '').toLowerCase();
        const score = tokens.reduce((total, token) => {
          if (name.includes(token)) return total + (token.length >= 4 ? 4 : 2);
          return total;
        }, 0);

        return { product, score };
      })
      .sort((a, b) => b.score - a.score || a.product.price - b.product.price)
      .map(item => item.product);
  }

  buildCandidates(query) {
    const q = encodeURIComponent(String(query).trim());
    const raw = String(query).trim().toLowerCase();
    const candidates = [
      this.baseUrl + '/search?search=' + q,
      this.baseUrl + '/index.php?route=product/search&search=' + q,
      this.baseUrl + '/search?q=' + q
    ];

    const brandMap = [
      ['tp-link', '/tp-link'],
      ['tplink', '/tp-link'],
      ['logitech', '/logitech-brand'],
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
    if (brand) candidates.push(this.baseUrl + brand[1]);

    if (/deco|router|wifi|wi-fi|mesh/i.test(raw)) {
      candidates.push(this.baseUrl + '/server-networking/shop-routers/tp-link-router');
    } else if (/mouse|keyboard|headset|headphone|earbuds|webcam/i.test(raw)) {
      candidates.push(this.baseUrl + '/accessories');
    } else if (/laptop|notebook/i.test(raw)) {
      candidates.push(this.baseUrl + '/laptop');
    }

    return [...new Set(candidates)];
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
      .slice(0, 30);
  }

  async search(query) {
    const candidates = this.buildCandidates(query);
    const products = await searchWithCandidates(this, candidates, $ => this.parsePage($));
    return this.rankProducts(products, query).slice(0, 30);
  }
}

module.exports = TechLandScraper;
