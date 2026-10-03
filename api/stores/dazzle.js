const DazzleScraper = require('../../lib/dazzle');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(DazzleScraper, 'Dazzle');
