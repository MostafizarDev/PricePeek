const { normalizeProduct } = require('../lib/normalize');
const { getStoreStatus } = require('../lib/storeRegistry');

const STORE_MODULES = {
  daraz: ['Daraz', '../lib/daraz'],
  startech: ['Star Tech', '../lib/startech'],
  ryans: ['Ryans', '../lib/ryans'],
  rokomari: ['Rokomari', '../lib/rokomari'],
  pickaboo: ['Pickaboo', '../lib/pickaboo'],
  gadgetgear: ['Gadget & Gear', '../lib/gadgetgear'],
  techland: ['TechLand', '../lib/techland'],
  othoba: ['Othoba', '../lib/othoba'],
  ajkerdeal: ['AjkerDeal', '../lib/ajkerdeal'],
  bagdoom: ['Bagdoom', '../lib/bagdoom'],
  sumashtech: ['Sumash Tech', '../lib/sumashtech'],
  dazzle: ['Dazzle', '../lib/dazzle'],
  applegadgets: ['Apple Gadgets', '../lib/applegadgets'],
  shajgoj: ['Shajgoj', '../lib/shajgoj'],
  chaldal: ['Chaldal', '../lib/chaldal'],
};

function cleanQuery(value) {
  return String(value || '').trim().slice(0, 160);
}

function jsonError(res, status, marketplace, message, query = '') {
  return res.status(status).json({
    products: [],
    errors: [{ marketplace, error: message }],
    sources: [{
      marketplace,
      productCount: 0,
      latencyMs: 0,
      error: message
    }],
    storeStatus: getStoreStatus(),
    query,
    fetchedAt: new Date().toISOString()
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const storeId = String(req.query.store || '').toLowerCase().trim();
  const query = cleanQuery(req.query.q);

  if (!storeId || !STORE_MODULES[storeId]) {
    return jsonError(res, 400, 'PricePeekBD', 'Unknown marketplace.', query);
  }

  if (query.length < 2) {
    return jsonError(res, 400, STORE_MODULES[storeId][0], 'Please enter a product name.', query);
  }

  const [marketplace] = STORE_MODULES[storeId];
  const started = Date.now();

  let Scraper;
  try {
    // Load only the requested scraper. A broken optional scraper can no longer
    // crash the entire /api/store-search function for every marketplace.
    Scraper = require(STORE_MODULES[storeId][1]);
  } catch (error) {
    console.error(`[store-load:${storeId}] module load failed:`, error);
    return jsonError(
      res,
      200,
      marketplace,
      `Scraper module could not be loaded: ${error?.message || 'module load failed'}`,
      query
    );
  }

  try {
    const scraper = new Scraper();
    const products = await scraper.search(query);

    const normalized = (Array.isArray(products) ? products : [])
      .map(product => {
        try {
          return normalizeProduct(product);
        } catch (error) {
          console.error(`[${marketplace}] normalize error:`, error);
          return null;
        }
      })
      .filter(product =>
        product &&
        product.name &&
        Number.isFinite(Number(product.price)) &&
        product.url
      )
      .slice(0, 30);

    return res.status(200).json({
      products: normalized,
      errors: [],
      sources: [{
        marketplace: scraper.marketplace || marketplace,
        productCount: normalized.length,
        latencyMs: Date.now() - started,
        error: null
      }],
      storeStatus: getStoreStatus(),
      query,
      marketplace: scraper.marketplace || marketplace,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[${marketplace}] store search error:`, error);

    // Keep the store isolated: a scraper failure returns structured JSON
    // instead of turning the entire multi-store search into a 500.
    return res.status(200).json({
      products: [],
      errors: [{
        marketplace,
        error: error?.message || 'Scraper failed',
        latencyMs: Date.now() - started
      }],
      sources: [{
        marketplace,
        productCount: 0,
        latencyMs: Date.now() - started,
        error: error?.message || 'Scraper failed'
      }],
      storeStatus: getStoreStatus(),
      query,
      marketplace,
      fetchedAt: new Date().toISOString()
    });
  }
};
