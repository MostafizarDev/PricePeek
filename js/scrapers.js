class PricePeekAPI {
  async request(url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch { throw new Error('PricePeek API returned an invalid response.'); }
    if (!response.ok) {
      const message = data?.error || data?.message || `Request failed (${response.status})`;
      throw new Error(message);
    }
    return data || {};
  }

  async searchAll(query) {
    try {
      const data = await this.request(`/api/search?q=${encodeURIComponent(query)}`);
      return {
        products: Array.isArray(data.products) ? data.products : [],
        errors: Array.isArray(data.errors) ? data.errors : [],
        sources: Array.isArray(data.sources) ? data.sources : [],
        productGroups: Array.isArray(data.productGroups) ? data.productGroups : [],
        deals: Array.isArray(data.deals) ? data.deals : [],
        cached: Boolean(data.cached),
        fetchedAt: data.fetchedAt || null,
        storeStatus: Array.isArray(data.storeStatus) ? data.storeStatus : []
      };
    } catch (error) {
      return {
        products: [], errors: [{ marketplace: 'PricePeekBD', error: error.message || 'Search failed' }],
        sources: [], productGroups: [], deals: [], cached: false, fetchedAt: null, storeStatus: []
      };
    }
  }

  async searchByUrl(url) {
    try {
      return await this.request(`/api/search?url=${encodeURIComponent(url)}`);
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
