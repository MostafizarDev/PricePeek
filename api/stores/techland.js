const TechLandScraper = require('../lib/techland');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(TechLandScraper, 'TechLand');
