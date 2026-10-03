const RyansScraper = require('../../lib/ryans');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(RyansScraper, 'Ryans');
