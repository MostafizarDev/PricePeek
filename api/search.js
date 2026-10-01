const DarazScraper = require('../lib/daraz');
const StarTechScraper = require('../lib/startech');
const RyansScraper = require('../lib/ryans');
const RokomariScraper = require('../lib/rokomari');
const PickabooScraper = require('../lib/pickaboo');
const GadgetGearScraper = require('../lib/gadgetgear');
const TechLandScraper = require('../lib/techland');
const OthobaScraper = require('../lib/othoba');
const AjkerDealScraper = require('../lib/ajkerdeal');
const BagdoomScraper = require('../lib/bagdoom');
const SumashTechScraper = require('../lib/sumashtech');
const DazzleScraper = require('../lib/dazzle');
const AppleGadgetsScraper = require('../lib/applegadgets');
const ShajgojScraper = require('../lib/shajgoj');
const ChaldalScraper = require('../lib/chaldal');
const productMatcher = require('../lib/matcher');
const { normalizeProduct } = require('../lib/normalize');
const { getStoreStatus } = require('../lib/storeRegistry');
const { groupProducts } = productMatcher;
const { saveSnapshots } = require('../lib/priceHistory');
const { buildDeals } = require('../lib/deals');

const scrapers = [
  new DarazScraper(),
  new StarTechScraper(),
  new RyansScraper(),
  new RokomariScraper(),
  new PickabooScraper(),
  new GadgetGearScraper(),
  new TechLandScraper(),
  new OthobaScraper(),
  new AjkerDealScraper(),
  new BagdoomScraper(),
  new SumashTechScraper(),
  new DazzleScraper(),
  new AppleGadgetsScraper(),
  new ShajgojScraper(),
  new ChaldalScraper(),
];

const cache = new Map();
const CACHE_TTL = 30 * 1000;

function extractProductNameFromUrl(input) {
  try {
    const { pathname } = new URL(input);
    const lastSegment = pathname.split('/').filter(Boolean).pop();
    return lastSegment
      ? decodeURIComponent(lastSegment).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
  } catch { return ''; }
}

function scoreProduct(product, query) {
  const tokens = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const name = String(product.name || '').toLowerCase();
  const matched = tokens.filter(token => name.includes(token)).length;
  return matched / tokens.length;
}

async function runScraper(scraper, query) {
  const started = Date.now();
  const SCRAPER_BUDGET_MS = 6500;
  try {
    const products = await Promise.race([
      scraper.search(query),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Marketplace scraper timeout')), SCRAPER_BUDGET_MS)
      ),
    ]);
    return {
      marketplace: scraper.marketplace,
      products: (products || []).map(normalizeProduct),
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (error) {
    return {
      marketplace: scraper.marketplace,
      products: [],
      latencyMs: Date.now() - started,
      error: error?.message || 'Scraper failed',
    };
  }
}

async function searchAll(query) {
  const settled = await Promise.all(
    scrapers.map(scraper => runScraper(scraper, query))
  );

  const products = settled.flatMap(item => item.products);
  const errors = settled
    .filter(item => item.error)
    .map(item => ({ marketplace: item.marketplace, error: item.error, latencyMs: item.latencyMs }));

  const scored = products
    .map(product => ({ ...product, _score: scoreProduct(product, query) }))
    .sort((a, b) => b._score - a._score || (a.price ?? Infinity) - (b.price ?? Infinity));

  const normalizedProducts = scored.map(({ _score, ...product }) => product);
  const productGroups = groupProducts(normalizedProducts);

  await saveSnapshots(normalizedProducts);

  return {
    products: normalizedProducts,
    productGroups,
    deals: buildDeals(productGroups),
    errors,
    sources: settled.map(({ products: _, ...source }) => source),
  };
}

function sourceFromUrl(decodedUrl) {
  return scrapers.find(scraper => {
    try { return decodedUrl.includes(new URL(scraper.baseUrl).hostname); } catch { return false; }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const { q, url } = req.query;

  try {
    if (url) {
      let decodedUrl = decodeURIComponent(url).trim();
      if (/^www\./i.test(decodedUrl)) decodedUrl = 'https://' + decodedUrl;
      else if (/^[^:/?#]+\.[a-z]{2,}(?:\/|$)/i.test(decodedUrl)) decodedUrl = 'https://' + decodedUrl;
      let sourceProduct = null;
      const sourceScraper = sourceFromUrl(decodedUrl);

      if (sourceScraper?.getProductFromUrl) {
        try { sourceProduct = await sourceScraper.getProductFromUrl(decodedUrl); } catch {}
      }

      const searchQuery = sourceProduct?.name
        ? productMatcher.extractSearchKey(sourceProduct.name)
        : extractProductNameFromUrl(decodedUrl);

      if (!searchQuery) {
        return res.status(400).json({ products: [], errors: [{ message: 'Could not identify the product from this URL.' }] });
      }

      const key = `url:${searchQuery.toLowerCase()}`;
      const cached = cache.get(key);
      const result = cached && Date.now() - cached.timestamp < CACHE_TTL
        ? { ...cached.data, cached: true }
        : await searchAll(searchQuery);

      if (!cached || Date.now() - cached.timestamp >= CACHE_TTL) {
        cache.set(key, { data: result, timestamp: Date.now() });
      }

      if (sourceProduct?.name) {
        const normalizedSource = normalizeProduct({ ...sourceProduct, url: decodedUrl });
        const withoutDuplicate = result.products.filter(p => p.url !== decodedUrl);
        result.products = [normalizedSource, ...withoutDuplicate];
        result.productGroups = groupProducts(result.products);
        result.deals = buildDeals(result.productGroups);
      }

      return res.json({
        ...result,
        sourceProduct: sourceProduct ? normalizeProduct({ ...sourceProduct, url: decodedUrl }) : null,
        query: searchQuery,
        fetchedAt: new Date().toISOString(),
        storeStatus: getStoreStatus(),
      });
    }

    if (!q || String(q).trim().length < 2) {
      return res.status(400).json({ error: 'Please enter a product name or product URL.' });
    }

    const query = String(q).trim().slice(0, 160);
    const key = `search:${query.toLowerCase()}`;
    const cached = cache.get(key);

    let result;
    let cachedFlag = false;
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      result = cached.data;
      cachedFlag = true;
    } else {
      result = await searchAll(query);
      cache.set(key, { data: result, timestamp: Date.now() });
    }

    return res.json({
      ...result,
      cached: cachedFlag,
      query,
      fetchedAt: new Date().toISOString(),
      storeStatus: getStoreStatus(),
    });
  } catch (error) {
    console.error('[PricePeek] search error', error);
    return res.status(500).json({
      error: 'Price comparison failed.',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      products: [],
    });
  }
};