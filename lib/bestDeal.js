function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getWarrantyScore(product) {
  const text = [
    product.warranty,
    product.warrantyText,
    product.guarantee,
    product.returnPolicy
  ].map(v => String(v || '').toLowerCase()).join(' ');

  if (!text) return 0;
  if (/official|brand warranty|manufacturer warranty|international warranty/.test(text)) return 18;
  if (/warranty|guarantee/.test(text)) return 10;
  return 0;
}

function getSellerScore(product) {
  const rating = toNumber(product.sellerRating || product.rating);
  const positive = toNumber(product.sellerPositiveRate);

  let score = 0;
  if (product.isOfficial === true) score += 25;
  if (rating > 0) score += Math.min(rating / 5, 1) * 15;
  if (positive > 0) score += Math.min(positive / 100, 1) * 10;
  if (product.sellerName) score += 2;
  return Math.min(score, 50);
}

function getAvailabilityScore(product) {
  return product.inStock === false ? 0 : 10;
}

function getPriceScore(product, exactProducts) {
  const prices = exactProducts
    .filter(p => p.inStock !== false && Number.isFinite(Number(p.price)) && Number(p.price) > 0)
    .map(p => Number(p.price));

  if (!prices.length || !Number.isFinite(Number(product.price)) || Number(product.price) <= 0) return 0;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max === min) return 20;

  // Lower price gets more points, but trust signals can outweigh a tiny price gap.
  return 20 * (max - Number(product.price)) / (max - min);
}

function getDiscountScore(product) {
  const discount = Math.max(0, Math.min(100, toNumber(product.discount)));
  return Math.min(discount / 100, 1) * 5;
}

function getCouponScore(product) {
  return Array.isArray(product.coupons) && product.coupons.length > 0 ? 5 : 0;
}

function getCashbackScore(product) {
  if (!Array.isArray(product.cashback) || !product.cashback.length) return 0;
  const best = product.cashback.reduce((max, item) => Math.max(max, toNumber(item.percentage)), 0);
  return Math.min(best / 100, 1) * 5;
}

function scoreBestDeal(product, exactProducts) {
  return (
    getPriceScore(product, exactProducts) +
    getSellerScore(product) +
    getWarrantyScore(product) +
    getAvailabilityScore(product) +
    getDiscountScore(product) +
    getCouponScore(product) +
    getCashbackScore(product)
  );
}

function getBadges(product, exactProducts) {
  const badges = [];
  const inStock = product.inStock !== false;
  const validPrice = Number.isFinite(Number(product.price)) && Number(product.price) > 0;

  if (inStock && validPrice) {
    const prices = exactProducts.filter(p => p.inStock !== false && Number(p.price) > 0).map(p => Number(p.price));
    if (prices.length && Number(product.price) === Math.min(...prices)) badges.push('Best Price');
  }
  if (product.isOfficial === true) badges.push('Official Store');
  if (toNumber(product.discount) > 0) badges.push('Best Discount Candidate');
  if (Array.isArray(product.coupons) && product.coupons.length) badges.push('Coupon');
  if (Array.isArray(product.cashback) && product.cashback.length) badges.push('Cashback');
  return badges;
}

function findBestDeal(exactProducts = []) {
  const eligible = exactProducts.filter(product =>
    product &&
    product.matchType !== 'similar' &&
    product.inStock !== false &&
    Number.isFinite(Number(product.price)) &&
    Number(product.price) > 0
  );

  if (!eligible.length) return { bestDeal: null, scoredProducts: [], badges: {} };

  const scoredProducts = eligible.map(product => ({
    ...product,
    dealScore: Number(scoreBestDeal(product, eligible).toFixed(2))
  })).sort((a, b) =>
    b.dealScore - a.dealScore ||
    Number(a.price) - Number(b.price)
  );

  const best = scoredProducts[0];
  const badges = {};
  for (const product of scoredProducts) {
    badges[product.id] = getBadges(product, eligible);
  }
  badges[best.id] = Array.from(new Set([...(badges[best.id] || []), 'Best Deal']));

  return {
    bestDeal: best,
    scoredProducts,
    badges
  };
}

module.exports = {
  findBestDeal,
  scoreBestDeal,
  getBadges
};
