const axios = require('axios');
const { normalizeProduct } = require('../lib/normalize');
const { getActiveStores } = require('../lib/storeRegistry');
const { STORE_MODULES, DEFAULT_QUERIES } = require('./config');

const STORE_TIMEOUT_MS = Number(process.env.STORE_TIMEOUT_MS || 8 * 60 * 1000);
const STORE_CONCURRENCY = Math.max(1, Number(process.env.STORE_CONCURRENCY || 5));
const SHEETS_WEB_APP_URL = String(process.env.SHEETS_WEB_APP_URL || '').trim();
const CRAWLER_TOKEN = String(process.env.CRAWLER_TOKEN || '').trim();
const UPLOAD_BATCH_SIZE = Math.max(50, Number(process.env.UPLOAD_BATCH_SIZE || 500));
const MAX_PRODUCTS_PER_STORE = Math.max(1, Number(process.env.MAX_PRODUCTS_PER_STORE || 10000));

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
        timeoutPromise(20000),
      ]);
      if (Array.isArray(products)) results.push(...products);
    } catch (error) {
      console.warn('[' + store.name + '] seed query failed:', query, error.message);
    }
  }
  return results;
}

async function runStore(store) {
  const started = Date.now();
  try {
    const scraper = loadScraper(store);

    // Every scraper now inherits the catalog crawler. It first tries the
    // store's robots/sitemap product URLs, then falls back to search seeds.
    let products = [];
    let mode = 'catalog-sitemap';

    try {
      products = await Promise.race([
        scraper.crawl(),
        timeoutPromise(STORE_TIMEOUT_MS),
      ]);
    } catch (error) {
      console.warn('[' + store.name + '] catalog crawl failed:', error.message);
    }

    if (!Array.isArray(products) || products.length === 0) {
      mode = 'seed-search-fallback';
      products = await runSeedSearch(scraper, store);
    }

    return finalizeStore(store, products, Date.now() - started, mode);
  } catch (error) {
    return {
      storeId: store.id,
      marketplace: store.name,
      ok: false,
      products: [],
      mode: 'failed',
      latencyMs: Date.now() - started,
      error: error?.message || 'Crawler failed',
    };
  }
}

function finalizeStore(store, rawProducts, latencyMs, mode) {
  const seen = new Set();
  const products = [];

  for (const raw of Array.isArray(rawProducts) ? rawProducts : []) {
    try {
      const product = normalizeProduct({ ...raw, marketplace: store.name });
      if (!product.name || product.price == null || !product.url) continue;

      const key = String(
        raw.productId ||
        raw.externalProductId ||
        raw.sku ||
        product.url
      ).trim().toLowerCase();

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
    mode,
    latencyMs,
    error: products.length ? null : 'No products returned',
  };
}

async function pushStoreBatch(result, products, batchNumber, totalBatches) {
  const response = await axios.post(
    SHEETS_WEB_APP_URL,
    {
      action: 'upsert',
      token: CRAWLER_TOKEN,
      store: {
        id: result.storeId,
        name: result.marketplace,
        mode: result.mode,
        ok: result.ok,
        error: result.error,
        latencyMs: result.latencyMs,
        crawledAt: new Date().toISOString(),
        batchNumber,
        totalBatches,
        fullCatalog: result.mode === 'catalog-sitemap',
      },
      products,
    },
    { timeout: 60000, maxContentLength: 10 * 1024 * 1024 }
  );

  if (response.status < 200 || response.status >= 300 || response.data?.ok === false) {
    throw new Error(response.data?.error || 'Google Sheets update failed');
  }
  return response.data;
}

async function pushStoreResult(result) {
  if (!SHEETS_WEB_APP_URL) throw new Error('SHEETS_WEB_APP_URL is not configured');
  if (!CRAWLER_TOKEN) throw new Error('CRAWLER_TOKEN is not configured');

  const products = result.products || [];
  const totalBatches = Math.max(1, Math.ceil(products.length / UPLOAD_BATCH_SIZE));

  if (!products.length) {
    return pushStoreBatch(result, [], 1, 1);
  }

  let uploaded = 0;
  for (let i = 0; i < products.length; i += UPLOAD_BATCH_SIZE) {
    const batch = products.slice(i, i + UPLOAD_BATCH_SIZE);
    await pushStoreBatch(
      result,
      batch,
      Math.floor(i / UPLOAD_BATCH_SIZE) + 1,
      totalBatches
    );
    uploaded += batch.length;
    console.log('[' + result.marketplace + '] uploaded ' + uploaded + '/' + products.length);
  }

  return { ok: true, received: products.length };
}

async function runWithConcurrency(items, limit, worker) {
  const output = [];
  let index = 0;

  async function runner() {
    while (index < items.length) {
      const current = index++;
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
  console.log('[crawler] Upload batch size:', UPLOAD_BATCH_SIZE);

  const results = await runWithConcurrency(stores, STORE_CONCURRENCY, runStore);
  let uploadedStores = 0;

  for (const result of results) {
    console.log(
      '[' + result.marketplace + ']',
      result.ok ? 'OK' : 'FAILED',
      result.products.length + ' products',
      result.mode,
      result.latencyMs + 'ms',
      result.error || ''
    );

    try {
      await pushStoreResult(result);
      uploadedStores++;
    } catch (error) {
      console.error('[' + result.marketplace + '] sheet update failed:', error.message);
    }
  }

  const successCount = results.filter(r => r.ok).length;
  const totalProducts = results.reduce((sum, r) => sum + r.products.length, 0);
  console.log(
    '[crawler] Finished:',
    successCount + '/' + results.length,
    'stores succeeded;',
    totalProducts,
    'products;',
    uploadedStores,
    'stores uploaded'
  );
}

main().catch(error => {
  console.error('[crawler] fatal:', error);
  process.exitCode = 1;
});
