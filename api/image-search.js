const MAX_IMAGE_CHARS = 7000000;
const DEFAULT_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash-lite';

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

function extractGeminiText(data) {
  return String(
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      .filter(Boolean)
      .join('\n') || ''
  );
}

function cleanQuery(value) {
  return String(value || '')
    .replace(/[\\r\\n]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .replace(/^[,;|]+|[,;|]+$/g, '')
    .trim()
    .slice(0, 120);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const image = String(req.body?.image || '').trim();
    const ocrText = String(req.body?.ocrText || '').trim().slice(0, 6000);

    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'A valid image is required.' });
    }
    if (image.length > MAX_IMAGE_CHARS) {
      return res.status(413).json({ error: 'Image is too large. Please use a smaller image or screenshot.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    // API key is optional: the frontend can fall back to local OCR-only search.
    if (!apiKey) {
      return res.status(503).json({
        error: 'Gemini Visual Search is not configured yet. Add GEMINI_API_KEY in Vercel Environment Variables.',
        code: 'MISSING_GEMINI_API_KEY',
      });
    }

    const match = image.match(/^data:(image\\/[^;]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ error: 'Invalid image data.' });

    const mimeType = match[1];
    const base64Data = match[2];

    const prompt = `You are PricePeekBD's product-identification engine.

Analyze the supplied product image using BOTH:
1. VISUAL evidence: physical shape, product category, brand/logo, packaging, ports/buttons, layout, distinctive design, and visible product features.
2. OCR evidence: the OCR text supplied below. OCR can be noisy and may contain website UI, seller names, prices, buttons, random fragments, or hallucinated characters.

Your job is NOT to reproduce all visible text. Identify the MAIN PRODUCT TOPIC and create ONE clean marketplace search query.

OCR TEXT (untrusted):
---BEGIN OCR---
${ocrText || '(no reliable OCR text)'}
---END OCR---

Rules:
- Remove website/UI/seller words such as Daraz, Mall, Shop, Store, Price, Buy, Cart, Wishlist, Reviews, Home, Search, Delivery, Login, Seller, Official.
- Remove marketing phrases, random OCR fragments, duplicated words, and unrelated surrounding text.
- Do NOT include price, discount, shipping, seller information, or website navigation text.
- Do NOT invent a brand, model, specification, or feature.
- Use the visual evidence to decide the product category and the OCR evidence to recover useful brand/model/spec text.
- If OCR is wrong but the visual evidence is clear, ignore the bad OCR.
- If the exact model is clearly visible, preserve it.
- Prefer: Brand + Product Type + Model + 1 strong specification when reliable.
- If the model is unclear, use a clean generic product name based on the visual evidence.
- Keep product_name to 2-8 useful words.
- Keep search_query to 2-10 useful words.
- The search query must be suitable for Bangladeshi ecommerce search.
- Return JSON only.

Schema:
{
  "product_name": "",
  "search_query": "",
  "brand": "",
  "model": "",
  "category": "",
  "key_specs": [],
  "confidence": 0.0
}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data,
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 220,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (!response.ok) {
      const message = data?.error?.message || 'Gemini visual product analysis failed.';
      return res.status(response.status >= 500 ? 502 : response.status).json({
        error: message,
        code: 'GEMINI_API_ERROR',
      });
    }

    const parsed = parseJson(extractGeminiText(data));
    const query = cleanQuery(parsed?.search_query || parsed?.product_name);

    if (!query || query.split(/\\s+/).length < 2) {
      return res.status(422).json({
        error: 'The image did not contain enough reliable product information.',
        code: 'LOW_CONFIDENCE_IMAGE',
      });
    }

    return res.status(200).json({
      productName: cleanQuery(parsed?.product_name || query),
      searchQuery: query,
      brand: cleanQuery(parsed?.brand),
      model: cleanQuery(parsed?.model),
      category: cleanQuery(parsed?.category),
      keySpecs: Array.isArray(parsed?.key_specs)
        ? parsed.key_specs.map(v => cleanQuery(v)).filter(Boolean).slice(0, 5)
        : [],
      confidence: Number.isFinite(Number(parsed?.confidence))
        ? Math.max(0, Math.min(1, Number(parsed.confidence)))
        : null,
      source: 'gemini-vision+ocr',
      model: DEFAULT_MODEL,
    });
  } catch (error) {
    console.error('[PricePeek] Gemini visual image search error:', error);
    return res.status(500).json({
      error: 'Visual product analysis failed. Please try again.',
      code: 'GEMINI_VISUAL_ERROR',
    });
  }
};
