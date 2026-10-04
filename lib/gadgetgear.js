const BaseScraper = require('./baseScraper');
const { searchWithCandidates, firstText, firstAttr, makeProduct, parseJsonLd, parseEmbeddedProducts } = require('./scraperUtils');

class GadgetGearScraper extends BaseScraper {
  constructor() { super('GadgetGear', 'https://gadgetandgear.com'); }

  parseCards($) {
    const products = [];
    const seen = new Set();
    $('a[href]').each((_, anchor) => {
      if (products.length >= 30) return false;
      let url = '';
      try {
        url = this.absoluteUrl($(anchor).attr('href') || '');
        if (!this.isSameHost(url) || !/\/product\//i.test(new URL(url).pathname)) return;
      } catch { return; }

      const $a = $(anchor);
      let $card = $a.closest('[class*="product"], [class*="Product"], article, li');
      if (!$card.length) $card = $a.parent();
      const text = ($card.text() || '').replace(/\s+/g, ' ').trim();
      const name = firstText($card, ['.product-title', '.product-name', '[class*="product-title"]', '[class*="product-name"]', 'h2', 'h3', 'h4']) || $a.attr('title') || $a.find('img').attr('alt') || $a.text().trim();
      const price = firstText($card, ['.sale-price', '.price-new', '.special-price', '.price', '[class*="price"]']);
      const originalPrice = firstText($card, ['del', '.old-price', '.compare-price', '.regular-price']);
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
    const rawQuery = String(query || '').trim();
    const q = encodeURIComponent(rawQuery);
    const normalized = rawQuery.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    const candidates = [
      this.baseUrl + '/search/' + q,
      this.baseUrl + '/search?q=' + q,
      this.baseUrl + '/shop?search=' + q
    ];

    // Gadget & Gear's current site exposes large brand/category catalog pages.
    // Use those as deterministic fallbacks when the search endpoint is empty,
    // then filter the catalog results against the user's query.
    const brandMatch = normalized.match(/^(?:the\\s+)?([a-z0-9]+)(?:\\s|$)/);
    const brand = brandMatch ? brandMatch[1] : '';
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
      ['ram', '/category/ram']
    ];

    for (const [keyword, path] of categoryMap) {
      if (normalized.includes(keyword)) candidates.push(this.baseUrl + path);
    }

    const uniqueCandidates = [...new Set(candidates)];
    const parseAndRank = $ => {
      let products = this.parseCards($);
      if (!products.length) products = parseJsonLd($, this.baseUrl, this.marketplace);
      if (!products.length) products = parseEmbeddedProducts($, this.baseUrl, this.marketplace);

      const queryTokens = normalized.split(/\\s+/).filter(token => token.length >= 2);
      const ranked = products.map(product => {
        const name = String(product.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
        let score = 0;
        for (const token of queryTokens) {
          if (name.includes(token)) score += token.length >= 3 ? 3 : 1;
        }
        if (brand && name.startsWith(brand + ' ')) score += 4;
        return { product, score };
      });

      return ranked
        .sort((a, b) => b.score - a.score || a.product.price - b.product.price)
        .filter(item => item.score > 0)
        .map(item => item.product)
        .slice(0, 30);
    };

    // Keep the store isolated and within the main 6.5s per-store budget.
    const deadline = Date.now() + 5000;
    for (const url of uniqueCandidates) {
      const remaining = deadline - Date.now();
      if (remaining < 500) break;
      try {
        const html = await this.fetchPage(url, { timeout: Math.min(2200, remaining), retries: 0 });
        if (!html) continue;
        const products = parseAndRank(this.loadHTML(html));
        if (products.length) return products;
      } catch (error) {
        console.warn('[GadgetGear] ' + error.message);
      }
    }

    return [];
  }
}

module.exports = GadgetGearScraper;
