const memoryStore = new Map();

function productKey(product = {}) {
  const source = product.model || product.normalizedName || product.name || product.url || 'unknown';
  return String(source).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 180);
}

function normalizeSnapshot(product = {}) {
  return {
    timestamp: product.fetchedAt || new Date().toISOString(),
    price: Number.isFinite(Number(product.price)) ? Number(product.price) : null,
    originalPrice: Number.isFinite(Number(product.originalPrice)) ? Number(product.originalPrice) : null,
    discount: Number.isFinite(Number(product.discount)) ? Number(product.discount) : 0,
    marketplace: product.marketplace || null,
    url: product.url || '',
    inStock: product.inStock !== false,
  };
}

async function saveSnapshots(products = []) {
  const saved = [];
  for (const product of products) {
    if (product.price == null) continue;
    const key = productKey(product);
    const list = memoryStore.get(key) || [];
    const snapshot = normalizeSnapshot(product);
    const previous = list[list.length - 1];

    if (!previous || previous.price !== snapshot.price || previous.marketplace !== snapshot.marketplace || previous.inStock !== snapshot.inStock) {
      list.push(snapshot);
      memoryStore.set(key, list.slice(-90));
      saved.push({ key, snapshot });
    }
  }
  return saved;
}

function getHistory(key, limit = 30) {
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 90);
  return (memoryStore.get(String(key)) || []).slice(-safeLimit);
}

module.exports = { productKey, saveSnapshots, getHistory };
