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

  normalizeSeller(item = {}) {
    const sellerName = item.sellerName || item.shopName || item.seller_name || null;
    const sellerId = item.sellerId || item.seller_id || item.sellerIdStr || item.shopId || item.shop_id || null;
    const sellerUrl = this.normalizeProductUrl(item.sellerUrl || item.shopUrl || item.seller_url || item.shop_url || '');
    const sellerRating = this.parseOptionalNumber(item.sellerRating || item.shopRating || item.seller_rating);
    const sellerPositiveRate = this.parseOptionalNumber(item.sellerPositiveRate || item.positiveRate || item.seller_positive_rate);
    const sellerFollowers = this.parseOptionalNumber(item.sellerFollowers || item.followers || item.seller_followers);

    const officialSignal = [
      item.isOfficial,
      item.isMall,
      item.isMallSeller,
      item.sellerType,
      sellerName
    ].filter(value => value !== undefined && value !== null).map(value => String(value).toLowerCase());

    const isOfficial = officialSignal.some(value =>
      value === 'true' ||
      value === 'mall' ||
      value === 'official' ||
      value.includes('official store') ||
      value.includes('daraz mall')
    );

    return {
      sellerName,
      sellerId,
      sellerUrl: sellerUrl || null,
      sellerRating,
      sellerPositiveRate,
      sellerFollowers,
      isOfficial
    };
  }

  parseOptionalNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const numeric = Number(String(value).replace(/[^0-9.]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }

  buildProductGroupKey(name) {
    return this.cleanProductName(name)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
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
        timeout: 2200,
      });
      const data = response.data;
      if (data && data.mods && data.mods.listItems) {
        const products = [];
        data.mods.listItems.slice(0, 30).forEach((item, i) => {
          const name = item.name || '';
          const price = this.parsePrice(item.priceShow || item.price);
          const originalPrice = this.parsePrice(item.originalPriceShow || item.originalPrice);
          const image = item.image || '';
          const url = this.normalizeProductUrl(item.productUrl || item.itemUrl);

          // রেটিং, রিভিউ, বিক্রির সংখ্যা (JSON থেকে সরাসরি)
          const rating = parseFloat(item.ratingScore) || null;
          const reviewCount = parseInt(item.review) || null;
          const soldCount = parseInt(item.soldCount) || null;
          const seller = this.normalizeSeller(item);

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
              isOfficial: seller.isOfficial,
              sellerName: seller.sellerName,
              sellerId: seller.sellerId,
              sellerUrl: seller.sellerUrl,
              sellerRating: seller.sellerRating,
              sellerPositiveRate: seller.sellerPositiveRate,
              sellerFollowers: seller.sellerFollowers,
              sellerOfferRank: null,
              sellerCount: 1,
              productGroupKey: this.buildProductGroupKey(name),
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
          if (i >= 30) return false;
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
            const fullUrl = this.normalizeProductUrl(link.startsWith('http') ? link : link);
            const seller = this.normalizeSeller({
              sellerName: $el.find('.seller-name, .sellerName, [class*="seller-name"], [class*="sellerName"], [class*="sold-by"]').first().text().trim() || null,
              isMall: $el.text().includes('Mall')
            });

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
                isOfficial: seller.isOfficial,
                sellerName: seller.sellerName,
                sellerId: seller.sellerId,
                sellerUrl: seller.sellerUrl,
                sellerRating: seller.sellerRating,
                sellerPositiveRate: seller.sellerPositiveRate,
                sellerFollowers: seller.sellerFollowers,
                sellerOfferRank: null,
                sellerCount: 1,
                productGroupKey: this.buildProductGroupKey(name),
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

    return this.finalizeSellerOffers(products);
  }

  finalizeSellerOffers(products) {
    const groups = new Map();
    for (const product of products) {
      const key = product.productGroupKey || this.buildProductGroupKey(product.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(product);
    }

    for (const offers of groups.values()) {
      offers.sort((a, b) => Number(a.price || Infinity) - Number(b.price || Infinity));
      const count = offers.length;
      offers.forEach((offer, index) => {
        offer.sellerOfferRank = index + 1;
        offer.sellerCount = count;
      });
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
