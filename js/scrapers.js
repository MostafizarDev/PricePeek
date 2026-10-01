class PricePeekAPI {
  async request(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 6500;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store'
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; }
      catch { throw new Error('PricePeek API returned an invalid response.'); }

      if (!response.ok) {
        const message = data?.error || data?.message || `Request failed (${response.status})`;
        throw new Error(message);
      }
      return data || {};
    } finally {
      clearTimeout(timer);
    }
  }

  async searchAll(query) {
    const stores = [
      'daraz',
      'startech',
      'ryans',
      'rokomari',
      'pickaboo',
      'gadgetgear',
      'techland',
      'othoba',
      'ajkerdeal',
      'bagdoom',
      'sumashtech',
      'dazzle',
      'applegadgets',
      'shajgoj',
      'chaldal'
    ];

    const products = [];
    const errors = [];
    const sources = [];

    // Query stores in small batches. Each store is its own Vercel Function,
    // so one broken/slow marketplace can never make the whole search endpoint 504.
    const batchSize = 5;

    for (let start = 0; start < stores.length; start += batchSize) {
      const batch = stores.slice(start, start + batchSize);

      const results = await Promise.all(
        batch.map(async store => {
          try {
            return await this.request(
              `/api/store-search?store=${encodeURIComponent(store)}&q=${encodeURIComponent(query)}`,
              { timeoutMs: 6500 }
            );
          } catch (error) {
            return {
              products: [],
              errors: [{ marketplace: store, error: error?.message || 'Store request failed' }],
              sources: [{
                marketplace: store,
                productCount: 0,
                latencyMs: null,
                error: error?.message || 'Store request failed'
              }]
            };
          }
        })
      );

      for (const data of results) {
        if (Array.isArray(data.products)) products.push(...data.products);
        if (Array.isArray(data.errors)) errors.push(...data.errors);
        if (Array.isArray(data.sources)) sources.push(...data.sources);
      }
    }

    // Remove exact duplicate listings while keeping the original store URL.
    const seen = new Set();
    const uniqueProducts = products.filter(product => {
      const key = [
        String(product.marketplace || '').toLowerCase(),
        String(product.url || '').trim(),
        String(product.name || '').toLowerCase().trim(),
        Number(product.price || 0)
      ].join('|');

      if (!product.name || !product.url || !Number.isFinite(Number(product.price)) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    const tokens = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    uniqueProducts.sort((a, b) => {
      const score = product => {
        const name = String(product.name || '').toLowerCase();
        return tokens.length
          ? tokens.filter(token => name.includes(token)).length / tokens.length
          : 0;
      };
      return score(b) - score(a) || Number(a.price) - Number(b.price);
    });

    return {
      products: uniqueProducts,
      errors,
      sources,
      productGroups: [],
      deals: [],
      cached: false,
      fetchedAt: new Date().toISOString(),
      storeStatus: []
    };
  }

  async searchByUrl(url) {
    try {
      return await this.request(`/api/search?url=${encodeURIComponent(url)}`, { timeoutMs: 15000 });
    } catch (error) {
      return {
        products: [], productGroups: [], deals: [],
        errors: [{ marketplace: 'PricePeekBD', error: error.message || 'URL search failed' }],
        sourceProduct: null, storeStatus: []
      };
    }
  }
}

const scraperManager = new PricePeekAPI();
