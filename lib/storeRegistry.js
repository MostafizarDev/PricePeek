const STORES = [
  {
    id: 'daraz',
    name: 'Daraz',
    tier: 1,
    categories: ['general', 'electronics', 'fashion'],
    get Scraper() { return require('./daraz'); }
  },
  {
    id: 'startech',
    name: 'Star Tech',
    tier: 1,
    categories: ['electronics', 'computer'],
    get Scraper() { return require('./startech'); }
  },
  {
    id: 'applegadgets',
    name: 'Apple Gadgets',
    tier: 1,
    categories: ['electronics', 'mobile'],
    get Scraper() { return require('./applegadgets'); }
  },
  {
    id: 'gadgetgear',
    name: 'Gadget & Gear',
    tier: 2,
    categories: ['electronics', 'computer', 'mobile'],
    get Scraper() { return require('./gadgetgear'); }
  }
];

function getStoreStatus() {
  return STORES.map(({ id, name, tier, categories }) => ({ id, name, tier, categories }));
}

function getStoreById(id) {
  return STORES.find(store => store.id === String(id).toLowerCase()) || null;
}

function getSmartStores(query = '') {
  const text = String(query).toLowerCase();
  const electronics = /iphone|ipad|macbook|samsung|xiaomi|redmi|realme|oppo|vivo|laptop|pc|computer|monitor|gpu|graphics|keyboard|mouse|headphone|earbuds|ssd|hdd|ram|router|tv|camera|watch|g304|g305|logitech|gaming/.test(text);
  const books = /book|novel|story|textbook|isbn|rokomari/.test(text);

  if (electronics) {
    return STORES.filter(store => store.tier <= 2 && store.categories.some(c => ['electronics', 'computer', 'mobile'].includes(c))).slice(0, 7);
  }

  return STORES.filter(store => store.tier === 1).slice(0, 3);
}

function resolveStores(selection, query = '') {
  const value = String(selection || '').trim().toLowerCase();

  if (!value || value === 'smart') return getSmartStores(query);

  if (value === 'all' || value === 'all-stores') return STORES;

  const ids = value.split(',').map(id => id.trim()).filter(Boolean);
  const selected = ids.map(getStoreById).filter(Boolean);
  return selected.length ? selected : getSmartStores(query);
}

module.exports = {
  STORES,
  getStoreStatus,
  getStoreById,
  getSmartStores,
  resolveStores
};
