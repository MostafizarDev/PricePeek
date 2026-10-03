const BagdoomScraper = require('../lib/bagdoom');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(BagdoomScraper, 'Bagdoom');
