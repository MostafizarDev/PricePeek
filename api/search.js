const axios = require('axios');
const { resolveStores } = require('../lib/storeRegistry');
const { normalizeProduct } = require('../lib/normalize');

const CACHE_TTL = 60 * 1000;
const STORE_TIMEOUT = 9000;
const cache = new Map();

function cleanQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function scoreProduct(product, query) {
  const tokens = cleanQuery(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;

  const text = [
    product.name,
    product.brand,
    product.model,
    product.category,
    product.subcategory
  ].map(value => String(value || '').toLowerCase()).join(' ');

  return tokens.filter(token => text.includes(token)).length / tokens.length;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms);
    })
  ]);
}

async function searchStore(store, query) {
  const started = Date.now();

  try {
    const scraper = new store.Scraper();
    const raw = await withTimeout(
      scraper.search(query),
      STORE_TIMEOUT,
      store.name
    );

    const products = (Array.isArray(raw) ? raw : [])
      .map(product => {
        try { return normalizeProduct(product); }
        catch { return null; }
      })
      .filter(product => product && product.name && product.url && product.price != null)
      .map(product => ({ ...product, _score: scoreProduct(product, query) }))
      .filter(product => product._score > 0)
      .sort((a, b) => b._score - a._score || Number(a.price) - Number(b.price))
      .slice(0, 30);

    return {
      id: store.id,
      marketplace: store.name,
      products,
      source: {
        marketplace: store.name,
        productCount: products.length,
        latencyMs: Date.now() - started,
        error: null
      }
    };
  } catch (error) {
    return {
      id: store.id,
      marketplace: store.name,
      products: [],
      source: {
        marketplace: store.name,
        productCount: 0,
        latencyMs: Date.now() - started,
        error: error?.message || 'Store search failed'
      }
    };
  }
}

async function searchAll(query, selection) {
  const stores = resolveStores(selection, query);
  const cacheKey = cleanQuery(query).toLowerCase() + '::' + stores.map(store => store.id).join(',');

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { ...cached.data, cached: true };
  }

  const settled = await Promise.allSettled(
    stores.map(store => searchStore(store, query))
  );

  const products = [];
  const sources = [];
  const errors = [];

  settled.forEach((result, index) => {
    const store = stores[index];

    if (result.status === 'fulfilled') {
      const data = result.value;
      products.push(...data.products);
      sources.push(data.source);

      if (data.source.error) {
        errors.push({
          marketplace: store.name,
          error: data.source.error
        });
      }
    } else {
      const message = result.reason?.message || 'Store search failed';
      sources.push({
        marketplace: store.name,
        productCount: 0,
        latencyMs: 0,
        error: message
      });
      errors.push({
        marketplace: store.name,
        error: message
      });
    }
  });

  products.sort((a, b) =>
    b._score - a._score ||
    Number(a.price || Infinity) - Number(b.price || Infinity)
  );

  const cleanProducts = products
    .slice(0, 300)
    .map(({ _score, ...product }) => product);

  const data = {
    products: cleanProducts,
    errors,
    sources,
    storeSelection: selection || 'smart',
    stores: stores.map(store => ({
      id: store.id,
      name: store.name,
      tier: store.tier
    })),
    cached: false,
    fetchedAt: new Date().toISOString()
  };

  cache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const query = cleanQuery(req.query.q);

  if (query.length < 2) {
    return res.status(400).json({
      products: [],
      errors: [{ marketplace: 'PricePeekBD', error: 'Please enter a product name.' }]
    });
  }

  try {
    const result = await searchAll(query, req.query.stores);

    return res.status(200).json({
      ...result,
      query,
      dataSource: 'live'
    });
  } catch (error) {
    console.error('[PricePeek] live search error:', error);

    return res.status(503).json({
      products: [],
      errors: [{ marketplace: 'PricePeekBD', error: error?.message || 'Live search failed' }],
      query,
      dataSource: 'live'
    });
  }
};
