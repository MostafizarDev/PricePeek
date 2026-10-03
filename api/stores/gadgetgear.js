const GadgetGearScraper = require('../../lib/gadgetgear');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(GadgetGearScraper, 'GadgetGear');
