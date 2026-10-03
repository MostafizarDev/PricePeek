const axios = require('axios');
const cheerio = require('cheerio');

class BaseScraper {
  constructor(name, baseUrl) {
    this.name = name;
    this.marketplace = name;
    this.baseUrl = baseUrl;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async fetchPage(url, options = {}) {
    try {
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        timeout: Number(options.timeout) > 0 ? Number(options.timeout) : 8000,
        maxContentLength: 5 * 1024 * 1024,
      });
      return data;
    } catch (err) {
      console.error('[' + this.name + '] fetch error: ' + err.message);
      return null;
    }
  }

  loadHTML(html) { return cheerio.load(html); }

  parsePrice(text) {
    if (text == null) return null;
    const cleaned = String(text).replace(/[^\d.]/g, '');
    const price = parseFloat(cleaned);
    return Number.isFinite(price) ? price : null;
  }

  parseDiscount(price, originalPrice) {
    if (!originalPrice || !price || originalPrice <= price) return 0;
    return Math.round(((originalPrice - price) / originalPrice) * 100);
  }

  cleanProductName(name) {
    if (!name) return '';
    return String(name).replace(/\s+/g, ' ').trim();
  }

  absoluteUrl(rawUrl) {
    try { return new URL(rawUrl, this.baseUrl).href; } catch { return ''; }
  }

  extractSitemapLocs(xml, tag) {
    if (!xml || typeof xml !== 'string') return [];
    const out = [];
    const re = new RegExp('<' + tag + '[^>]*>[\\s\\S]*?<loc[^>]*>\\s*([^<]+?)\\s*</loc>[\\s\\S]*?</' + tag + '>', 'gi');
    let match;
    while ((match = re.exec(xml))) {
      const url = this.absoluteUrl(match[1].trim());
      if (url) out.push(url);
    }
    return out;
  }

  async discoverSitemaps() {
    const candidates = new Set([
      this.baseUrl + '/sitemap.xml',
      this.baseUrl + '/sitemap_index.xml',
      this.baseUrl + '/sitemap-index.xml',
      this.baseUrl + '/sitemap_products.xml',
      this.baseUrl + '/product-sitemap.xml',
    ]);

    const robots = await this.fetchPage(this.baseUrl + '/robots.txt', { timeout: 5000 });
    if (typeof robots === 'string') {
      for (const line of robots.split(/\r?\n/)) {
        const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
        if (m) candidates.add(m[1]);
      }
    }

    const found = [];
    for (const url of candidates) {
      const xml = await this.fetchPage(url, { timeout: 8000 });
      if (typeof xml !== 'string') continue;
      if (/<(?:sitemapindex|urlset)\\b/i.test(xml)) found.push({ url, xml });
    }
    return found;
  }

  async collectSitemapUrls() {
    const roots = await this.discoverSitemaps();
    const queue = roots.slice();
    const visited = new Set();
    const urls = new Set();
    const maxSitemaps = Number(process.env.MAX_SITEMAPS_PER_STORE || 200);

    while (queue.length && visited.size < maxSitemaps && urls.size < 100000) {
      const item = queue.shift();
      if (!item || visited.has(item.url)) continue;
      visited.add(item.url);

      const xml = item.xml || await this.fetchPage(item.url, { timeout: 8000 });
      if (typeof xml !== 'string') continue;

      const childSitemaps = this.extractSitemapLocs(xml, 'sitemap');
      for (const child of childSitemaps) {
        if (!visited.has(child) && queue.length < maxSitemaps * 2) {
          queue.push({ url: child });
        }
      }

      const pageUrls = this.extractSitemapLocs(xml, 'url');
      for (const pageUrl of pageUrls) {
        if (this.isSameHost(pageUrl)) urls.add(pageUrl);
        if (urls.size >= 100000) break;
      }
    }

    return Array.from(urls);
  }

  isSameHost(url) {
    try {
      return new URL(url).hostname === new URL(this.baseUrl).hostname;
    } catch {
      return false;
    }
  }

  isLikelyProductUrl(url) {
    try {
      const path = new URL(url).pathname.toLowerCase();
      if (/\\.(xml|jpg|jpeg|png|webp|gif|pdf|css|js)$/i.test(path)) return false;
      if (/\\/(cart|checkout|login|register|account|wishlist|compare|contact|about|blog|news|faq|terms|privacy|return|outlet|service)(\\/|$)/i.test(path)) return false;
      if (/\\/(product|products|item|detail|details|p|book|books|electronics|deal|category-product)(\\/|$)/i.test(path)) return true;
      if (/\\/[^/]{4,}\\.(html?|php)$/i.test(path)) return true;
      const parts = path.split('/').filter(Boolean);
      return parts.length >= 2 && parts.length <= 6;
    } catch {
      return false;
    }
  }

  async parseGenericProductPage(url, html) {
    if (!html || typeof html !== 'string') return null;
    const $ = this.loadHTML(html);

    let product = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      if (product) return;
      try {
        const raw = JSON.parse($(el).contents().text());
        const nodes = [];
        const walk = value => {
          if (!value || typeof value !== 'object') return;
          if (Array.isArray(value)) return value.forEach(walk);
          const type = value['@type'];
          if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) nodes.push(value);
          if (value['@graph']) walk(value['@graph']);
          Object.values(value).forEach(v => {
            if (v && typeof v === 'object' && v !== value) walk(v);
          });
        };
        walk(raw);
        const node = nodes[0];
        if (!node) return;
        const offers = Array.isArray(node.offers) ? node.offers[0] : (node.offers || {});
        const price = this.parsePrice(offers.price || offers.lowPrice);
        if (!node.name || !price) return;
        const image = Array.isArray(node.image) ? node.image[0] : node.image;
        product = {
          name: this.cleanProductName(node.name),
          price,
          originalPrice: price,
          image: this.absoluteUrl(image || ''),
          url: this.absoluteUrl(node.url || url),
          inStock: !offers.availability || !/outofstock|soldout/i.test(String(offers.availability)),
          marketplace: this.marketplace,
        };
      } catch {}
    });

    if (!product) {
      const name = this.cleanProductName(
        $('meta[property="og:title"]').attr('content') ||
        $('h1').first().text() ||
        $('title').first().text()
      );
      const price = this.parsePrice(
        $('meta[property="product:price:amount"]').attr('content') ||
        $('meta[itemprop="price"]').attr('content') ||
        $('.price-new, .special-price, .sale-price, .product-price, [class*="price"]').first().text()
      );
      const originalPrice = this.parsePrice(
        $('meta[property="product:original_price:amount"]').attr('content') ||
        $('.price-old, .old-price, .regular-price, del').first().text()
      );
      const image = $('meta[property="og:image"]').attr('content') ||
        $('img[itemprop="image"]').first().attr('src') || '';
      if (name && price) {
        product = {
          name, price, originalPrice: originalPrice || price,
          image: this.absoluteUrl(image), url, inStock: !/out of stock|sold out|unavailable/i.test($.text()),
          marketplace: this.marketplace
        };
      }
    }

    if (!product) return null;

    return {
      ...product,
      originalPrice: product.originalPrice || product.price,
      discount: this.parseDiscount(product.price, product.originalPrice || product.price),
      isOfficial: true,
      rating: null,
      reviewCount: null,
      soldCount: null,
      coupons: [],
      cashback: []
    };
  }

  async getProductFromUrl(url) {
    try {
      const html = await this.fetchPage(url, { timeout: 8000 });
      return this.parseGenericProductPage(url, html);
    } catch (error) {
      console.error('[' + this.name + '] product parse error: ' + error.message);
      return null;
    }
  }

  async crawl() {
    const sitemapUrls = await this.collectSitemapUrls();
    const candidates = sitemapUrls.filter(url => this.isLikelyProductUrl(url));
    const urls = (candidates.length ? candidates : sitemapUrls).slice(
      0,
      Number(process.env.MAX_CATALOG_URLS_PER_STORE || 5000)
    );

    if (!urls.length) {
      throw new Error('No product URLs discovered from sitemap/robots');
    }

    const concurrency = Math.max(1, Number(process.env.CATALOG_CONCURRENCY || 8));
    const products = [];
    let index = 0;

    const worker = async () => {
      while (true) {
        const i = index++;
        if (i >= urls.length) return;
        const product = await this.getProductFromUrl(urls[i]);
        if (product && product.name && product.price && product.url) {
          products.push(product);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
    return products;
  }
}

module.exports = BaseScraper;
