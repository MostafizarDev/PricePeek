const ChaldalScraper = require('../lib/chaldal');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(ChaldalScraper, 'Chaldal');
