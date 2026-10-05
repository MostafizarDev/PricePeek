// lib/cartup.js
// Cartup scraper with layered fallbacks:
// 1) SSR/search route variants
// 2) Cartup category pages
// 3) sitemap/product-URL discovery
// 4) direct product-page parsing

const axios = require('axios');
const BaseScraper = require('./baseScraper');
const {
  firstText,
  firstAttr,
  makeProduct,
  parseJsonLd,
  parseEmbeddedProducts
} = require('./scraperUtils');

class CartupScraper extends BaseScraper {
  constructor() {
    super('Cartup', 'https://cartup.com');
    this.maxResults = 30;
    this.cardScanLimit = 250;
  }

  cleanUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return '';
    }
  }

  isProductUrl(url) {
    try {
      const parsed = new URL(url);
      return this.isSameHost(url) && /^\/product\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  async fetchPage(url, options = {}) {
    const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 3500;
    try {
      const { data } = await axios.get(url, {
        timeout,
        maxContentLength: 12 * 1024 * 1024,
        maxBodyLength: 12 * 1024 * 1024,
        validateStatus: status => status >= 200 && status < 400,
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Referer': 'https://cartup.com/',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Upgrade-Insecure-Requests': '1'
        }
      });
      return data;
    } catch {
      return null;
    }
  }

  extractBrand(name, $card) {
    const explicit = firstText($card, [
      '[itemprop="brand"]', '.brand', '.product-brand', '[class*="brand"]'
    ]);
    if (explicit) return explicit;

    const value = String(name || '').trim();
    const knownBrands = [
      'Logitech', 'A4Tech', 'Fantech', 'Razer', 'HP', 'Dell', 'Lenovo',
      'Asus', 'ASUS', 'Apple', 'Samsung', 'Xiaomi', 'Redmi', 'Anker',
      'Baseus', 'Havit', 'Rapoo', 'Corsair', 'JBL', 'Sony', 'UGREEN',
      'TP-Link', 'Tenda', 'MSI', 'Gigabyte', 'AOC', 'Acer', 'Walton',
      'Vision', 'Singer', 'Philips', 'Panasonic', 'Miyako', 'Kingston',
      'Transcend', 'SanDisk', 'Seagate', 'Western Digital', 'WD', 'Brother',
      'Canon', 'Nikon', 'DJI', 'GoPro', 'Realme', 'OnePlus', 'Oppo', 'Vivo'
    ];

    const lower = value.toLowerCase();
    return knownBrands.find(brand =>
      lower.startsWith(brand.toLowerCase() + ' ') || lower === brand.toLowerCase()
    ) || null;
  }

  cardProduct($a) {
    const href = $a.attr('href') || '';
    const url = this.cleanUrl(this.absoluteUrl(href));
    if (!this.isProductUrl(url)) return null;

    // Cartup category/search markup can wrap several product links inside one
    // <article>/<li>. Never use a broad ancestor blindly or the name/image from
    // one card can be paired with the URL of another card.
    let $card = $a.closest(
      '[class*="product-card"], [class*="product-item"], [class*="productCard"], [data-product-id], [data-testid*="product"]'
    );

    if (!$card.length) {
      let node = $a.parent();
      for (let i = 0; i < 6 && node.length; i++, node = node.parent()) {
        const productLinks = node.find('a[href*="/product/"]').toArray().filter(el => {
          return this.isProductUrl(this.absoluteUrl(el.attribs?.href || ''));
        }).length;
        const text = (node.text() || '').replace(/\s+/g, ' ').trim();
        if (productLinks === 1 && text.length >= 20 && text.length < 1800) {
          $card = node;
          break;
        }
      }
    }

    const $root = $card.length ? $card : $a;

    // Prefer data directly attached to the product anchor first.
    const anchorName = ($a.attr('title') || $a.attr('aria-label') ||
      $a.find('[itemprop="name"], .product-title, .product-name, h2, h3, h4').first().text() ||
      $a.find('img').first().attr('alt') || $a.text() || '')
      .replace(/\s+/g, ' ').trim();

    const name = anchorName || firstText($root, [
      '[itemprop="name"]', '.product-title', '.product-name',
      '[class*="product-title"]', '[class*="product-name"]',
      'h2', 'h3', 'h4'
    ]);

    if (!name || name.length < 3 || name.length > 500) return null;

    const cardText = (($root.text() || '') + ' ' + ($a.text() || '')).replace(/\s+/g, ' ').trim();

    const priceTexts = [
      firstText($a, ['.price-new', '.sale-price', '.selling-price', '.special-price', '[class*="current-price"]', '[class*="price"]']),
      firstText($root, ['.price-new', '.sale-price', '.selling-price', '.special-price', '[class*="current-price"]'])
    ].filter(Boolean);

    const prices = [...cardText.matchAll(/(?:৳|Tk\.?|BDT\.?|Taka)\s*([0-9][0-9,]*(?:\.\d+)?)/gi)]
      .map(m => Number(String(m[1]).replace(/,/g, '')))
      .filter(n => Number.isFinite(n) && n > 0);

    const price = priceTexts[0] || (prices.length ? String(prices[0]) : '');
    const originalPrice = firstText($root, [
      'del', '.price-old', '.old-price', '.regular-price',
      '[class*="old-price"]', '[class*="regular-price"]'
    ]) || (prices.length > 1 ? String(prices[1]) : '');

    const $img = $a.find('img').first().length ? $a.find('img').first() : $root.find('img').first();
    const image = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src') ||
      $img.attr('data-original') || $img.attr('data-srcset') || '';

    const lower = cardText.toLowerCase();
    return {
      name,
      price,
      originalPrice,
      url,
      image,
      brand: this.extractBrand(name, $root),
      inStock: !/out of stock|stock out|sold out|unavailable|temporarily unavailable/i.test(lower),
      isOfficial: /official store|official seller|authorized|mall/i.test(cardText)
    };
  }
  parseSearchResults($) {
    const products = [];
    const seen = new Set();

    $('a[href*="/product/"]').each((_, anchor) => {
      if (products.length >= this.cardScanLimit) return false;

      const product = this.cardProduct($(anchor));
      if (!product) return;

      const key = this.cleanUrl(product.url).replace(/\/$/, '').toLowerCase();
      if (!key || seen.has(key)) return;

      const made = makeProduct(this, product);
      if (!made) return;

      seen.add(key);
      products.push(made);
    });

    return products;
  }
  parseEmbedded($) {
    return parseEmbeddedProducts($, this.baseUrl, this.marketplace)
      .filter(product => this.isProductUrl(product.url))
      .map(product => ({ ...product, isOfficial: false }));
  }

  parseJson($) {
    return parseJsonLd($, this.baseUrl, this.marketplace)
      .filter(product => this.isProductUrl(product.url))
      .map(product => ({ ...product, isOfficial: false }));
  }

  parseAnyHtml(html) {
    if (!html) return [];
    const $ = this.loadHTML(html);

    let products = this.parseSearchResults($);
    if (!products.length) products = this.parseJson($);
    if (!products.length) products = this.parseEmbedded($);

    if (!products.length) {
      const out = [];
      const seen = new Set();

      $('a[href*="/product/"]').each((_, el) => {
        if (out.length >= this.maxResults) return false;

        const href = this.cleanUrl(this.absoluteUrl($(el).attr('href')));
        if (!this.isProductUrl(href) || seen.has(href)) return;

        let node = $(el);
        for (let i = 0; i < 4 && node.length; i++, node = node.parent()) {
          const text = (node.text() || '').replace(/\s+/g, ' ').trim();
          const prices = [...text.matchAll(/(?:৳|Tk\.?|BDT\.?|Taka)\s*([0-9][0-9,]*(?:\.\d+)?)/gi)]
            .map(m => Number(m[1].replace(/,/g, '')))
            .filter(n => n > 0);

          if (prices.length) {
            const name = ($(el).attr('title') || $(el).find('img').attr('alt') || $(el).text() || '')
              .replace(/\s+/g, ' ').trim();

            if (name.length >= 3) {
              const made = makeProduct(this, {
                name,
                price: prices[0],
                originalPrice: prices[1] || prices[0],
                url: href,
                image: $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '',
                isOfficial: /official|authorized/i.test(text),
                inStock: !/out of stock|sold out|unavailable/i.test(text)
              });

              if (made) {
                seen.add(href);
                out.push(made);
              }
            }
            break;
          }
        }
      });

      products = out;
    }

    return products.filter(Boolean).slice(0, this.maxResults);
  }

  candidateUrls(query) {
    const q = encodeURIComponent(String(query || '').trim());
    const plus = q.replace(/%20/g, '+');

    return [
      `${this.baseUrl}/search?query=${q}`,
      `${this.baseUrl}/search?q=${q}`,
      `${this.baseUrl}/search?keyword=${q}`,
      `${this.baseUrl}/search?search=${q}`,
      `${this.baseUrl}/search?term=${q}`,
      `${this.baseUrl}/search?query=${plus}`,
      `${this.baseUrl}/search?q=${plus}`,
      `${this.baseUrl}/?q=${q}`,
      `${this.baseUrl}/?query=${q}`
    ];
  }

  categoryCandidates(query) {
    const q = String(query || '').toLowerCase();

    const map = [
      [/mouse|mice|g304|g102|g203|gaming mouse/, ['mice', 'gaming_314']],
      [/keyboard/, ['keyboard', 'keyboards']],
      [/headphone|headset|earphone|speaker/, ['pc_audio']],
      [/laptop|notebook/, ['laptop', 'computing']],
      [/monitor|display/, ['monitor', 'monitors']],
      [/phone|iphone|samsung galaxy|mobile/, ['phones', 'mobile']],
      [/tablet|ipad/, ['tablets', 'tablet']],
      [/camera|dslr|mirrorless/, ['camera', 'cameras']],
      [/printer|scanner/, ['printer', 'printers']],
      [/ssd|hdd|hard drive|storage|ram|memory/, ['storage', 'computer-components']],
      [/router|wifi|wi-fi|network/, ['networking', 'routers']],
      [/watch|smartwatch/, ['watches']],
      [/tv|television/, ['tv-home-appliances']],
      [/refrigerator|fridge|microwave|oven|washing machine|air conditioner/, ['home-appliances', 'appliances']],
      [/shirt|t-shirt|jeans|pant|shoe|sneaker|dress/, ['fashion', 'mens-fashion', 'womens-fashion']],
      [/grocery|rice|oil|food/, ['groceries', 'groceries-pet-supplies']]
    ];

    const found = new Set();
    for (const [regex, slugs] of map) {
      if (regex.test(q)) slugs.forEach(s => found.add(s));
    }

    return Array.from(found).map(slug => `${this.baseUrl}/category/${slug}`);
  }

  scoreProduct(product, query) {
    const tokens = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
    const text = `${product.name || ''} ${product.url || ''}`.toLowerCase();

    let score = 0;
    for (const token of tokens) {
      if (text.includes(token)) score += 1;
    }

    if (tokens.length && text.includes(tokens.join(' '))) score += 3;
    return score;
  }

  async searchSitemap(query) {
    const roots = new Set([
      `${this.baseUrl}/sitemap.xml`,
      `${this.baseUrl}/sitemap_index.xml`,
      `${this.baseUrl}/sitemap-index.xml`,
      `${this.baseUrl}/product-sitemap.xml`
    ]);

    const robotsPromise = this.fetchPage(`${this.baseUrl}/robots.txt`, { timeout: 1800 });
    const rootPromises = Array.from(roots).map(url =>
      this.fetchPage(url, { timeout: 1800 }).then(xml => ({ url, xml }))
    );

    const [robots, ...rootResults] = await Promise.all([robotsPromise, ...rootPromises]);

    if (typeof robots === 'string') {
      for (const line of robots.split(/\r?\n/)) {
        const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
        if (m) roots.add(m[1]);
      }
    }

    const xmls = rootResults.filter(x => typeof x.xml === 'string');
    const extraUrls = Array.from(roots).filter(url => !rootResults.some(r => r.url === url));

    if (extraUrls.length) {
      const extras = await Promise.all(
        extraUrls.slice(0, 3).map(url =>
          this.fetchPage(url, { timeout: 1500 }).then(xml => ({ url, xml }))
        )
      );
      xmls.push(...extras.filter(x => typeof x.xml === 'string'));
    }

    const urls = new Set();
    const childSitemaps = new Set();

    for (const item of xmls) {
      const xml = item.xml;
      const locs = [...xml.matchAll(/<loc[^>]*>\s*([^<]+?)\s*<\/loc>/gi)].map(m => m[1].trim());

      for (const loc of locs) {
        if (/\.xml(?:\?|$)/i.test(loc)) childSitemaps.add(loc);
        if (this.isProductUrl(loc)) urls.add(this.cleanUrl(loc));
      }
    }

    if (!urls.size && childSitemaps.size) {
      const children = await Promise.all(
        Array.from(childSitemaps).slice(0, 6).map(url =>
          this.fetchPage(url, { timeout: 1800 })
        )
      );

      for (const xml of children) {
        if (typeof xml !== 'string') continue;

        for (const m of xml.matchAll(/<loc[^>]*>\s*([^<]+?)\s*<\/loc>/gi)) {
          const loc = m[1].trim();
          if (this.isProductUrl(loc)) urls.add(this.cleanUrl(loc));
        }
      }
    }

    const ranked = Array.from(urls)
      .map(url => ({ url, score: this.scoreProduct({ url }, query) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (!ranked.length) return [];

    const products = await Promise.all(
      ranked.map(x => this.getProductFromUrl(x.url))
    );

    return products
      .filter(Boolean)
      .sort((a, b) => this.scoreProduct(b, query) - this.scoreProduct(a, query))
      .slice(0, this.maxResults);
  }

  async search(query) {
    const started = Date.now();
    const candidates = this.candidateUrls(query);
    const merged = new Map();

    const addProducts = (items) => {
      for (const product of items || []) {
        const key = this.cleanUrl(product.url).replace(/\/$/, '').toLowerCase();
        if (!key) continue;
        if (!merged.has(key)) merged.set(key, product);
      }
    };

    // Search routes first. Keep scanning beyond the first 30 cards because
    // Cartup may place the requested model deeper in the result list.
    const searchResults = await Promise.allSettled(
      candidates.map(url =>
        this.fetchPage(url, { timeout: 2400 }).then(html => ({ url, html }))
      )
    );

    for (const result of searchResults) {
      if (result.status !== 'fulfilled' || !result.value.html) continue;
      addProducts(this.parseAnyHtml(result.value.html));
    }

    const relevantCount = () =>
      Array.from(merged.values()).filter(p => this.scoreProduct(p, query) > 0).length;

    // Category fallback when search routes do not return a relevant product.
    if (relevantCount() === 0 && Date.now() - started < 5200) {
      const categoryResults = await Promise.allSettled(
        this.categoryCandidates(query).slice(0, 3).map(url =>
          this.fetchPage(url, { timeout: 2200 })
        )
      );

      for (const result of categoryResults) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        addProducts(this.parseAnyHtml(result.value));
      }
    }

    // Sitemap fallback only when we still have no relevant result.
    if (relevantCount() === 0 && Date.now() - started < 6000) {
      try {
        addProducts(await this.searchSitemap(query));
      } catch (error) {
        console.warn('[Cartup] sitemap fallback failed:', error.message);
      }
    }

    const ranked = Array.from(merged.values())
      .map(product => ({ product, score: this.scoreProduct(product, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) =>
        b.score - a.score ||
        Number(a.product.price || Infinity) - Number(b.product.price || Infinity)
      )
      .map(item => item.product);

    return ranked.slice(0, this.maxResults);
  }
  async getProductFromUrl(url) {
    try {
      const productUrl = this.cleanUrl(url);
      if (!this.isProductUrl(productUrl)) return null;

      const html = await this.fetchPage(productUrl, { timeout: 2300 });
      if (!html) return null;

      const $ = this.loadHTML(html);
      const pageText = $('body').text().replace(/\s+/g, ' ').trim();

      // Cartup can expose multiple Product/Offer objects in JSON-LD.
      // Do not blindly trust the first one: it may describe a related
      // product/variant and can give us a wrong "original" price.
      const jsonProducts = this.parseJson($);

      const name = firstText($, [
        'h1', '[itemprop="name"]', '.product-title', '.product-name',
        '[class*="product-title"]', '[class*="product-name"]'
      ]);

      // Prefer the actual product price block shown on the page.
      const currentPriceText = firstText($, [
        '.price-new', '.sale-price', '.selling-price', '.special-price',
        '[class*="current-price"]', '[class*="selling-price"]', '[class*="product-price"]'
      ]);

      const originalPriceText = firstText($, [
        'del', 's', '.price-old', '.old-price', '.regular-price',
        '[class*="old-price"]', '[class*="regular-price"]'
      ]);

      const productStart = name
        ? Math.max(0, pageText.toLowerCase().indexOf(String(name).toLowerCase()))
        : 0;
      const productSection = pageText.slice(productStart, productStart + 1800);

      const sectionPrices = [...productSection.matchAll(/(?:৳|Tk\.?|BDT\.?|Taka)\s*([0-9][0-9,]*(?:\\.\\d+)?)/gi)]
        .map(m => Number(String(m[1]).replace(/,/g, '')))
        .filter(n => Number.isFinite(n) && n > 0);

      const currentNumbers = String(currentPriceText || '').match(/[0-9][0-9,]*(?:\\.\\d+)?/g) || [];
      const originalNumbers = String(originalPriceText || '').match(/[0-9][0-9,]*(?:\\.\\d+)?/g) || [];

      let price = currentNumbers.length
        ? Number(currentNumbers[currentNumbers.length - 1].replace(/,/g, ''))
        : null;
      let originalPrice = originalNumbers.length
        ? Number(originalNumbers[originalNumbers.length - 1].replace(/,/g, ''))
        : null;

      // Fallback: on discounted Cartup product pages the first two prices
      // near the title are commonly original -> current (e.g. 31,000 -> 6,574).
      if (!price && sectionPrices.length) {
        price = sectionPrices[0];
      }
      if (!originalPrice && sectionPrices.length > 1 && price) {
        const higher = sectionPrices.slice(0, 3).filter(n => n > price);
        if (higher.length) originalPrice = Math.min(...higher);
      }

      // JSON-LD is only a fallback when the visible product price is absent.
      if (!price && jsonProducts.length) {
        const matching = jsonProducts.find(p =>
          String(p.name || '').toLowerCase().trim() === String(name || '').toLowerCase().trim()
        ) || jsonProducts[0];

        price = Number(matching.price) || null;
        if (!originalPrice && Number(matching.originalPrice) > price) {
          originalPrice = Number(matching.originalPrice);
        }
      }

      if (!price) return null;
      const image = firstAttr($, [
        'meta[property="og:image"]', 'meta[name="twitter:image"]'
      ], 'content') || firstAttr($, ['img'], 'src') || firstAttr($, ['img'], 'data-src') || '';

      const sellerName = firstText($, [
        '[class*="seller-name"]', '[class*="seller"]', '[class*="store-name"]', '[class*="store"]'
      ]) || null;

      const sellerRating = firstText($, [
        '[class*="seller-rating"]', '[class*="positive-seller"]', '[class*="rating"]'
      ]) || null;

      const inStock = !/out of stock|stock out|sold out|temporarily unavailable|unavailable/i.test(pageText);
      const official = /official store|official seller|authorized/i.test(pageText);

      const product = makeProduct(this, {
        name,
        price,
        originalPrice,
        url: productUrl,
        image,
        inStock,
        isOfficial: official,
        brand: this.extractBrand(name, $)
      });

      if (!product) return null;
      return { ...product, sellerName, sellerRating };
    } catch (error) {
      console.warn('[Cartup] getProductFromUrl failed:', error.message);
      return null;
    }
  }
}

module.exports = CartupScraper;
