const { getHistory } = require('../lib/priceHistory');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const key = String(req.query.key || '').trim();
  const limit = req.query.limit || 30;

  if (!key) {
    return res.status(400).json({ error: 'A product history key is required.' });
  }

  return res.json({
    key,
    history: getHistory(key, limit),
    fetchedAt: new Date().toISOString(),
  });
};
