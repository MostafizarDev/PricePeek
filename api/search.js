const axios = require('axios');
const productMatcher = require('../lib/matcher');
const { groupProducts } = productMatcher;
const { buildDeals } = require('../lib/deals');

const SHEETS_WEB_APP_URL = String(process.env.SHEETS_WEB_APP_URL || '').trim();
const CACHE_TTL = 60 * 1000;
const cache = new Map();

function extractProductNameFromUrl(input) {
  try {
    const { pathname } = new URL(input);
    const lastSegment = pathname.split('/').filter(Boolean).pop();
    return lastSegment
      ? decodeURIComponent(lastSegment).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
  } catch {
    return '';
  }
}

function scoreProduct(product, query) {
  const tokens = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const text = [
    product.name, product.brand, product.model,
    product.category, product.subcategory, product.sellerName
  ].map(v => String(v || '').toLowerCase()).join(' ');
  if (!tokens.length) return 0;
  return tokens.filter(token => text.includes(token)).length / tokens.length;
}

async function getStoreStatus() {
  const response = await axios.get(SHEETS_WEB_APP_URL, {
    params: { action: 'stores' },
    timeout: 12000,
  });
  if (response.data?.ok === false) throw new Error(response.data.error || 'Store status failed');
  return Array.isArray(response.data?.stores) ? response.data.stores : [];
}

async function readStoreData(query, store) {
  const response = await axios.get(SHEETS_WEB_APP_URL, {
    params: { action: 'search', q: query, store: store.id },
    timeout: 20000,
  });

  if (response.data?.ok === false) {
    throw new Error(response.data.error || 'Store search failed');
  }

  return {
    store,
    products: Array.isArray(response.data?.products) ? response.data.products : []
  };
}

async function readCrawlerData(query) {
  if (!SHEETS_WEB_APP_URL) {
    throw new Error('Crawler data source is not configured. Set SHEETS_WEB_APP_URL in Vercel environment variables.');
  }

  const stores = await getStoreStatus();
  const activeStores = stores.filter(store => store.status !== 'failed');

  const settled = await Promise.allSettled(
    activeStores.map(store => readStoreData(query, store))
  );

  const products = [];
  const storeStatus = [];
  const errors = [];

  settled.forEach((result, index) => {
    const store = activeStores[index];
    if (result.status === 'fulfilled') {
      products.push(...result.value.products);
      storeStatus.push({
        id: store.id,
        name: store.name,
        status: store.status || 'active',
        productCount: store.productCount || 0,
        lastCrawl: store.lastCrawl || null,
        error: null,
        matchedCount: result.value.products.length
      });
    } else {
      const message = result.reason?.message || 'Store search failed';
      errors.push({ marketplace: store.name, error: message });
      storeStatus.push({
        id: store.id,
        name: store.name,
        status: 'error',
        productCount: store.productCount || 0,
        lastCrawl: store.lastCrawl || null,
        error: message,
        matchedCount: 0
      });
    }
  });

  return {
    products,
    stores: activeStores.map(s => s.name),
    storeStatus,
    errors
  };
}

async function searchAll(query) {
  const key = String(query).trim().toLowerCase();
  const cached = cache.get(key);

  let data;
  let cachedFlag = false;

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    data = cached.data;
    cachedFlag = true;
  } else {
    data = await readCrawlerData(query);
    cache.set(key, { data, timestamp: Date.now() });
  }

  const products = (Array.isArray(data.products) ? data.products : [])
    .map(product => ({ ...product, _score: scoreProduct(product, query) }))
    .filter(product => product._score > 0)
    .sort((a, b) =>
      b._score - a._score ||
      Number(a.price || Infinity) - Number(b.price || Infinity)
    )
    .slice(0, 1000);

  const normalizedProducts = products.map(({ _score, ...product }) => product);
  const productGroups = groupProducts(normalizedProducts);

  return {
    products: normalizedProducts.slice(0, 300),
    productGroups,
    deals: buildDeals(productGroups),
    errors: data.errors || [],
    sources: Array.isArray(data.storeStatus)
      ? data.storeStatus.map(store => ({
          marketplace: store.name,
          productCount: store.productCount || 0,
          matchedCount: store.matchedCount || 0,
          error: store.error || null
        }))
      : [],
    cached: cachedFlag,
    fetchedAt: new Date().toISOString(),
    storeStatus: data.storeStatus || []
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const { q, url } = req.query;

  try {
    let query = String(q || '').trim();

    if (url) {
      let decodedUrl = decodeURIComponent(String(url)).trim();
      if (/^www\./i.test(decodedUrl)) decodedUrl = 'https://' + decodedUrl;
      else if (/^[^:/?#]+\.[a-z]{2,}(?:\/|$)/i.test(decodedUrl)) decodedUrl = 'https://' + decodedUrl;

      query = extractProductNameFromUrl(decodedUrl);
      if (!query) {
        return res.status(400).json({
          products: [],
          errors: [{ message: 'Could not identify the product from this URL.' }]
        });
      }
    }

    if (query.length < 2) {
      return res.status(400).json({ error: 'Please enter a product name.' });
    }

    const result = await searchAll(query);

    return res.status(200).json({
      ...result,
      query,
      fetchedAt: new Date().toISOString(),
      dataSource: 'crawler'
    });
  } catch (error) {
    console.error('[PricePeek] crawler search error:', error);
    return res.status(503).json({
      error: 'Crawler data is temporarily unavailable.',
      message: error.message,
      products: [],
      errors: [{ marketplace: 'PricePeekBD', error: error.message }],
      dataSource: 'crawler'
    });
  }
};
