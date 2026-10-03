class PricePeekAPI {
  async request(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 12000;
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
      catch { throw new Error('Crawler API returned an invalid response.'); }

      if (!response.ok) {
        throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
      }

      return data || {};
    } finally {
      clearTimeout(timer);
    }
  }

  async searchAll(query) {
    return this.request(`/api/search?q=${encodeURIComponent(query)}`, { timeoutMs: 12000 });
  }

  async searchByUrl(url) {
    return this.request(`/api/search?url=${encodeURIComponent(url)}`, { timeoutMs: 12000 });
  }
}

const scraperManager = new PricePeekAPI();
