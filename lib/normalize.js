function normalizeText(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[|_/\\-]+/g, ' ')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] || match[0];
  }
  return null;
}

function extractAttributes(name = '') {
  const text = String(name);
  const normalized = normalizeText(text);

  const storage = firstMatch(normalized, [
    /(\d+)\s*(tb|gb)\b/,
    /(\d+)\s*(gb|tb)\s*storage/
  ]);

  const ram = firstMatch(normalized, [
    /(\d+)\s*gb\s*ram/,
    /(\d+)\s*gb\s*\+\s*(\d+)\s*gb/
  ]);

  const inch = firstMatch(normalized, [
    /(\d+(?:\.\d+)?)\s*(?:inch|in)\b/
  ]);

  const model = firstMatch(normalized, [
    /\b([a-z]{1,8}\s*\d{1,5}(?:\s*[a-z0-9-]+){0,3})\b/i
  ]);

  return {
    storage: storage ? storage.replace(/\s+/g, '') : null,
    ram: ram ? ram.replace(/\s+/g, '') : null,
    screenSize: inch ? inch.replace(/\s+/g, '') : null,
    model: model ? model.trim() : null,
  };
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeProduct(product = {}) {
  const name = String(product.name || '').replace(/\s+/g, ' ').trim();
  const attrs = extractAttributes(name);
  return {
    ...product,
    name,
    normalizedName: normalizeText(name),
    brand: product.brand || null,
    model: product.model || attrs.model,
    storage: product.storage || attrs.storage,
    ram: product.ram || attrs.ram,
    screenSize: product.screenSize || attrs.screenSize,
    price: Number.isFinite(Number(product.price)) ? Number(product.price) : null,
    originalPrice: Number.isFinite(Number(product.originalPrice)) ? Number(product.originalPrice) : null,
    discount: Number.isFinite(Number(product.discount)) ? Number(product.discount) : 0,
    url: safeUrl(product.url),
    inStock: product.inStock !== false,
    fetchedAt: product.fetchedAt || new Date().toISOString(),
    dataQuality: product.dataQuality || 'scraped',
  };
}

module.exports = { normalizeText, extractAttributes, normalizeProduct, safeUrl };
