const axios = require('axios');
const cheerio = require('cheerio');

class BaseScraper {
  constructor(name, baseUrl) {
    this.name = name;
    this.marketplace = name;
    this.baseUrl = baseUrl;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  async fetchPage(url, options = {}) {
    const attempts = Math.max(1, Number(options.retries || 2));
    const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : 10000;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const { data } = await axios.get(url, {
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
          timeout,
          maxContentLength: 10 * 1024 * 1024,
          maxBodyLength: 10 * 1024 * 1024,
          validateStatus: status => status >= 200 && status < 400,
        });
        return data;
      } catch (err) {
        if (attempt === attempts) {
          console.warn('[' + this.name + '] fetch failed ' + url + ': ' + err.message);
        } else {
          await new Promise(resolve => setTimeout(resolve, 250 * attempt));
        }
      }
    }
    return null;
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
    return name ? String(name).replace(/\s+/g, ' ').trim() : '';
  }

  absoluteUrl(rawUrl) {
    try { return new URL(rawUrl, this.baseUrl).href; } catch { return ''; }
  }

  isSameHost(url) {
    try {
      const a = new URL(url).hostname.replace(/^www\./i, '');
      const b = new URL(this.baseUrl).hostname.replace(/^www\./i, '');
      return a === b;
    } catch { return false; }
  }

  extractSitemapEntries(xml) {
    if (!xml || typeof xml !== 'string') return [];
    const entries = [];
    const re = /<url[^>]*>[\\s\\S]*?<loc[^>]*>\\s*([^<]+?)\\s*<\\/loc>[\\s\\S]*?(?:<lastmod[^>]*>\\s*([^<]+?)\\s*<\\/lastmod>[\\s\\S]*)?<\\/url>/gi;
    let match;
    while ((match = re.exec(xml))) {
      const url = this.absoluteUrl(match[1].trim());
      if (url) entries.push({ url, lastmod: match[2] ? match[2].trim() : null });
    }
    return entries;
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

    const robots = await this.fetchPage(this.baseUrl + '/robots.txt', { timeout: 5000, retries: 1 });
    if (typeof robots === 'string') {
      for (const line of robots.split(/\r?\n/)) {
        const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
        if (m) candidates.add(m[1]);
      }
    }

    const found = [];
    for (const url of candidates) {
      const xml = await this.fetchPage(url, { timeout: 8000, retries: 1 });
      if (typeof xml !== 'string') continue;
      if (/<(?:sitemapindex|urlset)\b/i.test(xml)) found.push({ url, xml });
    }
    return found;
  }

  async collectSitemapEntries() {
    const roots = await this.discoverSitemaps();
    const queue = roots.slice();
    const visited = new Set();
    const entries = new Map();
    const maxSitemaps = Number(process.env.MAX_SITEMAPS_PER_STORE || 500);
    const maxUrls = Number(process.env.MAX_DISCOVERED_URLS_PER_STORE || 250000);

    while (queue.length && visited.size < maxSitemaps && entries.size < maxUrls) {
      const item = queue.shift();
      if (!item || visited.has(item.url)) continue;
      visited.add(item.url);

      const xml = item.xml || await this.fetchPage(item.url, { timeout: 10000, retries: 1 });
      if (typeof xml !== 'string') continue;

      for (const child of this.extractSitemapLocs(xml, 'sitemap')) {
        if (!visited.has(child) && queue.length < maxSitemaps * 3) queue.push({ url: child });
      }

      for (const entry of this.extractSitemapEntries(xml)) {
        if (this.isSameHost(entry.url)) entries.set(entry.url, entry);
        if (entries.size >= maxUrls) break;
      }
    }

    return Array.from(entries.values());
  }

  isLikelyProductUrl(url) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.toLowerCase();
      if (!this.isSameHost(url)) return false;
      if (/\.(xml|jpg|jpeg|png|webp|gif|pdf|css|js|json|svg)$/i.test(path)) return false;
      if (/\/(cart|checkout|login|register|account|wishlist|compare|contact|about|blog|news|faq|terms|privacy|return|returns|service)(\/|$)/i.test(path)) return false;
      if (/\/(product|products|item|detail|details|p|book|books|deal|product-detail)(\/|$)/i.test(path)) return true;
      if (/\/[^/]{4,}\.(html?|php)$/i.test(path)) return true;
      const parts = path.split('/').filter(Boolean);
      return parts.length >= 2 && parts.length <= 6 && !/^(category|categories|collection|collections|shop|search|brand|brands|page|tags?)$/i.test(parts[parts.length - 1]);
    } catch { return false; }
  }

  isLikelyCategoryUrl(url) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.toLowerCase();
      if (!this.isSameHost(url)) return false;
      if (this.isLikelyProductUrl(url)) return false;
      if (/\.(xml|jpg|jpeg|png|webp|gif|pdf|css|js|json|svg)$/i.test(path)) return false;
      if (/\/(cart|checkout|login|register|account|wishlist|compare|contact|about|blog|news|faq|terms|privacy|return|service)(\/|$)/i.test(path)) return false;
      if (/[?&](page|pagenumber|pageindex)=\\d+/i.test(parsed.search)) return true;
      if (/\/(category|categories|collection|collections|shop|catalog|department|brand|brands|books|electronics|mobile|laptop|computer|beauty|grocery)(\/|$)/i.test(path)) return true;
      const parts = path.split('/').filter(Boolean);
      return parts.length >= 1 && parts.length <= 4;
    } catch { return false; }
  }

  extractLinks(html) {
    const $ = this.loadHTML(html);
    const links = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const url = this.absoluteUrl(href);
      if (url && this.isSameHost(url)) links.push(url);
    });
    return [...new Set(links)];
  }

  extractPaginationLinks($) {
    const out = new Set();
    $('a[rel="next"], a.next, .next a, .pagination a, [class*="pagination"] a, [class*="pager"] a').each((_, el) => {
      const url = this.absoluteUrl($(el).attr('href'));
      if (!url || !this.isSameHost(url)) return;
      const u = new URL(url);
      if (/[?&](page|pagenumber|pageindex|p)=\\d+/i.test(u.search) || /\/page\/\\?d+/i.test(u.pathname) || /\/p-\\?d+/i.test(u.pathname)) out.add(url);
    });
    return Array.from(out);
  }

  extractProductLinksFromHtml(html) {
    const $ = this.loadHTML(html);
    const urls = new Set();

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const parsed = JSON.parse($(el).contents().text());
        const walk = node => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) return node.forEach(walk);
          const type = node['@type'];
          if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
            if (node.url) {
              const url = this.absoluteUrl(node.url);
              if (this.isLikelyProductUrl(url)) urls.add(url);
            }
          }
          if (node.itemListElement) walk(node.itemListElement);
          Object.values(node).forEach(v => { if (v && typeof v === 'object') walk(v); });
        };
        walk(parsed);
      } catch {}
    });

    $('a[href]').each((_, el) => {
      const url = this.absoluteUrl($(el).attr('href'));
      if (url && this.isLikelyProductUrl(url)) urls.add(url);
    });

    return Array.from(urls);
  }

  extractBreadcrumbs($) {
    const items = [];
    $('nav[aria-label*="breadcrumb" i] a, .breadcrumb a, [class*="breadcrumb"] a, [itemprop="itemListElement"] [itemprop="name"]').each((_, el) => {
      const text = this.cleanProductName($(el).text());
      if (text && !items.includes(text)) items.push(text);
    });
    return items.filter(Boolean);
  }

  async parseGenericProductPage(url, html) {
    if (!html || typeof html !== 'string') return null;
    const $ = this.loadHTML(html);
    let product = null;

    const breadcrumbs = this.extractBreadcrumbs($);

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
          Object.values(value).forEach(v => { if (v && typeof v === 'object' && v !== value) walk(v); });
        };
        walk(raw);
        const node = nodes[0];
        if (!node) return;
        const offers = Array.isArray(node.offers) ? node.offers[0] : (node.offers || {});
        const price = this.parsePrice(offers.price || offers.lowPrice);
        if (!node.name || !price) return;
        const image = Array.isArray(node.image) ? node.image[0] : node.image;
        const seller = typeof offers.seller === 'object' ? offers.seller : {};
        product = {
          name: this.cleanProductName(node.name),
          price,
          originalPrice: this.parsePrice(offers.highPrice) || price,
          image: this.absoluteUrl(image || ''),
          url: this.absoluteUrl(node.url || url),
          inStock: !offers.availability || !/outofstock|soldout/i.test(String(offers.availability)),
          sellerId: seller.identifier || seller.id || seller.sku || null,
          sellerName: seller.name || null,
          category: node.category || breadcrumbs[breadcrumbs.length - 2] || null,
          subcategory: breadcrumbs[breadcrumbs.length - 1] || null,
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
      const sellerName = $('.seller-name, .sellerName, [class*="seller-name"], [class*="sellerName"], [class*="sold-by"] a').first().text().trim() || null;
      if (name && price) {
        product = {
          name, price, originalPrice: originalPrice || price,
          image: this.absoluteUrl(image), url, inStock: !/out of stock|sold out|unavailable/i.test($.text()),
          sellerName,
          category: breadcrumbs[breadcrumbs.length - 2] || null,
          subcategory: breadcrumbs[breadcrumbs.length - 1] || null,
          marketplace: this.marketplace
        };
      }
    }

    if (!product) return null;

    return {
      ...product,
      originalPrice: product.originalPrice || product.price,
      discount: this.parseDiscount(product.price, product.originalPrice || product.price),
      isOfficial: product.sellerName ? /official|mall|star tech|apple gadgets/i.test(product.sellerName) : true,
      rating: null,
      reviewCount: null,
      soldCount: null,
      coupons: [],
      cashback: []
    };
  }

  async getProductFromUrl(url) {
    try {
      const html = await this.fetchPage(url, { timeout: 12000, retries: 2 });
      return this.parseGenericProductPage(url, html);
    } catch (error) {
      console.error('[' + this.name + '] product parse error: ' + error.message);
      return null;
    }
  }

  async discoverCatalogEntries() {
    const sitemapEntries = await this.collectSitemapEntries();
    const productEntries = sitemapEntries.filter(e => this.isLikelyProductUrl(e.url));
    if (productEntries.length >= Number(process.env.SITEMAP_PRODUCT_MIN || 100)) {
      return { entries: productEntries, mode: 'sitemap' };
    }

    const maxCategoryPages = Number(process.env.MAX_CATEGORY_PAGES_PER_STORE || 5000);
    const queue = [this.baseUrl + '/'];
    const visited = new Set();
    const productMap = new Map();

    while (queue.length && visited.size < maxCategoryPages && productMap.size < Number(process.env.MAX_DISCOVERED_URLS_PER_STORE || 250000)) {
      const url = queue.shift();
      if (!url || visited.has(url) || !this.isSameHost(url)) continue;
      visited.add(url);

      const html = await this.fetchPage(url, { timeout: 10000, retries: 1 });
      if (!html) continue;
      const $ = this.loadHTML(html);

      for (const p of this.extractProductLinksFromHtml(html)) {
        productMap.set(p, { url: p, lastmod: null });
      }

      for (const next of this.extractPaginationLinks($)) {
        if (!visited.has(next)) queue.push(next);
      }

      for (const link of this.extractLinks(html)) {
        if (this.isLikelyCategoryUrl(link) && !visited.has(link) && queue.length < maxCategoryPages * 2) queue.push(link);
      }
    }

    return {
      entries: productMap.size ? Array.from(productMap.values()) : sitemapEntries.filter(e => this.isLikelyProductUrl(e.url)),
      mode: productMap.size ? 'category-pagination' : 'sitemap-fallback'
    };
  }

  async crawlCatalog(options = {}) {
    const discovered = await this.discoverCatalogEntries();
    const entries = discovered.entries || [];
    const previous = options.previousManifest || {};
    const isFull = options.full === true || !Object.keys(previous).length;

    let selected = entries;
    let mode = discovered.mode;

    if (!isFull && entries.length) {
      const rotationSlots = Math.max(1, Number(process.env.PRICE_REFRESH_ROTATION_SLOTS || 12));
      const slot = Number(options.rotationSlot || 0) % rotationSlots;
      const changed = [];
      const rotating = [];

      entries.forEach((entry, i) => {
        const old = previous[entry.url];
        if (!old || (entry.lastmod && old.lastmod && entry.lastmod !== old.lastmod)) {
          changed.push(entry);
        }
        if (i % rotationSlots === slot) rotating.push(entry);
      });

      const unique = new Map();
      [...changed, ...rotating].forEach(e => unique.set(e.url, e));
      selected = Array.from(unique.values());
      mode = changed.length ? 'incremental-sitemap+rotation' : 'incremental-rotation';
    }

    const maxUrls = Number(process.env.MAX_CATALOG_URLS_PER_STORE || 100000);
    selected = selected.slice(0, maxUrls);

    const concurrency = Math.max(1, Number(process.env.CATALOG_CONCURRENCY || 16));
    const products = [];
    let index = 0;

    const worker = async () => {
      while (true) {
        const i = index++;
        if (i >= selected.length) return;
        const product = await this.getProductFromUrl(selected[i].url);
        if (product && product.name && product.price && product.url) {
          product.sourceLastmod = selected[i].lastmod || null;
          products.push(product);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));

    const manifest = {};
    for (const entry of entries.slice(0, Number(process.env.MAX_DISCOVERED_URLS_PER_STORE || 250000))) {
      const old = previous[entry.url];
      manifest[entry.url] = {
        lastmod: entry.lastmod || null,
        lastChecked: old?.lastChecked || null
      };
    }
    for (const product of products) {
      manifest[product.url] = {
        lastmod: product.sourceLastmod || manifest[product.url]?.lastmod || null,
        lastChecked: new Date().toISOString()
      };
    }

    return {
      products,
      manifest,
      stats: {
        discoveredUrls: entries.length,
        selectedUrls: selected.length,
        parsedProducts: products.length,
        mode,
        fullCatalog: isFull
      }
    };
  }

  async crawl() {
    const result = await this.crawlCatalog({ full: true });
    return result.products;
  }
}

module.exports = BaseScraper;
