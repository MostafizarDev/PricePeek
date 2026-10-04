const BaseScraper = require('./baseScraper');
const {
  searchWithCandidates,
  firstText,
  firstAttr,
  makeProduct,
  parseJsonLd,
  parseEmbeddedProducts
} = require('./scraperUtils');

class PickabooScraper extends BaseScraper {
  constructor() {
    super('Pickaboo', 'https://www.pickaboo.com');
  }

  getCustomAttribute(item, code) {
    const attrs = Array.isArray(item?.custom_attributes) ? item.custom_attributes : [];
    const found = attrs.find(attr => String(attr?.attribute_code || '').toLowerCase() === code.toLowerCase());
    return found?.value ?? '';
  }

  parseApiProducts(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const products = [];
    const seen = new Set();

    for (const item of items) {
      const name = String(item?.name || '').replace(/\s+/g, ' ').trim();
      const price = Number(item?.price);
      if (!name || !Number.isFinite(price) || price <= 0) continue;

      const urlKey = this.getCustomAttribute(item, 'url_key') || this.getCustomAttribute(item, 'url_path');
      const rawUrl = urlKey
        ? (String(urlKey).startsWith('http') ? urlKey : this.baseUrl + '/product-detail/' + String(urlKey).replace(/^\/+/, ''))
        : '';

      const media = Array.isArray(item?.media_gallery_entries) ? item.media_gallery_entries : [];
      const imageEntry = media.find(entry => entry?.file) || media[0];
      const image = imageEntry?.file
        ? (String(imageEntry.file).startsWith('http') ? imageEntry.file : this.baseUrl + '/media/catalog/product' + (String(imageEntry.file).startsWith('/') ? '' : '/') + imageEntry.file)
        : '';

      const stockItem = item?.extension_attributes?.stock_item;
      const inStock = stockItem?.is_in_stock !== false;

      if (!rawUrl || !this.isSameHost(rawUrl)) continue;
      const key = rawUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const product = makeProduct(this, {
        name,
        price,
        originalPrice: price,
        url: rawUrl,
        image,
        inStock,
        isOfficial: false
      });

      if (product) products.push(product);
      if (products.length >= 30) break;
    }

    return products;
  }

  async searchApi(query) {
    const encoded = encodeURIComponent(String(query).trim());
    const queries = [
      '/rest/V1/products?searchCriteria[pageSize]=30&searchCriteria[currentPage]=1&searchCriteria[filterGroups][0][filters][0][field]=name&searchCriteria[filterGroups][0][filters][0][conditionType]=like&searchCriteria[filterGroups][0][filters][0][value]=%25' + encoded + '%25',
      '/rest/default/V1/products?searchCriteria[pageSize]=30&searchCriteria[currentPage]=1&searchCriteria[filterGroups][0][filters][0][field]=name&searchCriteria[filterGroups][0][filters][0][conditionType]=like&searchCriteria[filterGroups][0][filters][0][value]=%25' + encoded + '%25'
    ];

    for (const path of queries) {
      try {
        const raw = await this.fetchPage(this.baseUrl + path, { timeout: 3500, retries: 1 });
        if (!raw) continue;

        const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const products = this.parseApiProducts(payload);
        if (products.length) return products;
      } catch (error) {
        console.warn('[Pickaboo] API search failed: ' + error.message);
      }
    }

    return [];
  }

  parseCards($) {
    const products = [];
    const seen = new Set();

    $('a[href]').each((_, anchor) => {
      if (products.length >= 30) return false;

      let url = '';
      try {
        url = this.absoluteUrl($(anchor).attr('href') || '');
        if (!this.isSameHost(url) || !/\/product-detail\//i.test(new URL(url).pathname)) return;
      } catch {
        return;
      }

      const $a = $(anchor);
      let $card = $a.closest('[class*="product"], [class*="Product"], article, li');
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
        $a.text().trim();

      const price = firstText($card, [
        '.price-new',
        '.sale-price',
        '.special-price',
        '.selling-price',
        '[class*="price"]'
      ]);
      const originalPrice = firstText($card, [
        'del',
        '.old-price',
        '.regular-price',
        '.original-price'
      ]);
      const image =
        firstAttr($card, ['img'], 'src') ||
        firstAttr($card, ['img'], 'data-src') ||
        firstAttr($card, ['img'], 'data-original');

      if (!name || !price) return;

      const key = url.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      const p = makeProduct(this, {
        name,
        price,
        originalPrice,
        url,
        image,
        inStock: !/out of stock|stock out|sold out|unavailable/i.test(text),
        isOfficial: false
      });

      if (p) products.push(p);
    });

    return products;
  }

  async search(query) {
    const apiProducts = await this.searchApi(query);
    if (apiProducts.length) return apiProducts;

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
      return products
        .filter(p => p && p.url && this.isSameHost(p.url))
        .slice(0, 30);
    });
  }
}

module.exports = PickabooScraper;
