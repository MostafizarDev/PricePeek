const PickabooScraper = require('../../lib/pickaboo');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(PickabooScraper, 'Pickaboo');
