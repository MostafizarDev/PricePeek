// lib/startech.js
const BaseScraper = require('./baseScraper');

class StarTechScraper extends BaseScraper {
  constructor() {
    super('StarTech', 'https://www.startech.com.bd');
  }

  async search(query) {
    const products = [];
    try {
      const url = `${this.baseUrl}/product/search?search=${encodeURIComponent(query)}`;
      const html = await this.fetchPage(url);
      if (!html) return products;
      const $ = this.loadHTML(html);

      // StarTech product card selectors (updated)
      $('.product-thumb, .product-layout, .p-item').each((i, el) => {
        if (i >= 30) return false;
        try {
          const $el = $(el);

          // নাম
          const name = this.cleanProductName(
            $el.find('.p-item-name a, .product-name a, h4 a, .name a').text()
          );

          // বর্তমান মূল্য
          const price = this.parsePrice(
            $el.find('.p-item-price span, .price-new, .product-price').first().text()
          );

          // পুরনো মূল্য (ছাড় থাকলে)
          const originalPrice = this.parsePrice(
            $el.find('.price-old, .product-price-old').text()
          );

          // ছবি
          const image = this.absoluteUrl($el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || $el.find('img').first().attr('data-original') || '');

          // লিংক
          const link = $el.find('.p-item-name a, .product-name a, h4 a, .name a, a').first().attr('href') || '';
          const fullUrl = this.absoluteUrl(link);

          // স্টক
          const inStock = !$el.text().includes('Out of Stock') &&
                         !$el.text().includes('Stock Out') &&
                         !$el.find('.out-of-stock').length;

          // রেটিং/রিভিউ (StarTech-এ সাধারণত থাকে না, তাই null)
          const rating = null;
          const reviewCount = null;
          const soldCount = null;

          if (name && price) {
            products.push({
              id: `startech_${Date.now()}_${i}`,
              name,
              marketplace: this.marketplace,
              price,
              originalPrice: originalPrice || price,
              discount: this.parseDiscount(price, originalPrice),
              image,
              url: fullUrl,
              inStock,
              isOfficial: true,
              rating,
              reviewCount,
              soldCount,
              coupons: [],
              cashback: [],
            });
          }
        } catch (e) {}
      });
    } catch (err) {
      console.error('[StarTech] search error:', err.message);
    }
    return products.filter((product, index, list) => list.findIndex(item => item.url === product.url) === index);
  }

  async getProductFromUrl(url) {
    try {
      const html = await this.fetchPage(url);
      if (!html) return null;
      const $ = this.loadHTML(html);

      const name = this.cleanProductName(
        $('h1.product-title, .product-name, .product-info h1').first().text()
      );
      const price = this.parsePrice(
        $('.product-price-new, .price-new, .product-price, .special-price').first().text()
      );
      const originalPrice = this.parsePrice(
        $('.product-price-old, .price-old, .regular-price').text()
      );
      const image = $('.product-image img, .main-image img, .thumbnails img').first().attr('src');
      const inStock = !$('.product-stock, .stock-status').text().includes('Out of Stock');

      return {
        name,
        price,
        originalPrice: originalPrice || price,
        image,
        url,
        marketplace: this.marketplace,
        inStock,
      };
    } catch (err) {
      console.error('[StarTech] getProductFromUrl error:', err.message);
      return null;
    }
  }
}

module.exports = StarTechScraper;
