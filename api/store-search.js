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
const { normalizeProduct } = require('../lib/normalize');
const { getStoreStatus } = require('../lib/storeRegistry');

const STORES = {
  daraz: DarazScraper,
  startech: StarTechScraper,
  ryans: RyansScraper,
  rokomari: RokomariScraper,
  pickaboo: PickabooScraper,
  gadgetgear: GadgetGearScraper,
  techland: TechLandScraper,
  othoba: OthobaScraper,
  ajkerdeal: AjkerDealScraper,
  bagdoom: BagdoomScraper,
  sumashtech: SumashTechScraper,
  dazzle: DazzleScraper,
  applegadgets: AppleGadgetsScraper,
  shajgoj: ShajgojScraper,
  chaldal: ChaldalScraper,
};

function cleanQuery(value) {
  return String(value || '').trim().slice(0, 160);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const storeId = String(req.query.store || '').toLowerCase().trim();
  const query = cleanQuery(req.query.q);

  if (!storeId || !STORES[storeId]) {
    return res.status(400).json({
      products: [],
      errors: [{ marketplace: 'PricePeekBD', error: 'Unknown marketplace.' }],
      storeStatus: getStoreStatus(),
    });
  }

  if (query.length < 2) {
    return res.status(400).json({
      products: [],
      errors: [{ marketplace: 'PricePeekBD', error: 'Please enter a product name.' }],
      storeStatus: getStoreStatus(),
    });
  }

  const started = Date.now();
  const Scraper = STORES[storeId];
  const scraper = new Scraper();

  try {
    const products = await scraper.search(query);
    const normalized = (products || [])
      .map(normalizeProduct)
      .filter(product => product && product.name && Number.isFinite(Number(product.price)) && product.url)
      .slice(0, 30);

    return res.json({
      products: normalized,
      errors: [],
      sources: [{
        marketplace: scraper.marketplace,
        productCount: normalized.length,
        latencyMs: Date.now() - started,
        error: null,
      }],
      storeStatus: getStoreStatus(),
      query,
      marketplace: scraper.marketplace,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[' + scraper.marketplace + '] store search error:', error);
    return res.json({
      products: [],
      errors: [{
        marketplace: scraper.marketplace,
        error: error?.message || 'Scraper failed',
        latencyMs: Date.now() - started,
      }],
      sources: [{
        marketplace: scraper.marketplace,
        productCount: 0,
        latencyMs: Date.now() - started,
        error: error?.message || 'Scraper failed',
      }],
      storeStatus: getStoreStatus(),
      query,
      marketplace: scraper.marketplace,
      fetchedAt: new Date().toISOString(),
    });
  }
};
