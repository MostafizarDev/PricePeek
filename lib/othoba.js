const BaseScraper = require('./baseScraper');
const { searchWithCandidates, firstText, firstAttr, makeProduct, parseJsonLd, parseEmbeddedProducts } = require('./scraperUtils');

class OthobaScraper extends BaseScraper {
  constructor() { super('Othoba', 'https://othoba.com'); }

  parseCards($) {
    const products = [];
    const seen = new Set();
    $('a[href]').each((_, anchor) => {
      if (products.length >= 30) return false;
      let url = '';
      try {
        url = this.absoluteUrl($(anchor).attr('href') || '');
        if (!this.isSameHost(url) || !/(?:\/p\/|\/product\/|\/products\/|\/item\/)/i.test(new URL(url).pathname)) return;
      } catch { return; }
      const $a = $(anchor);
      let $card = $a.closest('[class*="product"], [class*="Product"], article, li');
      if (!$card.length) $card = $a.parent();
      const text = ($card.text() || '').replace(/\s+/g, ' ').trim();
      const name = firstText($card, ['.product-name', '.product-title', '[class*="product-name"]', '[class*="product-title"]', 'h2', 'h3', 'h4']) || $a.attr('title') || $a.find('img').attr('alt') || $a.text().trim();
      const price = firstText($card, ['.sale-price', '.price-new', '.special-price', '.price', '[class*="price"]']);
      const originalPrice = firstText($card, ['del', '.old-price', '.regular-price', '.original-price']);
      const image = firstAttr($card, ['img'], 'src') || firstAttr($card, ['img'], 'data-src') || firstAttr($card, ['img'], 'data-original');
      if (!name || !price || seen.has(url.toLowerCase())) return;
      seen.add(url.toLowerCase());
      const p = makeProduct(this, { name, price, originalPrice, url, image, inStock: !/out of stock|stock out|sold out|unavailable/i.test(text), isOfficial: false });
      if (p) products.push(p);
    });
    return products;
  }

  async search(query) {
    const q = encodeURIComponent(String(query).trim());
    const candidates = [
      this.baseUrl + '/ts/search/' + q + '/?pagenumber=1&q=' + q + '&t=t',
      this.baseUrl + '/search?text=' + q,
      this.baseUrl + '/search?q=' + q
    ];
    return searchWithCandidates(this, candidates, $ => {
      let products = this.parseCards($);
      if (!products.length) products = parseJsonLd($, this.baseUrl, this.marketplace);
      if (!products.length) products = parseEmbeddedProducts($, this.baseUrl, this.marketplace);
      return products.filter(p => p && p.url && this.isSameHost(p.url)).slice(0, 30);
    });
  }
}

module.exports = OthobaScraper;
