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
    let $card = $a.closest(
      '[class*="product-card"], [class*="product-item"], [class*="productCard"], article, li'
    );
    if (!$card.length) $card = $a.parent();

    const href = $a.attr('href') || '';
    const url = this.cleanUrl(this.absoluteUrl(href));
    if (!this.isProductUrl(url)) return null;

    const candidates = [$card, $a.parent(), $a.closest('div')].filter(x => x && x.length);
    let $best = candidates[0];
    let bestText = '';

    for (const candidate of candidates) {
      const text = (candidate.text() || '').replace(/\s+/g, ' ').trim();
      const score = (/(?:৳|Tk\.?|BDT\.?|Taka)/i.test(text) ? 2 : 0) +
        (text.length >= 20 && text.length < 1500 ? 1 : 0);
      const bestScore = (/(?:৳|Tk\.?|BDT\.?|Taka)/i.test(bestText) ? 2 : 0) +
        (bestText.length >= 20 && bestText.length < 1500 ? 1 : 0);
      if (score > bestScore) {
        $best = candidate;
        bestText = text;
      }
    }

    const $root = $best || $a;
    const cardText = (($root.text() || '') + ' ' + ($a.attr('title') || '')).replace(/\s+/g, ' ').trim();

    const name = firstText($root, [
      '[itemprop="name"]', '.product-title', '.product-name',
      '[class*="product-title"]', '[class*="product-name"]',
      'h2', 'h3', 'h4'
    ]) || $a.attr('title') || $a.find('img').attr('alt') || $a.text().replace(/\s+/g, ' ').trim();

    if (!name || name.length < 3 || name.length > 500) return null;

    const priceTexts = [
      firstText($root, ['.price-new', '.sale-price', '.selling-price', '.special-price', '[class*="current-price"]']),
      firstText($root, ['[class*="price"]'])
    ].filter(Boolean);

    const prices = [...cardText.matchAll(/(?:৳|Tk\.?|BDT\.?|Taka)\s*([0-9][0-9,]*(?:\.\d+)?)/gi)]
      .map(m => Number(String(m[1]).replace(/,/g, '')))
      .filter(n => Number.isFinite(n) && n > 0);

    const price = priceTexts[0] || (prices.length ? String(prices[0]) : '');
    const originalPrice = firstText($root, [
      'del', '.price-old', '.old-price', '.regular-price',
      '[class*="old-price"]', '[class*="regular-price"]'
    ]) || (prices.length > 1 ? String(prices[1]) : '');

    const $img = $root.find('img').first();
    const image = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src') ||
      $img.attr('data-original') || $img.attr('data-srcset') || $a.find('img').attr('src') || '';

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
      if (products.length >= this.maxResults) return false;

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

    // Variant 1: search route permutations in parallel.
    const candidates = this.candidateUrls(query);
    const searchResults = await Promise.allSettled(
      candidates.map(url =>
        this.fetchPage(url, { timeout: 2400 }).then(html => ({ url, html }))
      )
    );

    const merged = new Map();

    for (const result of searchResults) {
      if (result.status !== 'fulfilled' || !result.value.html) continue;

      for (const product of this.parseAnyHtml(result.value.html)) {
        const key = this.cleanUrl(product.url).replace(/\/$/, '').toLowerCase();
        if (key && !merged.has(key)) merged.set(key, product);
      }

      if (merged.size >= this.maxResults) break;
    }

    // Variant 2: category SSR fallback.
    if (!merged.size && Date.now() - started < 4500) {
      const categoryResults = await Promise.allSettled(
        this.categoryCandidates(query).slice(0, 3).map(url =>
          this.fetchPage(url, { timeout: 1800 })
        )
      );

      for (const result of categoryResults) {
        if (result.status !== 'fulfilled' || !result.value) continue;

        for (const product of this.parseAnyHtml(result.value)) {
          if (this.scoreProduct(product, query) <= 0) continue;

          const key = this.cleanUrl(product.url).replace(/\/$/, '').toLowerCase();
          if (key && !merged.has(key)) merged.set(key, product);
        }
      }
    }

    // Variant 3: sitemap/product URL discovery fallback.
    if (!merged.size && Date.now() - started < 5600) {
      try {
        const sitemapProducts = await this.searchSitemap(query);

        for (const product of sitemapProducts) {
          const key = this.cleanUrl(product.url).replace(/\/$/, '').toLowerCase();
          if (key && !merged.has(key)) merged.set(key, product);
        }
      } catch (error) {
        console.warn('[Cartup] sitemap fallback failed:', error.message);
      }
    }

    return Array.from(merged.values())
      .sort((a, b) =>
        this.scoreProduct(b, query) - this.scoreProduct(a, query) ||
        Number(a.price) - Number(b.price)
      )
      .slice(0, this.maxResults);
  }

  async getProductFromUrl(url) {
    try {
      const productUrl = this.cleanUrl(url);
      if (!this.isProductUrl(productUrl)) return null;

      const html = await this.fetchPage(productUrl, { timeout: 2300 });
      if (!html) return null;

      const $ = this.loadHTML(html);
      const pageText = $('body').text().replace(/\s+/g, ' ').trim();

      const jsonProducts = this.parseJson($);
      if (jsonProducts.length) {
        const p = jsonProducts[0];
        return makeProduct(this, { ...p, url: productUrl, isOfficial: false });
      }

      const name = firstText($, [
        'h1', '[itemprop="name"]', '.product-title', '.product-name',
        '[class*="product-title"]', '[class*="product-name"]'
      ]);

      const prices = [...pageText.matchAll(/(?:৳|Tk\.?|BDT\.?|Taka)\s*([0-9][0-9,]*(?:\.\d+)?)/gi)]
        .map(m => Number(String(m[1]).replace(/,/g, '')))
        .filter(n => Number.isFinite(n) && n > 0);

      const price = firstText($, [
        '.price-new', '.sale-price', '.selling-price', '.special-price',
        '[class*="current-price"]', '[class*="selling-price"]', '[class*="product-price"]'
      ]) || (prices.length ? String(prices[0]) : '');

      const originalPrice = firstText($, [
        'del', '.price-old', '.old-price', '.regular-price',
        '[class*="old-price"]', '[class*="regular-price"]'
      ]) || (prices.length > 1 ? String(prices[1]) : '');

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
