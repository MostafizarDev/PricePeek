const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '.catalog-cache');

function ensureDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cachePath(storeId) {
  return path.join(CACHE_DIR, String(storeId).replace(/[^a-z0-9_-]/gi, '_') + '.json');
}

function load(storeId) {
  ensureDir();
  const file = cachePath(storeId);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      entries: parsed.entries || {},
      rotationSlot: Number(parsed.rotationSlot || 0),
      updatedAt: parsed.updatedAt || null
    };
  } catch {
    return { entries: {}, rotationSlot: 0, updatedAt: null };
  }
}

function save(storeId, data) {
  ensureDir();
  const file = cachePath(storeId);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({
    entries: data.entries || {},
    rotationSlot: Number(data.rotationSlot || 0),
    updatedAt: new Date().toISOString()
  }));
  fs.renameSync(tmp, file);
}

module.exports = { load, save };
