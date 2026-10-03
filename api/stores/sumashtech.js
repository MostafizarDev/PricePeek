const SumashTechScraper = require('../../lib/sumashtech');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(SumashTechScraper, 'SumashTech');
