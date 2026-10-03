const AjkerDealScraper = require('../../lib/ajkerdeal');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(AjkerDealScraper, 'AjkerDeal');
