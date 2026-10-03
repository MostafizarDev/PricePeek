const StarTechScraper = require('../lib/startech');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(StarTechScraper, 'StarTech');
