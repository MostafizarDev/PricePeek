const DarazScraper = require('../lib/daraz');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(DarazScraper, 'Daraz');
