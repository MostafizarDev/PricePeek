const STORES = [
  { id: 'daraz', name: 'Daraz', status: 'active', categories: ['general', 'electronics', 'fashion'], scraper: 'Daraz' },
  { id: 'startech', name: 'Star Tech', status: 'active', categories: ['electronics', 'computer'], scraper: 'StarTech' },
  { id: 'ryans', name: 'Ryans', status: 'active', categories: ['electronics', 'computer'], scraper: 'Ryans' },
  { id: 'rokomari', name: 'Rokomari', status: 'active', categories: ['books', 'general'], scraper: 'Rokomari' },
  { id: 'pickaboo', name: 'Pickaboo', status: 'planned', categories: ['electronics', 'mobile'] },
  { id: 'gadgetgear', name: 'Gadget & Gear', status: 'planned', categories: ['electronics', 'mobile'] },
  { id: 'techland', name: 'TechLand', status: 'planned', categories: ['electronics', 'computer'] },
  { id: 'othoba', name: 'Othoba', status: 'planned', categories: ['general'] },
  { id: 'ajkerdeal', name: 'AjkerDeal', status: 'planned', categories: ['general', 'fashion'] },
];

function getActiveStores() {
  return STORES.filter(store => store.status === 'active');
}

function getStoreStatus() {
  return STORES.map(({ id, name, status, categories }) => ({ id, name, status, categories }));
}

module.exports = { STORES, getActiveStores, getStoreStatus };
