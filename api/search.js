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
  const name = String(product.name || '').toLowerCase();
  if (!tokens.length) return 0;
  return tokens.filter(token => name.includes(token)).length / tokens.length;
}

async function readCrawlerData(query) {
  if (!SHEETS_WEB_APP_URL) {
    throw new Error('Crawler data source is not configured. Set SHEETS_WEB_APP_URL in Vercel environment variables.');
  }

  const response = await axios.get(SHEETS_WEB_APP_URL, {
    params: { action: 'search', q: query },
    timeout: 12000,
  });

  if (response.data?.ok === false) {
    throw new Error(response.data.error || 'Crawler data source failed.');
  }

  return response.data || { products: [], stores: [] };
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
    .sort((a, b) => b._score - a._score || Number(a.price || Infinity) - Number(b.price || Infinity))
    .slice(0, 300);

  const normalizedProducts = products.map(({ _score, ...product }) => product);
  const productGroups = groupProducts(normalizedProducts);

  return {
    products: normalizedProducts,
    productGroups,
    deals: buildDeals(productGroups),
    errors: [],
    sources: Array.isArray(data.stores)
      ? data.stores.map(store => ({ marketplace: store, productCount: normalizedProducts.filter(p => p.marketplace === store).length, error: null }))
      : [],
    cached: cachedFlag,
    fetchedAt: new Date().toISOString(),
    storeStatus: Array.isArray(data.stores)
      ? data.stores.map(store => ({ id: String(store).toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: store, status: 'active' }))
      : []
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
        return res.status(400).json({ products: [], errors: [{ message: 'Could not identify the product from this URL.' }] });
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
