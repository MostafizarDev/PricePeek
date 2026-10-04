const BaseScraper = require('./baseScraper');
const { searchWithCandidates, firstText, firstAttr, makeProduct, parseJsonLd, parseEmbeddedProducts } = require('./scraperUtils');

class PickabooScraper extends BaseScraper {
  constructor() { super('Pickaboo', 'https://www.pickaboo.com'); }

  parseCards($) {
    const products = [];
    const seen = new Set();
    $('a[href]').each((_, anchor) => {
      if (products.length >= 30) return false;
      let url = '';
      try {
        url = this.absoluteUrl($(anchor).attr('href') || '');
        if (!this.isSameHost(url) || !/\/product-detail\//i.test(new URL(url).pathname)) return;
      } catch { return; }

      const $a = $(anchor);
      let $card = $a.closest('[class*="product"], [class*="Product"], article, li');
      if (!$card.length) $card = $a.parent();
      const text = ($card.text() || '').replace(/\s+/g, ' ').trim();
      const name = firstText($card, ['.product-title', '.product-name', '[class*="product-title"]', '[class*="product-name"]', 'h2', 'h3', 'h4']) || $a.attr('title') || $a.find('img').attr('alt') || $a.text().trim();
      const price = firstText($card, ['.price-new', '.sale-price', '.special-price', '.selling-price', '[class*="price"]']);
      const originalPrice = firstText($card, ['del', '.old-price', '.regular-price', '.original-price']);
      const image = firstAttr($card, ['img'], 'src') || firstAttr($card, ['img'], 'data-src') || firstAttr($card, ['img'], 'data-original');
      if (!name || !price) return;
      const key = url.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const p = makeProduct(this, { name, price, originalPrice, url, image, inStock: !/out of stock|stock out|sold out|unavailable/i.test(text), isOfficial: false });
      if (p) products.push(p);
    });
    return products;
  }

  async search(query) {
    const q = encodeURIComponent(String(query).trim());
    const candidates = [
      this.baseUrl + '/search-result/' + q,
      this.baseUrl + '/search?q=' + q,
      this.baseUrl + '/search?query=' + q
    ];
    return searchWithCandidates(this, candidates, $ => {
      let products = this.parseCards($);
      if (!products.length) products = parseJsonLd($, this.baseUrl, this.marketplace);
      if (!products.length) products = parseEmbeddedProducts($, this.baseUrl, this.marketplace);
      return products.filter(p => p && p.url && this.isSameHost(p.url)).slice(0, 30);
    });
  }
}

module.exports = PickabooScraper;
