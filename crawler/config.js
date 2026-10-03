const STORE_MODULES = {
  daraz: '../lib/daraz',
  startech: '../lib/startech',
  ryans: '../lib/ryans',
  rokomari: '../lib/rokomari',
  pickaboo: '../lib/pickaboo',
  gadgetgear: '../lib/gadgetgear',
  techland: '../lib/techland',
  othoba: '../lib/othoba',
  ajkerdeal: '../lib/ajkerdeal',
  bagdoom: '../lib/bagdoom',
  sumashtech: '../lib/sumashtech',
  dazzle: '../lib/dazzle',
  applegadgets: '../lib/applegadgets',
  shajgoj: '../lib/shajgoj',
  chaldal: '../lib/chaldal',
};

const DEFAULT_QUERIES = [
  'iphone', 'ipad', 'macbook', 'apple watch', 'airpods',
  'samsung', 'xiaomi', 'oppo', 'vivo', 'realme', 'oneplus',
  'google pixel', 'motorola', 'nokia', 'honor',
  'mobile phone', 'mobile', 'tablet', 'smart watch',
  'laptop', 'desktop', 'monitor', 'keyboard', 'mouse',
  'headphone', 'earphone', 'speaker', 'microphone',
  'charger', 'power bank', 'cable', 'adapter', 'hub',
  'router', 'wifi', 'ssd', 'hard disk', 'ram', 'graphics card',
  'processor', 'motherboard', 'gaming', 'camera', 'drone',
  'smart tv', 'tv', 'air conditioner', 'refrigerator',
  'washing machine', 'fan', 'trimmer', 'shaver',
  'shirt', 'polo shirt', 't shirt', 'shoe', 'bag',
  'watch', 'beauty', 'skincare', 'grocery', 'book',
  'stationery', 'baby', 'kitchen', 'home appliance'
];

module.exports = { STORE_MODULES, DEFAULT_QUERIES };
