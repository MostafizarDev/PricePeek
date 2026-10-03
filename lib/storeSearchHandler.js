const { normalizeProduct } = require('./normalize');

function cleanQuery(value) {
  return String(value || '').trim().slice(0, 160);
}

function safeNormalize(product) {
  try { return normalizeProduct(product); }
  catch (error) {
    console.error('[store-search] normalize error:', error);
    return null;
  }
}

function createStoreSearchHandler(Scraper, marketplace) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const query = cleanQuery(req.query.q);

    if (query.length < 2) {
      return res.status(400).json({
        products: [],
        errors: [{ marketplace, error: 'Please enter a product name.' }],
        sources: [{ marketplace, productCount: 0, latencyMs: 0, error: 'Please enter a product name.' }],
        query
      });
    }

    const started = Date.now();

    try {
      const scraper = new Scraper();
      const rawProducts = await scraper.search(query);
      const products = (Array.isArray(rawProducts) ? rawProducts : [])
        .map(safeNormalize)
        .filter(product =>
          product &&
          product.name &&
          Number.isFinite(Number(product.price)) &&
          product.url
        )
        .slice(0, 30);

      return res.status(200).json({
        products,
        errors: [],
        sources: [{
          marketplace: scraper.marketplace || marketplace,
          productCount: products.length,
          latencyMs: Date.now() - started,
          error: null
        }],
        query,
        marketplace: scraper.marketplace || marketplace,
        fetchedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('[' + marketplace + '] scraper failed:', error);

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
        query,
        marketplace,
        fetchedAt: new Date().toISOString()
      });
    }
  };
}

module.exports = { createStoreSearchHandler };
