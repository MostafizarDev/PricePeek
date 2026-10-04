const axios = require('axios');
const { resolveStores } = require('../lib/storeRegistry');
const { normalizeProduct } = require('../lib/normalize');
const { matchProducts } = require('../lib/productMatcher');
const { findBestDeal } = require('../lib/bestDeal');

const CACHE_TTL = 60 * 1000;
const STORE_TIMEOUT = 6500;
const CACHE_MAX_ENTRIES = 200;
const cache = new Map();
const inFlight = new Map();

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

function attachDarazSellerOffers(products, marketplace) {
  if (marketplace !== 'Daraz') return products;

  const groups = new Map();
  for (const product of products) {
    const key = product.normalizedName || String(product.name || '').toLowerCase().trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }

  for (const offers of groups.values()) {
    const unique = new Map();
    for (const offer of offers) {
      const sellerKey = String(offer.sellerId || offer.sellerName || offer.url || offer.id || '').trim().toLowerCase();
      if (!sellerKey) continue;
      if (!unique.has(sellerKey)) unique.set(sellerKey, offer);
    }

    const sellerOffers = Array.from(unique.values())
      .sort((a, b) => Number(a.price || Infinity) - Number(b.price || Infinity))
      .map((offer, index) => ({
        id: offer.id,
        price: offer.price,
        originalPrice: offer.originalPrice,
        discount: offer.discount,
        url: offer.url,
        sellerName: offer.sellerName || null,
        sellerId: offer.sellerId || null,
        sellerUrl: offer.sellerUrl || null,
        sellerRating: offer.sellerRating || null,
        sellerPositiveRate: offer.sellerPositiveRate || null,
        sellerFollowers: offer.sellerFollowers || null,
        isOfficial: offer.isOfficial === true,
        inStock: offer.inStock !== false,
        rank: index + 1
      }));

    for (const product of offers) {
      product.sellerOffers = sellerOffers;
      product.sellerCount = sellerOffers.length;
      product.sellerOfferRank = sellerOffers.find(item => item.id === product.id)?.rank || null;
    }
  }

  return products;
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
      .sort((a, b) => b._score - a._score || Number(a.price) - Number(b.price))
      .slice(0, 30);

    attachDarazSellerOffers(products, store.name);

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

  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const run = (async () => {
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

  const candidateProducts = products.slice(0, 300);
  const matched = matchProducts(candidateProducts, query);

  const cleanProducts = matched.products
    .map(({ _score, ...product }) => product);

  const cleanExactProducts = matched.exactProducts
    .map(({ _score, ...product }) => product);

  const cleanSimilarProducts = matched.similarProducts
    .map(({ _score, ...product }) => product);

  const deal = findBestDeal(cleanExactProducts);

  const data = {
    products: cleanProducts,
    exactProducts: cleanExactProducts,
    similarProducts: cleanSimilarProducts,
    exactProductCount: matched.exactProductCount,
    similarProductCount: matched.similarProductCount,
    matchStats: matched.matchStats,
    bestDeal: deal.bestDeal ? { id: deal.bestDeal.id, marketplace: deal.bestDeal.marketplace, price: deal.bestDeal.price, dealScore: deal.bestDeal.dealScore, badges: deal.badges[deal.bestDeal.id] || ['Best Deal'] } : null,
    dealBadges: deal.badges,
    dealScores: deal.scoredProducts.reduce((map, product) => { map[product.id] = product.dealScore; return map; }, {}),
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
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  return data;
  })();

  inFlight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    inFlight.delete(cacheKey);
  }
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
