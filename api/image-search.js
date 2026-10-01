const MAX_IMAGE_CHARS = 7000000;
const DEFAULT_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-luna';

function extractOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n');
}

function parseJson(text) {
  const cleaned = String(text || '')
    .replace(/^\s*\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`\s*$/i, '')
    .trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'Visual image search is not configured. Add OPENAI_API_KEY to the Vercel environment variables.'
    });
  }

  try {
    const image = String(req.body?.image || '').trim();
    if (!image.startsWith('data:image/')) return res.status(400).json({ error: 'A valid image is required.' });
    if (image.length > MAX_IMAGE_CHARS) return res.status(413).json({ error: 'Image is too large. Please use a smaller image or screenshot.' });

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_output_tokens: 220,
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'You are PricePeekBD product-identification engine. Analyze this product image using BOTH visual evidence (shape, category, design, brand/logo, packaging, ports/buttons, distinctive physical features) AND OCR evidence (brand, model, capacity, wattage, size, useful visible specifications). Create ONE clean marketplace search query likely to find the same or closest product on Bangladeshi ecommerce stores. Never include website/UI/seller words such as Daraz, Mall, Shop, Store, Price, Buy, Cart, Wishlist, Reviews, Home, Search, Delivery. Never include random OCR garbage or uncertain words. Do not invent a brand, model, specification, or feature. Prefer Brand + product family/category + exact model if clearly visible + one or two strong specifications. If exact model is unclear, use a useful generic product name based on visual evidence. Keep product_name between 2 and 8 useful words. If text and visual evidence disagree, use clearer evidence and avoid uncertain details. Return JSON only: {"product_name":"","search_query":"","brand":"","model":"","category":"","key_specs":[],"confidence":0.0}',
            },
            {
              type: 'input_image',
              image_url: image,
              detail: 'high',
            },
          ],
        }],
      }),
    });

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (!response.ok) {
      const message = data?.error?.message || 'Visual product analysis failed.';
      return res.status(response.status >= 500 ? 502 : response.status).json({ error: message });
    }

    const parsed = parseJson(extractOutputText(data));
    const query = String(parsed?.search_query || parsed?.product_name || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    if (!query || query.split(/\s+/).length < 2) {
      return res.status(422).json({ error: 'The image did not contain enough reliable product information.' });
    }

    return res.status(200).json({
      productName: String(parsed?.product_name || query).trim().slice(0, 120),
      searchQuery: query,
      brand: String(parsed?.brand || '').trim(),
      model: String(parsed?.model || '').trim(),
      category: String(parsed?.category || '').trim(),
      keySpecs: Array.isArray(parsed?.key_specs) ? parsed.key_specs.slice(0, 5) : [],
      confidence: Number.isFinite(Number(parsed?.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : null,
    });
  } catch (error) {
    console.error('[PricePeek] visual image search error:', error);
    return res.status(500).json({ error: 'Visual product analysis failed. Please try again.' });
  }
};
