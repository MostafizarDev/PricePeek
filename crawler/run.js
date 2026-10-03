const axios = require('axios');
const { normalizeProduct } = require('../lib/normalize');
const { getActiveStores } = require('../lib/storeRegistry');
const { STORE_MODULES, DEFAULT_QUERIES } = require('./config');

const CRAWL_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS || 15000);
const STORE_CONCURRENCY = Math.max(1, Number(process.env.STORE_CONCURRENCY || 3));
const SHEETS_WEB_APP_URL = String(process.env.SHEETS_WEB_APP_URL || '').trim();
const CRAWLER_TOKEN = String(process.env.CRAWLER_TOKEN || '').trim();

function timeoutPromise(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Crawler timeout')), ms)
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

async function runStore(store) {
  const started = Date.now();
  try {
    const scraper = loadScraper(store);

    // Prefer a real full-catalog crawler when a store implements one.
    if (typeof scraper.crawl === 'function') {
      const products = await Promise.race([
        scraper.crawl(),
        timeoutPromise(CRAWL_TIMEOUT_MS),
      ]);
      return finalizeStore(store, products, Date.now() - started, 'crawl');
    }

    // Current scrapers expose search(), so use bounded seed searches until
    // a store-specific full-catalog crawl is implemented.
    const queries = getQueriesForStore(store);
    const results = [];
    for (const query of queries) {
      const products = await Promise.race([
        scraper.search(query),
        timeoutPromise(CRAWL_TIMEOUT_MS),
      ]);
      if (Array.isArray(products)) results.push(...products);
    }

    return finalizeStore(store, results, Date.now() - started, 'seed-search');
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
    } catch (error) {
      console.warn('[' + store.name + '] product normalize failed:', error.message);
    }
  }

  return {
    storeId: store.id,
    marketplace: store.name,
    ok: products.length > 0,
    products: products.slice(0, 1000),
    mode,
    latencyMs,
    error: products.length ? null : 'No products returned',
  };
}

async function pushStoreResult(result) {
  if (!SHEETS_WEB_APP_URL) throw new Error('SHEETS_WEB_APP_URL is not configured');
  if (!CRAWLER_TOKEN) throw new Error('CRAWLER_TOKEN is not configured');

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
      },
      products: result.products,
    },
    { timeout: 30000 }
  );

  if (response.status < 200 || response.status >= 300 || response.data?.ok === false) {
    throw new Error(response.data?.error || 'Google Sheets update failed');
  }

  return response.data;
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

  const results = await runWithConcurrency(stores, STORE_CONCURRENCY, runStore);
  let uploaded = 0;

  for (const result of results) {
    console.log(
      '[' + result.marketplace + ']',
      result.ok ? 'OK' : 'FAILED',
      result.products.length + ' products',
      result.mode,
      result.latencyMs + 'ms',
      result.error || ''
    );

    // Never overwrite a healthy store with an empty failed crawl.
    if (result.ok) {
      try {
        await pushStoreResult(result);
        uploaded++;
      } catch (error) {
        console.error('[' + result.marketplace + '] sheet update failed:', error.message);
      }
    }
  }

  const successCount = results.filter(r => r.ok).length;
  console.log('[crawler] Finished:', successCount + '/' + results.length, 'stores succeeded;', uploaded, 'uploaded');
}

main().catch(error => {
  console.error('[crawler] fatal:', error);
  process.exitCode = 1;
});
