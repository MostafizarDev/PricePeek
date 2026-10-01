// lib/ryans.js
const BaseScraper = require('./baseScraper');

class RyansScraper extends BaseScraper {
  constructor() {
    super('Ryans', 'https://www.ryans.com');
  }

  async search(query) {
    const products = [];
    const urlsToTry = [
      `${this.baseUrl}/search?search=${encodeURIComponent(query)}`,
    ];

    for (const url of urlsToTry) {
      try {
        console.log(`[Ryans] Trying URL: ${url}`);
        const html = await this.fetchPage(url);
        if (!html) continue;
        const $ = this.loadHTML(html);

        // প্রতিটি প্রোডাক্ট কার্ড
        $('.category-single-product').each((i, el) => {
          if (i >= 15) return false;
          try {
            const $card = $(el);

            // নাম
            const name = this.cleanProductName(
              $card.find('h4.product-title a').text()
            );

            // বর্তমান দাম (স্পেশাল প্রাইস)
            const price = this.parsePrice(
              $card.find('.pr-text.cat-sp-text').text()
            );

            // পুরনো দাম – মোডাল থেকে (যদি থাকে)
            let originalPrice = null;
            const modalId = $card.find('.modal.product_view').attr('id') || '';
            if (modalId) {
              const $modal = $(`#${modalId}`);
              const regularPriceText = $modal.find('.new-reg-text').text();
              originalPrice = this.parsePrice(regularPriceText);
            }
            if (!originalPrice) {
              // "Save Tk XX" থেকে অনুমান
              const saveText = $card.find('.fs-text').text();
              const saveAmount = this.parsePrice(saveText);
              if (saveAmount && price) {
                originalPrice = price + saveAmount;
              }
            }

            // ছবি
            const image = $card.find('.image-box img').attr('src') || $card.find('.card-img-top').attr('src');

            // লিংক
            const link = $card.find('.image-box a').attr('href') || $card.find('h4.product-title a').attr('href') || '';
            const fullUrl = link.startsWith('http') ? link : this.baseUrl + link;

            // স্টক
            const inStock = !$card.text().includes('Out of Stock');

            if (name && price) {
              products.push({
                id: `ryans_${Date.now()}_${i}`,
                name,
                marketplace: this.marketplace,
                price,
                originalPrice: originalPrice || price,
                discount: this.parseDiscount(price, originalPrice),
                image,
                url: fullUrl,
                inStock,
                isOfficial: true,
                rating: null,
                reviewCount: null,
                soldCount: null,
                coupons: [],
                cashback: [],
              });
            }
          } catch (e) {
            console.warn('[Ryans] Product parse error:', e.message);
          }
        });

        if (products.length > 0) {
          console.log(`[Ryans] Found ${products.length} products`);
          break; // সফল হলে আর অন্য URL চেষ্টা না
        }
      } catch (err) {
        console.error(`[Ryans] Error with URL ${url}:`, err.message);
      }
    }

    if (products.length === 0) {
      console.log('[Ryans] No products found with any URL.');
    }
    return products;
  }

  async getProductFromUrl(url) {
    try {
      const html = await this.fetchPage(url);
      if (!html) return null;
      const $ = this.loadHTML(html);

      const name = this.cleanProductName(
        $('h1.product-title, .product-title, .product-name').first().text()
      );
      const price = this.parsePrice(
        $('.product-price, .pr-text, .price-new, .special-price').first().text()
      );
      const originalPrice = this.parsePrice(
        $('.new-reg-text, .old-price, .regular-price').first().text()
      );
      const image = $('.image-box img, .product-image img, .card-img-top').first().attr('src');
      const inStock = !$('body').text().includes('Out of Stock');

      if (!name) return null;

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
      console.error('[Ryans] getProductFromUrl error:', err.message);
      return null;
    }
  }
}

module.exports = RyansScraper;
