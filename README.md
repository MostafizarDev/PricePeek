# 🏷️ PricePeekBD — Peek Before You Pay.

> বাংলাদেশের অনলাইন শপিং-এর দাম এক জায়গায় তুলনা করুন।  
> Compare product prices across supported online stores in Bangladesh.

---

## ✨ Features

- 🔍 **Product Search** — Search by product name, brand, model, or keyword.
- 🔗 **URL Search** — Paste a supported marketplace product URL.
- 📷 **Image Search** — Upload an image or paste an image with **Ctrl + V**.
- 🧠 **Visual + OCR Search** — Reads the product visually and also extracts visible text.
- 🧹 **Clean Query** — Removes seller/UI/website/price/marketing text before marketplace search.
- ✏️ **Editable Image Result** — The detected product name is placed in the normal search box, so you can edit it before searching again.
- 💰 **Price Comparison** — Compare available prices, stock, discounts and store offers.
- ❤️ **Wishlist** — Save products locally without an account.
- ⚖️ **Compare** — Compare multiple products.
- 📱 **Responsive** — Works on desktop and mobile.

---

# 📷 Image Search

PricePeekBD uses a two-stage image workflow:

```
Image Upload / Ctrl+V
        ↓
Local OCR (Tesseract)
        ↓
Remove obvious OCR/UI noise
        ↓
Gemini Vision + OCR context
        ↓
Visual product identification
        ↓
Clean Product Name / Search Query
        ↓
Editable Search Box
        ↓
Marketplace Search
        ↓
Price Comparison
```

### Why both OCR and Vision?

OCR alone can read unwanted screenshot text such as:

- Daraz
- Mall
- Shop
- Price
- Buy
- Cart
- Delivery
- Reviews
- random OCR fragments

So PricePeek first extracts OCR text, then Gemini receives the image **plus the OCR text** and is instructed to keep only the main product topic.

Example:

```
Bad OCR:
22.5W I.5 Super Fast Charger Power Ww N Daraz Mall

Clean search:
22.5W Super Fast Power Bank
```

The exact result depends on the image quality and visible product information.

---

# ✏️ Edit the detected search text

Image search does **not lock the detected product name**.

After image analysis:

```
Image
 ↓
Detected product
 ↓
Search box ← YOU CAN EDIT THIS
 ↓
Press Search
 ↓
Marketplace comparison
```

The normal search box remains editable. If the detected name is not correct, change it manually and press **Search**.

---

# 🤖 Gemini Vision API Setup

Image search works with local OCR even without a Gemini key, but **Visual + OCR identification requires a Gemini API key**.

The project is configured to use:

```
GEMINI_API_KEY
```

Optional model setting:

```
GEMINI_VISION_MODEL=gemini-2.5-flash-lite
```

The default model is already set in:

```
api/image-search.js
```

You do **not** need to paste the API key directly into JavaScript.

---

## 1. Create a Gemini API key

Open Google AI Studio:

https://aistudio.google.com/

Then:

1. Sign in with your Google account.
2. Open the **API Keys** section.
3. Create a new API key.
4. Copy the key.

Google's official Gemini API documentation says API keys can be created and managed from Google AI Studio.  
Official documentation:

https://ai.google.dev/gemini-api/docs/api-key

Gemini supports image input, and the selected `gemini-2.5-flash-lite` model supports text + image input.  
Model documentation:

https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite

---

# 🚀 2. Add the key to Vercel

For the live PricePeekBD website:

1. Open your **Vercel Dashboard**.
2. Open the **PricePeek** project.
3. Go to **Settings**.
4. Open **Environment Variables**.
5. Add:

```
Name:
GEMINI_API_KEY

Value:
YOUR_GEMINI_API_KEY
```

Add it for the environment(s) where you deploy PricePeekBD, normally:

- Production
- Preview
- Development, if needed

Optional:

```
Name:
GEMINI_VISION_MODEL

Value:
gemini-2.5-flash-lite
```

Then redeploy the project.

---

# 🔐 Important: Never put the API key in frontend code

Do **NOT** write this:

```js
const GEMINI_API_KEY = "AIza...";
```

Do **NOT** put the key inside:

- `index.html`
- `js/app.js`
- public JavaScript
- browser/localStorage
- GitHub source code

The key is read only by the server-side Vercel function:

```
api/image-search.js
```

The server sends the request to Gemini using:

```
x-goog-api-key
```

The browser only calls:

```
/api/image-search
```

This keeps the secret out of the frontend.

---

# 🆓 Free Tier

Gemini API currently provides a free tier for selected models, including free input/output for some models. Limits and model availability can change, so do not treat the free tier as an unlimited lifetime guarantee.

Current official pricing:

https://ai.google.dev/gemini-api/docs/pricing

For PricePeekBD, the image-search request is intentionally small:

- one product image
- local OCR text
- short instruction
- short JSON response

This helps reduce API usage.

---

# 🧠 Image Search API Flow

Frontend:

```
js/app.js
    ↓
Tesseract OCR
    ↓
/api/image-search
```

Backend:

```
api/image-search.js
    ↓
GEMINI_API_KEY
    ↓
Gemini Vision
    ↓
Clean JSON
```

Response example:

```json
{
  "productName": "ViewSonic ColorPro Monitor",
  "searchQuery": "ViewSonic ColorPro Monitor",
  "brand": "ViewSonic",
  "model": "",
  "category": "Monitor",
  "keySpecs": [],
  "confidence": 0.91
}
```

The frontend uses only the clean `searchQuery` for marketplace searching.

---

# 🛡️ OCR Fallback

If Gemini is not configured, unavailable, or temporarily fails:

```
Image
 ↓
Local Tesseract OCR
 ↓
Remove common UI / seller / ecommerce noise
 ↓
Clean OCR query
 ↓
Marketplace Search
```

So the entire image-search feature does not completely stop just because the Gemini API is unavailable.

However, **OCR fallback cannot understand visual-only information as well as Gemini Vision**.

---

# 🚀 Run Locally

```bash
git clone https://github.com/prostockerai/PricePeek.git
cd PricePeek
npm install
vercel dev
```

For local environment variables, copy:

```
.env.example
```

to:

```
.env.local
```

Then add:

```
GEMINI_API_KEY=your_real_key_here
GEMINI_VISION_MODEL=gemini-2.5-flash-lite
```

Never commit `.env.local` or a real API key.

---

# 🛒 Current Search Workflow

```
TEXT SEARCH
    ↓
Marketplace Search
    ↓
Normalize Products
    ↓
Match Same Products
    ↓
Compare Prices
```

or:

```
URL SEARCH
    ↓
Read Source Product
    ↓
Marketplace Search
    ↓
Match Same Products
    ↓
Compare Prices
```

or:

```
IMAGE SEARCH
    ↓
OCR + Visual Analysis
    ↓
Clean Product Query
    ↓
User Can Edit Query
    ↓
Marketplace Search
    ↓
Match Same Products
    ↓
Compare Prices
```

---

## 🛠️ Project

Repository:

https://github.com/prostockerai/PricePeek

Live site:

https://pricepeekbd.vercel.app/

### Main image-search files

```
api/image-search.js
js/app.js
index.html
.env.example
```

---

## ⚠️ Important

PricePeekBD is a price-comparison interface. Product availability, price, discount and stock information can change. Always verify the final price and product details on the original store before purchasing.
