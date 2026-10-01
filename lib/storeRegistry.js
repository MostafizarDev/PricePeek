const STORES = [
  { id: 'daraz', name: 'Daraz', status: 'active', categories: ['general', 'electronics', 'fashion'], scraper: 'Daraz' },
  { id: 'startech', name: 'Star Tech', status: 'active', categories: ['electronics', 'computer'], scraper: 'StarTech' },
  { id: 'ryans', name: 'Ryans', status: 'active', categories: ['electronics', 'computer'], scraper: 'Ryans' },
  { id: 'rokomari', name: 'Rokomari', status: 'active', categories: ['books', 'general'], scraper: 'Rokomari' },
  { id: 'pickaboo', name: 'Pickaboo', status: 'active', categories: ['electronics', 'mobile'] },
  { id: 'gadgetgear', name: 'Gadget & Gear', status: 'active', categories: ['electronics', 'mobile'] },
  { id: 'techland', name: 'TechLand', status: 'active', categories: ['electronics', 'computer'] },
  { id: 'othoba', name: 'Othoba', status: 'active', categories: ['general'] },
  { id: 'ajkerdeal', name: 'AjkerDeal', status: 'active', categories: ['general', 'fashion'] },
  { id: 'bagdoom', name: 'Bagdoom', status: 'active', categories: ['general', 'electronics'] },
  { id: 'sumashtech', name: 'Sumash Tech', status: 'active', categories: ['electronics', 'mobile'] },
  { id: 'dazzle', name: 'Dazzle', status: 'active', categories: ['electronics', 'mobile'] },
  { id: 'applegadgets', name: 'Apple Gadgets', status: 'active', categories: ['electronics', 'mobile'] },
  { id: 'shajgoj', name: 'Shajgoj', status: 'active', categories: ['beauty', 'personal-care'] },
  { id: 'chaldal', name: 'Chaldal', status: 'active', categories: ['grocery'] },
];

function getActiveStores() {
  return STORES.filter(store => store.status === 'active');
}

function getStoreStatus() {
  return STORES.map(({ id, name, status, categories }) => ({ id, name, status, categories }));
}

module.exports = { STORES, getActiveStores, getStoreStatus };
