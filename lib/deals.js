function buildDeals(productGroups = []) {
  return productGroups
    .map(group => {
      const offers = (group.products || []).filter(p => p.inStock && p.price != null);
      if (!offers.length) return null;

      const lowest = offers.reduce((best, item) => item.price < best.price ? item : best, offers[0]);
      const highest = offers.reduce((best, item) => item.price > best.price ? item : best, offers[0]);
      const original = Math.max(...offers.map(p => p.originalPrice || p.price));
      const discount = Math.max(...offers.map(p => p.discount || 0));

      return {
        key: group.key,
        title: group.title,
        offerCount: offers.length,
        lowestPrice: lowest.price,
        highestPrice: highest.price,
        savingVsHighest: Math.max(0, highest.price - lowest.price),
        bestOffer: {
          marketplace: lowest.marketplace || null,
          price: lowest.price,
          discount: lowest.discount || 0,
          url: lowest.url || '',
        },
        highestDiscount: discount,
        referenceOriginalPrice: original,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.lowestPrice - b.lowestPrice);
}

module.exports = { buildDeals };
