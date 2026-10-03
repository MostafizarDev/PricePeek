const RokomariScraper = require('../lib/rokomari');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(RokomariScraper, 'Rokomari');
