const axios = require('axios');
const { normalizeProduct } = require('../lib/normalize');
const { getActiveStores } = require('../lib/storeRegistry');
const { STORE_MODULES, DEFAULT_QUERIES } = require('./config');
const catalogCache = require('./catalogCache');
const crypto = require('crypto');

const STORE_TIMEOUT_MS = Number(process.env.STORE_TIMEOUT_MS || 30 * 60 * 1000);
const STORE_CONCURRENCY = Math.max(1, Number(process.env.STORE_CONCURRENCY || 5));
const SHEETS_WEB_APP_URL = String(process.env.SHEETS_WEB_APP_URL || '').trim();
const CRAWLER_TOKEN = String(process.env.CRAWLER_TOKEN || '').trim();
const UPLOAD_BATCH_SIZE = Math.max(100, Number(process.env.UPLOAD_BATCH_SIZE || 500));
const MAX_PRODUCTS_PER_STORE = Math.max(1, Number(process.env.MAX_PRODUCTS_PER_STORE || 100000));
const FORCE_FULL_CRAWL = String(process.env.FORCE_FULL_CRAWL || '').toLowerCase() === 'true';
const ROTATION_SLOTS = Math.max(1, Number(process.env.PRICE_REFRESH_ROTATION_SLOTS || 12));

function timeoutPromise(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Store crawler timeout after ' + ms + 'ms')), ms)
  );
}

function getQueriesForStore(store) {
  try {
    const custom = JSON.parse(process.env.CRAWL_QUERIES_JSON || '{}');
    if (Array.isArray(custom[store.id]) && custom[store.id].length) return custom[store.id];
  } catch (error) {
    console.warn('[crawler] Invalid CRAWL_QUERIES_JSON:', error.message);
  }
  return DEFAULT_QUERIES;
}

function loadScraper(store) {
  const modulePath = STORE_MODULES[store.id];
  if (!modulePath) throw new Error('No scraper module configured for ' + store.id);
  const Scraper = require(modulePath);
  return new Scraper();
}

async function runSeedSearch(scraper, store) {
  const queries = getQueriesForStore(store);
  const results = [];
  for (const query of queries) {
    try {
      const products = await Promise.race([
        scraper.search(query),
        timeoutPromise(30000),
      ]);
      if (Array.isArray(products)) results.push(...products);
    } catch (error) {
      console.warn('[' + store.name + '] seed query failed:', query, error.message);
    }
  }
  return results;
}

function makeProductKey(raw, product) {
  const productId = String(
    raw.productId ||
    raw.externalProductId ||
    raw.sku ||
    raw.id ||
    ''
  ).trim();

  const sellerId = String(raw.sellerId || raw.sellerName || '').trim();

  if (productId) {
    return (productId + '::' + sellerId).toLowerCase();
  }

  const url = String(product.url || '').trim().toLowerCase();
  return (url + '::' + sellerId).toLowerCase();
}

async function runStore(store) {
  const started = Date.now();
  const runId = crypto.randomUUID();
  const cache = catalogCache.load(store.id);
  const full = FORCE_FULL_CRAWL || Object.keys(cache.entries).length < 100;

  try {
    const scraper = loadScraper(store);
    let products = [];
    let stats = {
      discoveredUrls: 0,
      selectedUrls: 0,
      parsedProducts: 0,
      mode: 'failed',
      fullCatalog: full
    };

    try {
      const result = await Promise.race([
        scraper.crawlCatalog({
          previousManifest: cache.entries,
          full,
          rotationSlot: cache.rotationSlot % ROTATION_SLOTS
        }),
        timeoutPromise(STORE_TIMEOUT_MS),
      ]);

      products = Array.isArray(result?.products) ? result.products : [];
      stats = result?.stats || stats;

      if (result?.manifest && Object.keys(result.manifest).length) {
        catalogCache.save(store.id, {
          entries: result.manifest,
          rotationSlot: (cache.rotationSlot + 1) % ROTATION_SLOTS
        });
      }
    } catch (error) {
      console.warn('[' + store.name + '] catalog crawl failed:', error.message);
    }

    if (!products.length && full) {
      stats.mode = 'seed-search-fallback';
      products = await runSeedSearch(scraper, store);
      stats.parsedProducts = products.length;
      stats.selectedUrls = products.length;
    }

    const finalized = finalizeStore(store, products, stats, runId, Date.now() - started);
    return finalized;
  } catch (error) {
    return {
      storeId: store.id,
      marketplace: store.name,
      ok: false,
      products: [],
      mode: 'failed',
      fullCatalog: false,
      discoveredUrls: 0,
      selectedUrls: 0,
      parsedProducts: 0,
      latencyMs: Date.now() - started,
      runId,
      error: error?.message || 'Crawler failed',
    };
  }
}

function finalizeStore(store, rawProducts, stats, runId, latencyMs) {
  const seen = new Set();
  const products = [];

  for (const raw of Array.isArray(rawProducts) ? rawProducts : []) {
    try {
      const product = normalizeProduct({ ...raw, marketplace: store.name });
      if (!product.name || product.price == null || !product.url) continue;

      const key = makeProductKey(raw, product);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      products.push({
        ...product,
        externalProductId: key,
        storeId: store.id,
      });

      if (products.length >= MAX_PRODUCTS_PER_STORE) break;
    } catch (error) {
      console.warn('[' + store.name + '] product normalize failed:', error.message);
    }
  }

  return {
    storeId: store.id,
    marketplace: store.name,
    ok: products.length > 0,
    products,
    mode: stats.mode || 'unknown',
    fullCatalog: Boolean(stats.fullCatalog),
    discoveredUrls: Number(stats.discoveredUrls || 0),
    selectedUrls: Number(stats.selectedUrls || products.length),
    parsedProducts: Number(stats.parsedProducts || products.length),
    latencyMs,
    runId,
    startedAt: new Date(Date.now() - latencyMs).toISOString(),
    error: products.length ? null : 'No products returned',
  };
}

async function post(payload) {
  const response = await axios.post(
    SHEETS_WEB_APP_URL,
    payload,
    {
      timeout: 120000,
      maxContentLength: 20 * 1024 * 1024,
      maxBodyLength: 20 * 1024 * 1024,
    }
  );

  if (response.status < 200 || response.status >= 300 || response.data?.ok === false) {
    throw new Error(response.data?.error || 'Google Sheets API failed');
  }
  return response.data;
}

async function pushStoreResult(result) {
  if (!SHEETS_WEB_APP_URL) throw new Error('SHEETS_WEB_APP_URL is not configured');
  if (!CRAWLER_TOKEN) throw new Error('CRAWLER_TOKEN is not configured');

  if (!result.products.length) {
    await post({
      action: 'status',
      token: CRAWLER_TOKEN,
      store: result
    });
    return { ok: false, received: 0 };
  }

  const totalBatches = Math.ceil(result.products.length / UPLOAD_BATCH_SIZE);

  for (let i = 0; i < result.products.length; i += UPLOAD_BATCH_SIZE) {
    const batch = result.products.slice(i, i + UPLOAD_BATCH_SIZE);
    await post({
      action: 'stage',
      token: CRAWLER_TOKEN,
      runId: result.runId,
      store: {
        id: result.storeId,
        name: result.marketplace
      },
      products: batch
    });

    console.log(
      '[' + result.marketplace + '] staged ' +
      Math.min(i + batch.length, result.products.length) +
      '/' + result.products.length +
      ' batch ' + (Math.floor(i / UPLOAD_BATCH_SIZE) + 1) + '/' + totalBatches
    );
  }

  const finalized = await post({
    action: 'finalize',
    token: CRAWLER_TOKEN,
    runId: result.runId,
    store: {
      id: result.storeId,
      name: result.marketplace,
      mode: result.mode,
      fullCatalog: result.fullCatalog,
      discoveredUrls: result.discoveredUrls,
      selectedUrls: result.selectedUrls,
      parsedProducts: result.parsedProducts,
      startedAt: result.startedAt,
      crawledAt: new Date().toISOString(),
      ok: true
    }
  });

  return finalized;
}

async function runWithConcurrency(items, limit, worker) {
  const output = [];
  let index = 0;

  async function runner() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      output[current] = await worker(items[current]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runner)
  );

  return output;
}

async function main() {
  if (!SHEETS_WEB_APP_URL || !CRAWLER_TOKEN) {
    throw new Error('Missing SHEETS_WEB_APP_URL or CRAWLER_TOKEN GitHub secret');
  }

  const stores = getActiveStores();
  console.log('[crawler] Starting', stores.length, 'stores');
  console.log('[crawler] Max products/store:', MAX_PRODUCTS_PER_STORE);
  console.log('[crawler] Rotation slots:', ROTATION_SLOTS);
  console.log('[crawler] Full crawl forced:', FORCE_FULL_CRAWL);

  const results = await runWithConcurrency(stores, STORE_CONCURRENCY, runStore);
  let uploadedStores = 0;

  for (const result of results) {
    console.log(
      '[' + result.marketplace + ']',
      result.ok ? 'OK' : 'FAILED',
      result.products.length + ' products',
      result.mode,
      'discovered=' + result.discoveredUrls,
      'selected=' + result.selectedUrls,
      'latency=' + result.latencyMs + 'ms',
      result.error || ''
    );

    try {
      await pushStoreResult(result);
      uploadedStores++;
    } catch (error) {
      console.error('[' + result.marketplace + '] sheet finalize failed:', error.message);
    }
  }

  const successCount = results.filter(r => r.ok).length;
  const totalProducts = results.reduce((sum, r) => sum + r.products.length, 0);

  console.log(
    '[crawler] Finished:',
    successCount + '/' + results.length,
    'stores succeeded;',
    totalProducts,
    'products processed;',
    uploadedStores,
    'stores uploaded'
  );
}

main().catch(error => {
  console.error('[crawler] fatal:', error);
  process.exitCode = 1;
});
