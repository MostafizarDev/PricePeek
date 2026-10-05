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
  }
];

function getStoreStatus() {
  return STORES.map(({ id, name, tier, categories }) => ({ id, name, tier, categories }));
}

function getStoreById(id) {
  return STORES.find(store => store.id === String(id).toLowerCase()) || null;
}

function getSmartStores(query = '') {
  return STORES;
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
