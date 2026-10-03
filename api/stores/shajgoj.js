const ShajgojScraper = require('../../lib/shajgoj');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(ShajgojScraper, 'Shajgoj');
