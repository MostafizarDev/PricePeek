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

class AppleGadgetsScraper extends BaseScraper {
  constructor() {
    super('AppleGadgets', 'https://www.applegadgetsbd.com');
  }

  parseSearchResults($) {
    const products = [];
    const seen = new Set();

    const addProduct = (data) => {
      const product = makeProduct(this, data);
      if (!product || !product.url || !this.isSameHost(product.url)) return;
      const key = product.url.split('#')[0].replace(/\/$/, '').toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      products.push(product);
    };

    // Apple Gadgets product cards can change their utility class names.
    // Anchor URLs are more stable, so use /product/ links as the primary signal.
    $('a[href]').each((_, anchor) => {
      if (products.length >= 30) return false;

      const href = $(anchor).attr('href') || '';
      let url = '';
      try {
        url = this.absoluteUrl(href);
        if (!this.isSameHost(url) || !/\/product\//i.test(new URL(url).pathname)) return;
      } catch {
        return;
      }

      const $a = $(anchor);
      let $card = $a.closest(
        '[class*="product-card"], [class*="product-item"], [class*="product-card-wrapper"], article, li'
      );
      if (!$card.length) $card = $a.parent();

      const cardText = ($card.text() || '').replace(/\s+/g, ' ').trim();
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

      if (!name || name.length < 3 || name.length > 260) return;

      const prices = [...cardText.matchAll(
        /(?:৳|Tk\.?|BDT\.?|Taka)\s*([0-9][0-9,]*(?:\.\d+)?)/gi
      )]
        .map(match => Number(String(match[1]).replace(/,/g, '')))
        .filter(value => Number.isFinite(value) && value > 0);

      const price =
        firstText($card, [
          '.price-new',
          '.sale-price',
          '.special-price',
          '.product-price',
          '[class*="sale-price"]',
          '[class*="selling-price"]',
          '[class*="product-price"]',
          '[class*="price"]'
        ]) || (prices.length ? String(prices[0]) : '');

      const originalPrice =
        firstText($card, [
          'del',
          '.price-old',
          '.old-price',
          '.regular-price',
          '[class*="old-price"]',
          '[class*="regular-price"]'
        ]) || (prices.length > 1 ? String(prices[1]) : '');

      const image =
        firstAttr($card, ['img'], 'src') ||
        firstAttr($card, ['img'], 'data-src') ||
        firstAttr($card, ['img'], 'data-lazy-src') ||
        firstAttr($card, ['img'], 'data-original') ||
        firstAttr($card, ['img'], 'data-srcset') ||
        $a.find('img').attr('src') ||
        '';

      addProduct({
        name,
        price,
        originalPrice,
        url,
        image,
        inStock: !/out of stock|stock out|sold out|unavailable/i.test(cardText),
        isOfficial: true
      });
    });

    return products;
  }

  async search(query) {
    const q = encodeURIComponent(String(query).trim());
    const candidates = [
      'https://www.applegadgetsbd.com/search?query={q}'.replace('{q}', q),
      'https://www.applegadgetsbd.com/search?q={q}'.replace('{q}', q),
      'https://www.applegadgetsbd.com/?s={q}'.replace('{q}', q)
    ];

    return searchWithCandidates(this, candidates, $ => {
      let products = this.parseSearchResults($);

      // Keep JSON-LD / embedded-data fallbacks because the storefront can
      // render product cards differently between pages.
      if (!products.length) {
        products = parseJsonLd($, this.baseUrl, this.marketplace);
      }
      if (!products.length) {
        products = parseEmbeddedProducts($, this.baseUrl, this.marketplace);
      }
      if (!products.length) {
        products = parseGenericLinkedProducts($, this.baseUrl, this.marketplace);
      }

      const unique = new Map();
      for (const product of products) {
        if (!product || !product.url || !product.name || !product.price) continue;
        const key = product.url.split('#')[0].replace(/\/$/, '').toLowerCase();
        if (!unique.has(key)) unique.set(key, product);
      }

      return Array.from(unique.values()).slice(0, 30);
    });
  }
}

module.exports = AppleGadgetsScraper;
