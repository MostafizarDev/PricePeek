const CONFIG = {
  TOKEN: PropertiesService.getScriptProperties().getProperty('CRAWLER_TOKEN') || '',
  MAX_PRODUCTS_PER_REQUEST: 1000,
  HEADER: [
    'product_id', 'name', 'brand', 'model', 'price', 'old_price',
    'image', 'url', 'in_stock', 'last_seen', 'status', 'updated_at'
  ]
};

function doGet(e) {
  try {
    const action = String(e?.parameter?.action || 'search').toLowerCase();

    if (action === 'health') {
      return json({ ok: true, service: 'PricePeekBD Sheets API' });
    }

    if (action === 'search') {
      const query = String(e?.parameter?.q || '').trim().toLowerCase();
      if (query.length < 2) return json({ ok: true, products: [], stores: [] });
      return json(searchProducts(query));
    }

    if (action === 'stores') {
      return json({ ok: true, stores: readStoreStatus() });
    }

    return json({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return json({ ok: false, error: error.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e?.postData?.contents || '{}');

    if (body.token !== CONFIG.TOKEN || !CONFIG.TOKEN) {
      return json({ ok: false, error: 'Unauthorized' });
    }

    if (body.action !== 'upsert') {
      return json({ ok: false, error: 'Unknown action' });
    }

    return json(upsertStore(body.store, body.products || []));
  } catch (error) {
    return json({ ok: false, error: error.message });
  }
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeSheetName(name) {
  return String(name || 'Store')
    .replace(/[\\/?*\[\]:]/g, '-')
    .slice(0, 90);
}

function getStoreSheet(store) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = safeSheetName(store.name || store.id);
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, CONFIG.HEADER.length).setValues([CONFIG.HEADER]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function upsertStore(store, products) {
  const sheet = getStoreSheet(store);
  const rows = sheet.getDataRange().getValues();
  const header = rows.length ? rows[0] : CONFIG.HEADER;
  const index = {};
  header.forEach((value, i) => index[String(value)] = i);

  const existing = new Map();
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i][index.product_id] || '').trim().toLowerCase();
    if (id) existing.set(id, i + 1);
  }

  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;

  const limited = products.slice(0, CONFIG.MAX_PRODUCTS_PER_REQUEST);
  for (const p of limited) {
    const id = String(p.externalProductId || p.product_id || p.url || '').trim().toLowerCase();
    if (!id) continue;

    const values = [
      id,
      p.name || '',
      p.brand || '',
      p.model || '',
      Number.isFinite(Number(p.price)) ? Number(p.price) : '',
      Number.isFinite(Number(p.originalPrice)) ? Number(p.originalPrice) : '',
      p.image || '',
      p.url || '',
      p.inStock !== false,
      now,
      'active',
      now
    ];

    const rowNumber = existing.get(id);
    if (rowNumber) {
      sheet.getRange(rowNumber, 1, 1, CONFIG.HEADER.length).setValues([values]);
      updated++;
    } else {
      sheet.appendRow(values);
      added++;
    }
  }

  updateStoresSheet(store, limited.length, now, null);

  return {
    ok: true,
    store: store.name,
    added,
    updated,
    received: limited.length,
    updatedAt: now
  };
}

function updateStoresSheet(store, productCount, timestamp, error) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Stores');

  if (!sheet) {
    sheet = ss.insertSheet('Stores');
    sheet.getRange(1, 1, 1, 8).setValues([[
      'store_id', 'store_name', 'status', 'product_count',
      'last_crawl', 'last_success', 'last_error', 'updated_at'
    ]]);
    sheet.setFrozenRows(1);
  }

  const values = sheet.getDataRange().getValues();
  let rowNumber = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(store.id)) {
      rowNumber = i + 1;
      break;
    }
  }

  const existing = rowNumber > 0 ? sheet.getRange(rowNumber, 1, 1, 8).getValues()[0] : [];
  const row = [
    store.id || '',
    store.name || '',
    store.ok ? 'active' : 'failed',
    productCount,
    timestamp,
    store.ok ? timestamp : (existing[5] || ''),
    error || store.error || '',
    timestamp
  ];

  if (rowNumber > 0) sheet.getRange(rowNumber, 1, 1, 8).setValues([row]);
  else sheet.appendRow(row);
}

function readStoreStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Stores');
  if (!sheet || sheet.getLastRow() < 2) return [];

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues().map(r => ({
    id: r[0], name: r[1], status: r[2], productCount: r[3],
    lastCrawl: r[4], lastSuccess: r[5], lastError: r[6], updatedAt: r[7]
  }));
}

function searchProducts(query) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stores = ss.getSheets().filter(sheet => sheet.getName() !== 'Stores' && sheet.getName() !== 'PriceHistory');
  const tokens = query.split(/\\s+/).filter(Boolean);
  const products = [];
  const storeNames = new Set();

  stores.forEach(sheet => {
    if (sheet.getLastRow() < 2) return;

    const rows = sheet.getDataRange().getValues();
    const header = rows[0];
    const idx = {};
    header.forEach((v, i) => idx[String(v)] = i);

    for (let i = 1; i < rows.length; i++) {
      const name = String(rows[i][idx.name] || '').toLowerCase();
      const brand = String(rows[i][idx.brand] || '').toLowerCase();
      const model = String(rows[i][idx.model] || '').toLowerCase();
      const haystack = name + ' ' + brand + ' ' + model;

      if (!tokens.every(token => haystack.includes(token))) continue;

      products.push({
        id: String(rows[i][idx.product_id] || ''),
        name: rows[i][idx.name] || '',
        brand: rows[i][idx.brand] || null,
        model: rows[i][idx.model] || null,
        price: Number(rows[i][idx.price]) || 0,
        originalPrice: Number(rows[i][idx.old_price]) || null,
        image: rows[i][idx.image] || '',
        url: rows[i][idx.url] || '',
        inStock: rows[i][idx.in_stock] !== false && String(rows[i][idx.in_stock]).toLowerCase() !== 'false',
        marketplace: sheet.getName(),
        fetchedAt: rows[i][idx.last_seen] || null,
        dataQuality: 'crawler'
      });
      storeNames.add(sheet.getName());

      if (products.length >= 500) return;
    }
  });

  products.sort((a, b) => Number(a.price) - Number(b.price));

  return {
    ok: true,
    products: products.slice(0, 300),
    stores: Array.from(storeNames)
  };
}
