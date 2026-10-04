/**
 * Ryans is intentionally disabled.
 *
 * Ryans' current Terms & Conditions prohibit automated use of the site,
 * including data mining, robots, scripts, and similar data-gathering tools.
 * Their robots.txt also disallows /search, which is the endpoint a live
 * search scraper would need.
 *
 * Do not re-enable this scraper unless Ryans gives explicit permission
 * for automated product-data access or provides an approved API/feed.
 */
class RyansScraper {
  constructor() {
    this.marketplace = 'Ryans';
    this.baseUrl = 'https://www.ryans.com';
    this.disabled = true;
  }

  async search() {
    console.warn('[Ryans] Scraper disabled: automated product-data collection is not permitted by current site terms.');
    return [];
  }

  async getProductFromUrl() {
    console.warn('[Ryans] Direct product scraping disabled pending permission/API.');
    return null;
  }
}

module.exports = RyansScraper;
