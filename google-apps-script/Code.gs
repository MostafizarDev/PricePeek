const CONFIG = {
  TOKEN: PropertiesService.getScriptProperties().getProperty('CRAWLER_TOKEN') || '',
  PRODUCT_HEADER: [
    'product_id','seller_id','seller_name','name','brand','model',
    'category','subcategory','price','old_price','image','url',
    'in_stock','source_lastmod','first_seen','last_seen','status','updated_at'
  ],
  STAGING_HEADER: [
    'run_id','product_id','seller_id','seller_name','name','brand','model',
    'category','subcategory','price','old_price','image','url',
    'in_stock','source_lastmod'
  ],
  HISTORY_HEADER: [
    'product_id','seller_id','seller_name','product_name',
    'old_price','new_price','changed_at'
  ],
  STORE_HEADER: [
    'store_id','store_name','status','product_count','last_crawl',
    'last_success','last_error','updated_at','data_file_id','data_file_url',
    'mode','discovered_urls','selected_urls','parsed_products',
    'added','updated','missing','run_id'
  ],
  LEGACY_HEADER: [
    'product_id','name','brand','model','price','old_price',
    'image','url','in_stock','last_seen','status','updated_at'
  ],
  FINALIZE_WRITE_CHUNK: 5000,
  STAGING_WRITE_CHUNK: 500
};

function doGet(e) {
  try {
    const action = String(e?.parameter?.action || 'health').toLowerCase();
    if (action === 'health') {
      return json({ ok: true, service: 'PricePeekBD Sheets API', version: '2026.10-scaled' });
    }
    if (action === 'stores') return json({ ok: true, stores: readStoreStatus() });
    if (action === 'search') {
      const query = String(e?.parameter?.q || '').trim().toLowerCase();
      const storeId = String(e?.parameter?.store || '').trim().toLowerCase();
      if (query.length < 2) return json({ ok: true, products: [], stores: [] });
      return json(searchProducts(query, storeId));
    }
    return json({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return json({ ok: false, error: error.message, stack: String(error.stack || '').slice(0, 1000) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e?.postData?.contents || '{}');
    if (body.token !== CONFIG.TOKEN || !CONFIG.TOKEN) return json({ ok: false, error: 'Unauthorized' });

    const action = String(body.action || '').toLowerCase();
    if (action === 'stage') return json(stageStore(body.store || {}, body.runId || '', body.products || []));
    if (action === 'finalize') return json(finalizeStore(body.store || {}, body.runId || ''));
    if (action === 'status') return json(updateStoreStatus(body.store || {}, body.store?.error || ''));
    return json({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return json({ ok: false, error: error.message, stack: String(error.stack || '').slice(0, 1000) });
  }
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function safeSheetName(name) {
  return String(name || 'Store').replace(/[\\/?*\[\]:]/g, '-').slice(0, 90);
}

function controlSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function storesSheet() {
  const ss = controlSpreadsheet();
  let sheet = ss.getSheetByName('Stores');
  if (!sheet) {
    sheet = ss.insertSheet('Stores');
  }
  const currentHeader = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, Math.min(sheet.getLastColumn(), CONFIG.STORE_HEADER.length)).getValues()[0]
    : [];
  if (currentHeader.join('|') !== CONFIG.STORE_HEADER.join('|')) {
    sheet.getRange(1, 1, 1, CONFIG.STORE_HEADER.length).setValues([CONFIG.STORE_HEADER]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function storeRow(storeId) {
  const sheet = storesSheet();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === String(storeId).trim().toLowerCase()) {
      return { row: i + 1, values: values[i] };
    }
  }
  return null;
}

function ensureStoreDatabase(store) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = storesSheet();
    const found = storeRow(store.id);
    let rowNumber = found ? found.row : sheet.getLastRow() + 1;
    let row = found ? found.values : new Array(CONFIG.STORE_HEADER.length).fill('');

    if (row[8]) {
      const ss = SpreadsheetApp.openById(String(row[8]));
      return { ss, rowNumber, row };
    }

    const ss = SpreadsheetApp.create('PricePeekBD - ' + (store.name || store.id));
    const products = ss.getSheets()[0];
    products.setName('Products');
    products.getRange(1, 1, 1, CONFIG.PRODUCT_HEADER.length).setValues([CONFIG.PRODUCT_HEADER]);
    products.setFrozenRows(1);

    const staging = ss.insertSheet('Staging');
    staging.getRange(1, 1, 1, CONFIG.STAGING_HEADER.length).setValues([CONFIG.STAGING_HEADER]);
    staging.setFrozenRows(1);

    const history = ss.insertSheet('PriceHistory');
    history.getRange(1, 1, 1, CONFIG.HISTORY_HEADER.length).setValues([CONFIG.HISTORY_HEADER]);
    history.setFrozenRows(1);

    const runs = ss.insertSheet('Runs');
    runs.getRange(1, 1, 1, 10).setValues([[
      'run_id','store_id','store_name','mode','started_at','finished_at',
      'discovered_urls','selected_urls','parsed_products','status'
    ]]);
    runs.setFrozenRows(1);

    // One-time migration from the old central spreadsheet tab, if it exists.
    const legacy = controlSpreadsheet().getSheetByName(store.name || store.id);
    if (legacy && legacy.getLastRow() > 1) {
      const legacyRows = legacy.getDataRange().getValues();
      const oldHeader = legacyRows[0].map(v => String(v));
      const idx = {};
      oldHeader.forEach((v, i) => idx[v] = i);
      const migrated = [];
      for (let i = 1; i < legacyRows.length; i++) {
        const r = legacyRows[i];
        const id = String(r[idx.product_id] || '').trim().toLowerCase();
        if (!id) continue;
        const now = r[idx.updated_at] || r[idx.last_seen] || new Date().toISOString();
        migrated.push([
          id, '', '', r[idx.name] || '', r[idx.brand] || '', r[idx.model] || '',
          '', '', Number(r[idx.price]) || '', Number(r[idx.old_price]) || '',
          r[idx.image] || '', r[idx.url] || '',
          String(r[idx.in_stock]).toLowerCase() !== 'false',
          '', r[idx.last_seen] || now, r[idx.last_seen] || now,
          r[idx.status] || 'active', now
        ]);
      }
      writeInChunks(products, migrated, CONFIG.FINALIZE_WRITE_CHUNK, 2);
    }

    row[0] = store.id || '';
    row[1] = store.name || store.id || '';
    row[2] = 'active';
    row[3] = Math.max(0, products.getLastRow() - 1);
    row[8] = ss.getId();
    row[9] = ss.getUrl();
    row[7] = new Date().toISOString();

    if (found) {
      sheet.getRange(rowNumber, 1, 1, CONFIG.STORE_HEADER.length).setValues([row]);
    } else {
      sheet.getRange(rowNumber, 1, 1, CONFIG.STORE_HEADER.length).setValues([row]);
    }

    return { ss, rowNumber, row };
  } finally {
    lock.releaseLock();
  }
}

function writeInChunks(sheet, rows, chunk, startRow) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    sheet.getRange(startRow + i, 1, batch.length, batch[0].length).setValues(batch);
  }
}

function stageStore(store, runId, products) {
  if (!store.id || !runId) throw new Error('store.id and runId are required');
  const db = store.dataFileId
    ? { ss: SpreadsheetApp.openById(String(store.dataFileId)) }
    : ensureStoreDatabase(store);
  const sheet = db.ss.getSheetByName('Staging');
  const rows = [];

  for (const p of products.slice(0, 1000)) {
    const id = String(p.externalProductId || p.product_id || p.url || '').trim().toLowerCase();
    if (!id) continue;
    rows.push([
      runId,
      id,
      p.sellerId || '',
      p.sellerName || '',
      p.name || '',
      p.brand || '',
      p.model || '',
      p.category || '',
      p.subcategory || '',
      Number.isFinite(Number(p.price)) ? Number(p.price) : '',
      Number.isFinite(Number(p.originalPrice)) ? Number(p.originalPrice) : '',
      p.image || '',
      p.url || '',
      p.inStock !== false,
      p.sourceLastmod || ''
    ]);
  }

  if (rows.length) {
    const startRow = sheet.getLastRow() + 1;
    writeInChunks(sheet, rows, CONFIG.STAGING_WRITE_CHUNK, startRow);
  }

  return { ok: true, staged: rows.length, runId, store: store.name || store.id, dataFileId: db.ss.getId(), dataFileUrl: db.ss.getUrl() };
}

function productIdKey(productId, sellerId, storeId) {
  const seller = String(sellerId || '').trim().toLowerCase();
  return String(productId || '').trim().toLowerCase() + '::' + seller;
}

function finalizeStore(store, runId) {
  if (!store.id || !runId) throw new Error('store.id and runId are required');
  const db = store.dataFileId
    ? { ss: SpreadsheetApp.openById(String(store.dataFileId)) }
    : ensureStoreDatabase(store);
  const ss = db.ss;
  const productsSheet = ss.getSheetByName('Products');
  const stagingSheet = ss.getSheetByName('Staging');
  const historySheet = ss.getSheetByName('PriceHistory');

  const productData = productsSheet.getLastRow() > 1
    ? productsSheet.getDataRange().getValues()
    : [CONFIG.PRODUCT_HEADER];
  const stagingData = stagingSheet.getLastRow() > 1
    ? stagingSheet.getDataRange().getValues()
    : [CONFIG.STAGING_HEADER];

  const existing = new Map();
  for (let i = 1; i < productData.length; i++) {
    const r = productData[i];
    const key = productIdKey(r[0], r[1], store.id);
    if (r[0]) existing.set(key, { row: r, index: i - 1 });
  }

  const now = new Date().toISOString();
  const merged = productData.length > 1 ? productData.slice(1) : [];
  const history = [];
  let added = 0;
  let updated = 0;
  let missing = 0;

  for (let i = 1; i < stagingData.length; i++) {
    const s = stagingData[i];
    if (String(s[0]) !== String(runId)) continue;

    const key = productIdKey(s[1], s[2], store.id);
    const previous = existing.get(key);
    const previousPrice = previous ? Number(previous.row[8]) : NaN;
    const nextPrice = Number(s[9]);

    const firstSeen = previous ? previous.row[14] || now : now;
    const row = [
      s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8],
      nextPrice,
      Number.isFinite(Number(s[10])) ? Number(s[10]) : nextPrice,
      s[11], s[12], s[13] !== false,
      s[14] || (previous ? previous.row[13] : ''),
      firstSeen, now, 'active', now
    ];

    if (previous) {
      if (Number.isFinite(previousPrice) && Number.isFinite(nextPrice) && previousPrice !== nextPrice) {
        history.push([
          s[1], s[2] || '', s[3] || '', s[4] || '',
          previousPrice, nextPrice, now
        ]);
      }
      merged[previous.index] = row;
      updated++;
    } else {
      merged.push(row);
      existing.set(key, { row, index: merged.length - 1 });
      added++;
    }
  }

  // Missing products are never marked missing during incremental/partial runs.
  // This protects the catalog from temporary scraper failures.
  if (store.reconcileMissing === true && String(store.mode).startsWith('full')) {
    const seen = new Set();
    for (let i = 1; i < stagingData.length; i++) {
      if (String(stagingData[i][0]) !== String(runId)) continue;
      seen.add(productIdKey(stagingData[i][1], stagingData[i][2], store.id));
    }
    for (let i = 0; i < merged.length; i++) {
      const key = productIdKey(merged[i][0], merged[i][1], store.id);
      if (!seen.has(key) && merged[i][15] === 'active') {
        merged[i][15] = 'missing';
        merged[i][17] = now;
        missing++;
      }
    }
  }

  productsSheet.clearContents();
  productsSheet.getRange(1, 1, 1, CONFIG.PRODUCT_HEADER.length).setValues([CONFIG.PRODUCT_HEADER]);
  writeInChunks(productsSheet, merged, CONFIG.FINALIZE_WRITE_CHUNK, 2);

  if (history.length) {
    writeInChunks(historySheet, history, CONFIG.FINALIZE_WRITE_CHUNK, historySheet.getLastRow() + 1);
  }

  stagingSheet.clearContents();
  stagingSheet.getRange(1, 1, 1, CONFIG.STAGING_HEADER.length).setValues([CONFIG.STAGING_HEADER]);

  const runs = ss.getSheetByName('Runs');
  runs.appendRow([
    runId, store.id, store.name || store.id, store.mode || '',
    store.startedAt || '', now, Number(store.discoveredUrls || 0),
    Number(store.selectedUrls || 0), Number(store.parsedProducts || 0), 'success'
  ]);

  const count = merged.length;
  updateStoreStatus({
    ...store,
    productCount: count,
    added, updated, missing,
    ok: true,
    runId
  }, '');

  return {
    ok: true,
    store: store.name || store.id,
    added, updated, missing,
    productCount: count,
    received: added + updated,
    runId,
    updatedAt: now
  };
}

function updateStoreStatus(store, error) {
  const sheet = storesSheet();
  const found = storeRow(store.id);
  const rowNumber = found ? found.row : sheet.getLastRow() + 1;
  const old = found ? found.values : new Array(CONFIG.STORE_HEADER.length).fill('');
  const timestamp = new Date().toISOString();

  const row = [
    store.id || '',
    store.name || store.id || '',
    store.ok ? 'active' : 'failed',
    Number(store.productCount != null ? store.productCount : old[3] || 0),
    store.crawledAt || timestamp,
    store.ok ? (store.crawledAt || timestamp) : (old[5] || ''),
    error || store.error || '',
    timestamp,
    old[8] || store.dataFileId || '',
    old[9] || store.dataFileUrl || '',
    store.mode || old[10] || '',
    Number(store.discoveredUrls || 0),
    Number(store.selectedUrls || 0),
    Number(store.parsedProducts || 0),
    Number(store.added || 0),
    Number(store.updated || 0),
    Number(store.missing || 0),
    store.runId || old[17] || ''
  ];

  sheet.getRange(rowNumber, 1, 1, CONFIG.STORE_HEADER.length).setValues([row]);
  return { ok: true, status: row };
}

function readStoreStatus() {
  const sheet = storesSheet();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG.STORE_HEADER.length).getValues()
    .filter(r => r[0])
    .map(r => ({
      id: r[0], name: r[1], status: r[2], productCount: Number(r[3] || 0),
      lastCrawl: r[4], lastSuccess: r[5], lastError: r[6], updatedAt: r[7],
      dataFileId: r[8], dataFileUrl: r[9], mode: r[10],
      discoveredUrls: Number(r[11] || 0), selectedUrls: Number(r[12] || 0),
      parsedProducts: Number(r[13] || 0), added: Number(r[14] || 0),
      updated: Number(r[15] || 0), missing: Number(r[16] || 0), runId: r[17]
    }));
}

function searchProducts(query, storeId) {
  const stores = readStoreStatus().filter(s => !storeId || s.id.toLowerCase() === storeId);
  const products = [];
  const storeNames = new Set();
  const tokens = query.split(/\s+/).filter(Boolean);

  stores.forEach(store => {
    try {
      let ss;
      if (store.dataFileId) ss = SpreadsheetApp.openById(store.dataFileId);
      else ss = controlSpreadsheet();

      const sheet = ss.getSheetByName('Products') || ss.getSheetByName(store.name);
      if (!sheet || sheet.getLastRow() < 2) return;

      const last = sheet.getLastRow();
      // Search only the columns needed for matching + rendering.
      const rows = sheet.getRange(2, 1, last - 1, Math.min(13, CONFIG.PRODUCT_HEADER.length)).getValues();

      for (const r of rows) {
        const name = String(r[3] || '').toLowerCase();
        const brand = String(r[4] || '').toLowerCase();
        const model = String(r[5] || '').toLowerCase();
        const haystack = name + ' ' + brand + ' ' + model;
        if (!tokens.every(token => haystack.includes(token))) continue;

        products.push({
          id: String(r[0] || ''),
          sellerId: r[1] || null,
          sellerName: r[2] || null,
          name: r[3] || '',
          brand: r[4] || null,
          model: r[5] || null,
          category: r[6] || null,
          subcategory: r[7] || null,
          price: Number(r[8]) || 0,
          originalPrice: Number(r[9]) || null,
          image: r[10] || '',
          url: r[11] || '',
          inStock: r[12] !== false && String(r[12]).toLowerCase() !== 'false',
          marketplace: store.name,
          fetchedAt: store.lastCrawl || null,
          dataQuality: 'crawler'
        });
        storeNames.add(store.name);
        if (products.length >= 500) break;
      }
    } catch (error) {
      console.warn('Search store failed: ' + store.id + ' - ' + error.message);
    }
  });

  products.sort((a, b) => Number(a.price) - Number(b.price));
  return {
    ok: true,
    products: products.slice(0, 300),
    stores: Array.from(storeNames)
  };
}
