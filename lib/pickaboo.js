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
    const rawQuery = String(query).trim();
    const encoded = encodeURIComponent(rawQuery);
    const wildcard = '%25' + encoded + '%25';

    // Keep the Pickaboo search inside the API route's 6.5s store budget.
    // The old implementation tried several endpoints sequentially, which
    // could consume the whole budget before returning any result.
    const paths = [
      '/rest/V1/products?searchCriteria[pageSize]=30&searchCriteria[currentPage]=1&searchCriteria[filterGroups][0][filters][0][field]=name&searchCriteria[filterGroups][0][filters][0][conditionType]=like&searchCriteria[filterGroups][0][filters][0][value]=' + wildcard,
      '/rest/default/V1/products?searchCriteria[pageSize]=30&searchCriteria[currentPage]=1&searchCriteria[filterGroups][0][filters][0][field]=name&searchCriteria[filterGroups][0][filters][0][conditionType]=like&searchCriteria[filterGroups][0][filters][0][value]=' + wildcard,
      '/rest/V1/products?searchCriteria[pageSize]=30&searchCriteria[currentPage]=1&searchCriteria[filterGroups][0][filters][0][field]=sku&searchCriteria[filterGroups][0][filters][0][conditionType]=like&searchCriteria[filterGroups][0][filters][0][value]=' + wildcard
    ];

    const results = await Promise.allSettled(
      paths.map(path =>
        this.fetchPage(this.baseUrl + path, { timeout: 2200, retries: 1 })
      )
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      try {
        const payload = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
        const products = this.parseApiProducts(payload);
        if (products.length) return products;
      } catch (error) {
        console.warn('[Pickaboo] API response parse failed: ' + error.message);
      }
    }

    return [];
  }

  async searchFallback(query) {
    const q = encodeURIComponent(String(query).trim());
    const candidates = [
      this.baseUrl + '/search-result/' + q,
      this.baseUrl + '/catalogsearch/result/?q=' + q,
      this.baseUrl + '/search?q=' + q
    ];

    // Try fallback routes in parallel so one slow/dead route cannot block
    // the others and trigger the outer store timeout.
    const results = await Promise.allSettled(
      candidates.map(url =>
        this.fetchPage(url, { timeout: 2200, retries: 1 }).then(html => ({ url, html }))
      )
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value?.html) continue;
      const html = result.value.html;
      try {
        const $ = this.loadHTML(html);
        let products = this.parseCards($);
        if (!products.length) products = parseJsonLd($, this.baseUrl, this.marketplace);
        if (!products.length) products = parseEmbeddedProducts($, this.baseUrl, this.marketplace);
        if (!products.length) {
          const links = this.extractProductLinksFromHtml(html);
          products = [];
          for (const url of links.slice(0, 8)) {
            const product = await this.getProductFromUrl(url);
            if (product) {
              products.push(product);
              if (products.length >= 20) break;
            }
          }
        }
        products = products
          .filter(p => p && p.url && this.isSameHost(p.url))
          .slice(0, 30);
        if (products.length) return products;
      } catch (error) {
        console.warn('[Pickaboo] fallback parse failed: ' + error.message);
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
    return this.searchFallback(query);
  }
}

module.exports = PickabooScraper;
