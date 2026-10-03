const AppleGadgetsScraper = require('../lib/applegadgets');
const { createStoreSearchHandler } = require('../../lib/storeSearchHandler');
module.exports = createStoreSearchHandler(AppleGadgetsScraper, 'AppleGadgets');
