const BaseScraper = require('./baseScraper');
const axios = require('axios');

class DarazScraper extends BaseScraper {
  constructor() { super('Daraz', 'https://www.daraz.com.bd'); }


  normalizeProductUrl(rawUrl) {
    let value = String(rawUrl || '').trim();
    if (!value) return '';

    // Daraz can sometimes return a relative URL that already contains
    // the hostname, e.g. /www.daraz.com.bd/products/...
    // Do not prepend the base URL twice in that case.
    if (/^https?:\/\/(?:www\.)?daraz\.com\.bd\//i.test(value)) {
      return value;
    }
    if (/^\/+?(?:www\.)?daraz\.com\.bd\//i.test(value)) {
      value = value.replace(/^\/+/, '');
      return 'https://' + value;
    }
    if (/^(?:www\.)?daraz\.com\.bd\//i.test(value)) {
      return 'https://' + value;
    }
    if (/^\/+products\//i.test(value)) {
      return this.baseUrl + value.replace(/^\/+/, '/');
    }
    if (/^products\//i.test(value)) {
      return this.baseUrl + '/' + value;
    }
    if (/^\/+/i.test(value)) {
      return this.baseUrl + value.replace(/^\/+/, '/');
    }
    return value;
  }

  async search(query) {
    // প্রথমে JSON API চেষ্টা (দ্রুত ও নির্ভরযোগ্য)
    try {
      const jsonUrl = `${this.baseUrl}/catalog/?ajax=true&q=${encodeURIComponent(query)}`;
      console.log(`[Daraz] Trying JSON API: ${jsonUrl}`);
      const response = await axios.get(jsonUrl, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
        },
        timeout: 10000,
      });
      const data = response.data;
      if (data && data.mods && data.mods.listItems) {
        const products = [];
        data.mods.listItems.slice(0, 15).forEach((item, i) => {
          const name = item.name || '';
          const price = this.parsePrice(item.priceShow || item.price);
          const originalPrice = this.parsePrice(item.originalPriceShow || item.originalPrice);
          const image = item.image || '';
          const url = this.normalizeProductUrl(item.productUrl || item.itemUrl);

          // রেটিং, রিভিউ, বিক্রির সংখ্যা (JSON থেকে সরাসরি)
          const rating = parseFloat(item.ratingScore) || null;
          const reviewCount = parseInt(item.review) || null;
          const soldCount = parseInt(item.soldCount) || null;

          if (name && price) {
            products.push({
              id: `daraz_json_${item.itemId || i}`,
              name: this.cleanProductName(name),
              marketplace: this.marketplace,
              price,
              originalPrice: originalPrice || price,
              discount: this.parseDiscount(price, originalPrice),
              image,
              url,
              inStock: true,
              isOfficial: item.sellerName && item.sellerName.toLowerCase().includes('official'),
              rating,
              reviewCount,
              soldCount,
              coupons: [],
              cashback: [],
            });
          }
        });
        if (products.length > 0) return products;
      }
    } catch (err) {
      console.log('[Daraz] JSON API failed, trying HTML fallback');
    }

    // HTML ফলব্যাক
    const products = [];
    try {
      const url = `${this.baseUrl}/catalog/?q=${encodeURIComponent(query)}`;
      const html = await this.fetchPage(url);
      if (!html) return products;
      const $ = this.loadHTML(html);

      const selectors = [
        '[data-qa-locator="product-item"]',
        '.Bm3ON',
        '.gridItem--Yd0sa',
        '.buTCk',
        '.RfADt',
        '.c2prKC',
        '.product-card'
      ];

      for (const sel of selectors) {
        $(sel).each((i, el) => {
          if (i >= 15) return false;
          try {
            const $el = $(el);
            const name = this.cleanProductName(
              $el.find('.title--wFj93, .RfADt a, .title-wrapper--IaQ0m a, .c16H9d a').text()
            );
            const price = this.parsePrice(
              $el.find('.price--NVB62, .ooOxS, .price-wrapper--Ii6aY, .c13VH6').text()
            );
            const originalPrice = this.parsePrice(
              $el.find('.originalPrice--aY4fQ, .crossPrice').text()
            );
            const image = $el.find('img').attr('src') || $el.find('img').attr('data-src');
            const link = $el.find('a').attr('href') || '';
            const fullUrl = link.startsWith('http') ? link : this.baseUrl + link;

            // HTML থেকে রেটিং/রিভিউ ধরার চেষ্টা (সব সময় নাও থাকতে পারে)
            const ratingText = $el.find('.rating__number, .ratig--aY4fQ').text();
            const rating = parseFloat(ratingText) || null;
            const reviewText = $el.find('.review__count, .rating__review-count').text();
            const reviewCount = parseInt(reviewText) || null;
            // বিক্রির সংখ্যা HTML থেকে সাধারণত পাওয়া যায় না

            if (name && price) {
              products.push({
                id: `daraz_html_${Date.now()}_${i}`,
                name,
                marketplace: this.marketplace,
                price,
                originalPrice: originalPrice || price,
                discount: this.parseDiscount(price, originalPrice),
                image,
                url: fullUrl,
                inStock: true,
                isOfficial: $el.text().includes('Mall'),
                rating,
                reviewCount,
                soldCount: null,
                coupons: [],
                cashback: [],
              });
            }
          } catch (e) {}
        });
        if (products.length > 0) break;
      }
    } catch (err) {
      console.error('[Daraz] HTML fallback error:', err.message);
    }

    return products;
  }

  async getProductFromUrl(url) {
    try {
      const html = await this.fetchPage(url);
      if (!html) return null;
      const $ = this.loadHTML(html);
      const name = this.cleanProductName(
        $('.pdp-mod-product-badge-title, h1, .product-title').first().text()
      );
      const price = this.parsePrice(
        $('.pdp-price_color_orange, .pdp-price, .price').first().text()
      );
      const originalPrice = this.parsePrice(
        $('.pdp-price_color_lightgray, .pdp-price-del, .old-price').text()
      );
      const image = $('.pdp-mod-common-image img, .gallery-preview-panel img').first().attr('src');
      return {
        name,
        price,
        originalPrice: originalPrice || price,
        image,
        url,
        marketplace: this.marketplace,
        inStock: true,
      };
    } catch (err) {
      console.error(`[Daraz] getProductFromUrl error:`, err.message);
      return null;
    }
  }
}

module.exports = DarazScraper;
