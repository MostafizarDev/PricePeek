const OthobaScraper = require('../lib/othoba');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(OthobaScraper, 'Othoba');
