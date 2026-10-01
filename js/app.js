
// ============ HEADER ACTIVE TAB ============
function setActiveNav(tab) {
    document.querySelectorAll('.nav-links .nav-link').forEach(link => link.classList.remove('active'));
    const map = { search: 0, deals: 1, wishlist: 2, compare: 3 };
    const index = map[tab];
    const links = document.querySelectorAll('.nav-links .nav-link');
    if (index !== undefined && links[index]) links[index].classList.add('active');
}

// ============ SAFE HTML HELPERS ============
// Keep this helper local to app.js so result rendering never depends on load order.
function escapeHTML(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ============ SAFE FORMATTING HELPERS ============
function formatBDT(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '৳0';
    return '৳' + amount.toLocaleString('en-BD', { maximumFractionDigits: 0 });
}

// ============ APPLICATION STATE ============
const APP_STATE = {
    allProducts: [],
    filteredProducts: [],
    wishlist: JSON.parse(localStorage.getItem('wishlist') || '[]'),
    comparisonList: JSON.parse(localStorage.getItem('comparison') || '[]'),
    currentFilter: 'all',
    currentSort: 'price_asc',
    isSearching: false,
    lastSearchQuery: '',
};

// ============ RESULT VIEW MODE ============
function enterResultView() {
    document.body.classList.add('result-view-active');

    const hideIds = ['heroSection', 'quickSuggestions', 'liveStatus', 'stores-section', 'howItWorks'];
    hideIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const trustStrip = document.querySelector('.trust-strip');
    if (trustStrip) trustStrip.style.display = 'none';

    const results = document.getElementById('resultsSection');
    if (results) results.classList.add('active');
}

// ============ PERFORM SEARCH (keyword) ============
async function performSearch(forceRefresh = false) {
    setActiveNav('search');
    const query = document.getElementById('mainSearch').value.trim();
    if (!query) {
        showNotification('Please enter a product name or URL', 'error');
        return;
    }
    if (APP_STATE.isSearching) return;
    APP_STATE.isSearching = true;
    APP_STATE.lastSearchQuery = query;

    // শুধু কুইক সাজেশন, লাইভ স্ট্যাটাস ও স্টোর স্লাইডার লুকানো
const quick = document.getElementById('quickSuggestions');
if (quick) quick.style.display = 'none';
document.getElementById('liveStatus').style.display = 'none';
const storesSection = document.getElementById('stores-section');
if (storesSection) storesSection.style.display = 'none';

    document.getElementById('loadingSpinner').classList.add('active');
    document.getElementById('loadingText').textContent = 'Fetching live prices...';
    document.getElementById('productGrid').innerHTML = '';
    enterResultView();
    document.getElementById('statusText').textContent = 'Searching...';
    const statusDot = document.querySelector('.status-dot');
    if (statusDot) statusDot.style.background = '#F59E0B';

    try {
        const { products, errors } = await scraperManager.searchAll(query);
        if (products.length === 0) {
            APP_STATE.allProducts = [];
            APP_STATE.filteredProducts = [];
            const resultsCount = document.getElementById('resultsCount');
            if (resultsCount) resultsCount.textContent = 'Found 0 products';
            const queryEl = document.getElementById('resultsQuery');
            if (queryEl) queryEl.textContent = `No matching products for “${query}”`;
            document.getElementById('productGrid').innerHTML = `
                <div class="error-state" style="grid-column:1/-1;">
                    <div style="font-size:48px;">🔍</div>
                    <h3>No products found for "${escapeHTML(query)}"</h3>
                    <p>Try a shorter product name, brand, or model number.</p>
                    <button class="retry-btn" onclick="performSearch(true)">🔄 Retry Search</button>
                </div>`;
        } else {
            APP_STATE.allProducts = products;
            APP_STATE.currentFilter = 'all';
            applyFiltersAndSort();
            /* Result view is intentionally quiet; no completion popup. */
        }
    } catch (error) {
        console.error('Search error:', error);
        showNotification('Search failed. Please try again.', 'error');
    } finally {
        APP_STATE.isSearching = false;
        document.getElementById('loadingSpinner').classList.remove('active');
        document.getElementById('statusText').textContent = 'Ready';
        const readyDot = document.querySelector('.status-dot');
        if (readyDot) readyDot.style.background = '#10B981';
        updateLastUpdated();
    }
}

// ============ SEARCH BY URL ============
async function searchByUrlFromInput(url) {
    setActiveNav('search');
    if (APP_STATE.isSearching) return;
    APP_STATE.isSearching = true;

    enterResultView();

    // হোম সেকশনগুলো লুকানো
    document.getElementById('heroSection').style.display = 'none';
    document.getElementById('liveStatus').style.display = 'none';
    const storesSection = document.getElementById('stores-section');
    if (storesSection) storesSection.style.display = 'none';

    document.getElementById('loadingSpinner').classList.add('active');
    document.getElementById('loadingText').textContent = 'Fetching product from URL...';
    document.getElementById('productGrid').innerHTML = '';
    document.getElementById('bestDealBanner').style.display = 'none';
    document.getElementById('resultsSection').classList.add('active');
    document.getElementById('statusText').textContent = 'Searching by URL...';
    document.querySelector('.status-dot').style.background = '#F59E0B';

    try {
        const data = await scraperManager.searchByUrl(url);
        if (data.products && data.products.length > 0) {
            APP_STATE.allProducts = data.products;
            APP_STATE.currentFilter = 'all';
            applyFiltersAndSort();
            /* Result view is intentionally quiet; no completion popup. */
        } else {
            document.getElementById('productGrid').innerHTML = `
                <div class="error-state" style="grid-column:1/-1;">
                    <div style="font-size:48px;">🔗</div>
                    <h3>No matching products found</h3>
                    <p>The product might not be available on other stores, or the URL could not be recognized.</p>
                </div>`;
        }
    } catch (err) {
        console.error('URL search error:', err);
        showNotification('Error fetching product from URL', 'error');
    } finally {
        APP_STATE.isSearching = false;
        document.getElementById('loadingSpinner').classList.remove('active');
        document.getElementById('statusText').textContent = 'Ready';
        document.querySelector('.status-dot').style.background = '#10B981';
        updateLastUpdated();
    }
}

function normalizeProductUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^www\./i.test(raw)) return 'https://' + raw;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(raw)) return 'https://' + raw;
    return raw;
}

// ============ IMAGE SEARCH ============
let IMAGE_SEARCH_STATE = {
    file: null,
    objectUrl: '',
    isProcessing: false
};

const OCR_NOISE_WORDS = new Set([
    'daraz', 'mall', 'shop', 'store', 'official', 'seller', 'price', 'buy', 'cart',
    'wishlist', 'reviews', 'review', 'home', 'search', 'delivery', 'login', 'signup',
    'account', 'category', 'categories', 'add', 'compare', 'sale', 'offer', 'offers',
    'discount', 'shipping', 'free', 'authentic', 'original', 'limited', 'rating',
    'stock', 'available', 'availability', 'view', 'details', 'click', 'now',
    'tk', 'bdt'
]);

function openImageSearch() {
    const input = document.getElementById('imageSearchInput');
    if (input) input.click();
}

function clearImageSearch() {
    if (IMAGE_SEARCH_STATE.objectUrl) URL.revokeObjectURL(IMAGE_SEARCH_STATE.objectUrl);
    IMAGE_SEARCH_STATE.file = null;
    IMAGE_SEARCH_STATE.objectUrl = '';
    const input = document.getElementById('imageSearchInput');
    if (input) input.value = '';
    const hint = document.getElementById('imageSearchHint');
    if (hint) hint.innerHTML = '📷 Search by image: upload a product image or paste an image with <strong>Ctrl + V</strong>';
}

function setImageSearchFile(file) {
    if (!file || !file.type?.startsWith('image/')) {
        showNotification('Please upload or paste a valid image.', 'error');
        return;
    }

    if (IMAGE_SEARCH_STATE.objectUrl) URL.revokeObjectURL(IMAGE_SEARCH_STATE.objectUrl);
    IMAGE_SEARCH_STATE.file = file;
    IMAGE_SEARCH_STATE.objectUrl = URL.createObjectURL(file);

    const hint = document.getElementById('imageSearchHint');
    if (hint) {
        hint.innerHTML = '<span class="image-search-selected"><img src="' + IMAGE_SEARCH_STATE.objectUrl + '" alt="Selected product image"><span><strong>Image ready.</strong> Click Search to compare prices.</span><button type="button" onclick="clearImageSearch()" aria-label="Remove image">×</button></span>';
    }
}

function cleanOcrProductQuery(rawText = '') {
    const raw = String(rawText || '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[|•·]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!raw) return '';

    const tokens = raw
        .split(/\s+/)
        .map(token => token
            .replace(/^[^a-zA-Z0-9%+.-]+|[^a-zA-Z0-9%+./-]+$/g, '')
            .trim())
        .filter(Boolean);

    const useful = [];
    for (const token of tokens) {
        const lower = token.toLowerCase();

        if (OCR_NOISE_WORDS.has(lower)) continue;
        if (token.length <= 1 && !/[0-9]/.test(token)) continue;
        if (/^[^a-z0-9]+$/i.test(token)) continue;
        if (/^(?:xx+|ww+|nn+|iii+|lll+|sid|cbe)$/i.test(token)) continue;

        const looksLikeSpec = /\d/.test(token) || /%|w|hz|mah|gb|tb|mb|inch|inches|mm|cm/i.test(token);
        const looksLikeWord = /[a-z]{3,}/i.test(token);

        if (looksLikeSpec || looksLikeWord) useful.push(token);
    }

    const unique = [];
    const seen = new Set();
    for (const token of useful) {
        const key = token.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(token);
        if (unique.length >= 10) break;
    }

    return unique.join(' ').slice(0, 120).trim();
}

async function extractLocalOcr(file) {
    if (typeof Tesseract === 'undefined' || typeof Tesseract.recognize !== 'function') {
        return '';
    }

    try {
        const result = await Tesseract.recognize(file, 'eng');
        return String(result?.data?.text || '').trim().slice(0, 6000);
    } catch (error) {
        console.warn('[PricePeek] Local OCR failed:', error);
        return '';
    }
}

async function fileToDataUrl(file, maxSide = 1600, quality = 0.82) {
    const sourceUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Could not read the selected image.'));
            img.src = sourceUrl;
        });

        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        return canvas.toDataURL('image/jpeg', quality);
    } finally {
        URL.revokeObjectURL(sourceUrl);
    }
}

async function imageToSearchQuery(file) {
    const ocrText = await extractLocalOcr(file);
    const ocrFallbackQuery = cleanOcrProductQuery(ocrText);
    const image = await fileToDataUrl(file);

    try {
        const response = await fetch('/api/image-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image, ocrText }),
        });

        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}

        if (response.ok) {
            const query = String(data?.searchQuery || data?.productName || '')
                .replace(/[\r\n]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (query) {
                return {
                    query: query.slice(0, 120),
                    productName: String(data?.productName || query).trim().slice(0, 120),
                    confidence: data?.confidence,
                    source: data?.source || 'gemini-vision+ocr',
                    ocrText
                };
            }
        }

        if (ocrFallbackQuery) {
            return {
                query: ocrFallbackQuery,
                productName: ocrFallbackQuery,
                confidence: null,
                source: 'local-ocr',
                ocrText,
                fallbackReason: data?.error || 'Visual API unavailable'
            };
        }

        throw new Error(data?.error || 'The image did not contain enough reliable product information.');
    } catch (error) {
        if (ocrFallbackQuery) {
            return {
                query: ocrFallbackQuery,
                productName: ocrFallbackQuery,
                confidence: null,
                source: 'local-ocr',
                ocrText,
                fallbackReason: error.message
            };
        }
        throw error;
    }
}

async function searchByImage() {
    setActiveNav('search');
    if (!IMAGE_SEARCH_STATE.file || IMAGE_SEARCH_STATE.isProcessing || APP_STATE.isSearching) return;

    IMAGE_SEARCH_STATE.isProcessing = true;
    const file = IMAGE_SEARCH_STATE.file;
    const loadingSpinner = document.getElementById('loadingSpinner');
    const loadingText = document.getElementById('loadingText');
    const productGrid = document.getElementById('productGrid');

    APP_STATE.lastSearchQuery = '[Image Search]';
    APP_STATE.isSearching = true;
    enterResultView();

    if (loadingSpinner) loadingSpinner.classList.add('active');
    if (loadingText) loadingText.textContent = 'Reading product text + visual details...';
    if (productGrid) productGrid.innerHTML = '';

    try {
        const identification = await imageToSearchQuery(file);
        const query = identification.query;
        const searchInput = document.getElementById('mainSearch');

        if (searchInput) {
            searchInput.value = query;
            searchInput.focus();
            searchInput.select();
        }
        APP_STATE.lastSearchQuery = query;

        const hint = document.getElementById('imageSearchHint');
        if (hint) {
            hint.innerHTML = '✦ Detected product: <strong>' + escapeHTML(query) + '</strong> — edit the search box if needed, then press <strong>Search</strong>.';
        }

        if (loadingText) loadingText.textContent = 'Searching supported stores...';
        const data = await scraperManager.searchAll(query);
        const products = Array.isArray(data?.products) ? data.products : [];

        APP_STATE.allProducts = products;
        APP_STATE.filteredProducts = [];

        const resultsCount = document.getElementById('resultsCount');

        if (products.length > 0) {
            APP_STATE.currentFilter = 'all';
            applyFiltersAndSort();
        } else {
            if (resultsCount) resultsCount.textContent = 'Found 0 products';
            const queryEl = document.getElementById('resultsQuery');
            if (queryEl) queryEl.textContent = 'No matching products for “' + query + '”';
            if (productGrid) {
                productGrid.innerHTML = '<div class="error-state" style="grid-column:1/-1;">' +
                    '<div style="font-size:48px;">📷</div>' +
                    '<h3>We couldn\'t find this product</h3>' +
                    '<p>Detected <strong>' + escapeHTML(query) + '</strong>. Edit the search text above and try again if the OCR/visual result needs correction.</p>' +
                    '<button class="retry-btn" type="button" onclick="document.getElementById(\'mainSearch\').focus()">Edit Search</button>' +
                    '</div>';
            }
        }
    } catch (error) {
        console.error('Visual image search error:', error);
        APP_STATE.allProducts = [];
        APP_STATE.filteredProducts = [];

        const resultsCount = document.getElementById('resultsCount');
        if (resultsCount) resultsCount.textContent = 'Found 0 products';

        if (productGrid) {
            productGrid.innerHTML = '<div class="error-state" style="grid-column:1/-1;">' +
                '<div style="font-size:48px;">📷</div>' +
                '<h3>Image search needs a little more information</h3>' +
                '<p>' + escapeHTML(error.message || 'Please try another product image or screenshot.') + '</p>' +
                '<button class="retry-btn" type="button" onclick="document.getElementById(\'mainSearch\').focus()">Edit Search</button>' +
                '</div>';
        }
    } finally {
        IMAGE_SEARCH_STATE.file = null;
        if (IMAGE_SEARCH_STATE.objectUrl) URL.revokeObjectURL(IMAGE_SEARCH_STATE.objectUrl);
        IMAGE_SEARCH_STATE.objectUrl = '';
        const imageInput = document.getElementById('imageSearchInput');
        if (imageInput) imageInput.value = '';
        IMAGE_SEARCH_STATE.isProcessing = false;
        APP_STATE.isSearching = false;
        if (loadingSpinner) loadingSpinner.classList.remove('active');
        updateLastUpdated();
    }
}

// ============ SMART SEARCH (URL vs keyword vs image) ============
function handleSmartSearch() {
    if (IMAGE_SEARCH_STATE.file) return searchByImage();

    const value = document.getElementById('mainSearch').value.trim();
    if (!value) {
        showNotification('Please enter a product name, model, or what you are looking for.', 'error');
        return;
    }
    const isURL = /^https?:\/\//i.test(value) || /^www\./i.test(value) || /\.(com|bd|net|org)(\/|$)/i.test(value);
    if (isURL) searchByUrlFromInput(normalizeProductUrl(value));
    else performSearch();
}

// ============ HOMEPAGE SOCIAL SHARE ============
async function sharePricePeek(platform) {
    const shareUrl = window.location.origin + '/';
    const shareText = 'Compare prices across Bangladesh with PricePeekBD — Peek Before You Pay.';
    const encodedUrl = encodeURIComponent(shareUrl);
    const encodedText = encodeURIComponent(shareText);

    const shareLinks = {
        facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + encodedUrl,
        whatsapp: 'https://wa.me/?text=' + encodeURIComponent(shareText + ' ' + shareUrl),
        x: 'https://twitter.com/intent/tweet?text=' + encodedText + '&url=' + encodedUrl,
        telegram: 'https://t.me/share/url?url=' + encodedUrl + '&text=' + encodedText
    };

    if (platform === 'copy') {
        try {
            await navigator.clipboard.writeText(shareUrl);

        } catch (error) {
            const fallback = document.createElement('textarea');
            fallback.value = shareUrl;
            document.body.appendChild(fallback);
            fallback.select();
            document.execCommand('copy');
            fallback.remove();

        }
        return;
    }

    if (platform === 'messenger') {
        // On supported phones/tablets, the native share sheet can hand the
        // link directly to Messenger when Messenger is installed.
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'PricePeekBD',
                    text: shareText,
                    url: shareUrl
                });
                return;
            } catch (error) {
                if (error?.name === 'AbortError') return;
            }
        }

        // Desktop browsers do not expose a reliable public Messenger
        // "share this URL" endpoint without a Meta App ID. Copy the link
        // and open Messenger so the user can paste it immediately.
        try {
            await navigator.clipboard.writeText(shareUrl);
        } catch (error) {
            const fallback = document.createElement('textarea');
            fallback.value = shareUrl;
            document.body.appendChild(fallback);
            fallback.select();
            document.execCommand('copy');
            fallback.remove();
        }
        window.open('https://www.messenger.com/', '_blank', 'noopener,noreferrer');
        showNotification('Link copied — paste it in Messenger', 'success');
        return;
    }

    const target = shareLinks[platform];
    if (!target) return;
    window.open(target, '_blank', 'noopener,noreferrer,width=700,height=650');
}

// ============ FOOTER SOCIAL SHARE ============
document.addEventListener('click', event => {
    const button = event.target.closest('.footer-social-btn[data-share]');
    if (!button) return;
    sharePricePeek(button.dataset.share);
});

// ============ GLOBAL SEARCH SHORTCUT ============
document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const input = document.getElementById('mainSearch');
        if (input) {
            input.focus();
            input.select();
        }
    }
});

// ============ IMAGE UPLOAD + CLIPBOARD PASTE ============
document.addEventListener('DOMContentLoaded', () => {
    const imageInput = document.getElementById('imageSearchInput');
    if (imageInput) imageInput.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (file) setImageSearchFile(file);
    });

    const searchInput = document.getElementById('mainSearch');
    if (searchInput) searchInput.addEventListener('paste', event => {
        const items = Array.from(event.clipboardData?.items || []);
        const imageItem = items.find(item => item.type.startsWith('image/'));
        if (!imageItem) return;
        const file = imageItem.getAsFile();
        if (!file) return;
        event.preventDefault();
        setImageSearchFile(file);
    });
});

// ============ STORE SLIDER NAVIGATION ============
function slideStores(direction) {
    const slider = document.getElementById('storeSlider');
    if (slider) slider.scrollBy({ left: direction * 140, behavior: 'smooth' });
}

// ============ THEME ICONS ============
function getThemeIcon(mode) {
    if (mode === 'light') {
        return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2.2M12 19.8V22M4.93 4.93l1.56 1.56M17.51 17.51l1.56 1.56M2 12h2.2M19.8 12H22M4.93 19.07l1.56-1.56M17.51 6.49l1.56-1.56" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.6 8.6 0 1 0 20.2 15.2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
}

// ============ DARK/LIGHT MODE ============
function initTheme() {
    const body = document.body;
    const toggleBtn = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    if (!toggleBtn || !themeIcon) return;

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        body.classList.add('dark');
        themeIcon.innerHTML = getThemeIcon('light');
    } else {
        themeIcon.innerHTML = getThemeIcon('dark');
    }

    toggleBtn.addEventListener('click', () => {
        body.classList.toggle('dark');
        const isDark = body.classList.contains('dark');
        themeIcon.innerHTML = getThemeIcon(isDark ? 'light' : 'dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });
}

// ============ FILTER & SORT ============
function applyFiltersAndSort() {
    let products = [...APP_STATE.allProducts];
    if (APP_STATE.currentFilter !== 'all') {
        if (APP_STATE.currentFilter === 'inStock') {
            products = products.filter(p => p.inStock);
        } else if (APP_STATE.currentFilter === 'discount') {
            products = products.filter(p => p.discount > 0);
        } else if (APP_STATE.currentFilter === 'cashback') {
            products = products.filter(p => p.cashback && p.cashback.length > 0);
        } else {
            products = products.filter(p => p.marketplace === APP_STATE.currentFilter);
        }
    }
    switch (APP_STATE.currentSort) {
        case 'price_asc': products.sort((a, b) => (a.price || Infinity) - (b.price || Infinity)); break;
        case 'price_desc': products.sort((a, b) => (b.price || 0) - (a.price || 0)); break;
        case 'discount_desc': products.sort((a, b) => (b.discount || 0) - (a.discount || 0)); break;
        case 'name_asc': products.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
    }
    APP_STATE.filteredProducts = products;
    renderProducts(products);
    document.getElementById('resultsCount').textContent = `Found ${products.length} products`;
    const queryEl = document.getElementById('resultsQuery');
    if (queryEl) {
        const q = APP_STATE.lastSearchQuery || document.getElementById('mainSearch')?.value?.trim() || '';
        queryEl.textContent = q ? `Comparing offers for “${q}”` : 'Compare offers from supported Bangladesh stores';
    }
    const freshnessEl = document.getElementById('resultsFreshness');
    if (freshnessEl) freshnessEl.textContent = 'Prices checked live';
}

function toggleFilter(button, filter) {
    document.querySelectorAll('.filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
    button.classList.add('active');
    APP_STATE.currentFilter = filter;
    applyFiltersAndSort();
}

function sortResults() {
    APP_STATE.currentSort = document.getElementById('sortSelect').value;
    applyFiltersAndSort();
}

function renderProductSkeletons(count = 8) {
    return Array.from({length: count}, () => `
        <div class="product-skeleton" aria-hidden="true">
            <div class="skeleton-image"></div>
            <div class="skeleton-line wide"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-price"></div>
            <div class="skeleton-line short"></div>
            <div class="skeleton-actions"></div>
        </div>`).join('');
}

function renderSearchError(message = 'We could not load prices right now.') { const grid=document.getElementById('productGrid'); if(!grid)return; grid.innerHTML='<div class="error-state"><h3>Something went wrong</h3><p>'+escapeHTML(message)+'</p><button type="button" onclick="refreshResults()">Try Again</button></div>'; }

// ============ RENDER PRODUCTS (rating with one decimal) ============
function getBestDealProduct(products) {
    const inStock = products.filter(p => p.inStock && p.price);
    if (!inStock.length) return null;
    const maxReview = Math.max(...inStock.map(p => p.reviewCount || 0));
    const minPrice = Math.min(...inStock.map(p => p.price));
    const maxSold = Math.max(...inStock.map(p => p.soldCount || 0));
    const getScore = (product) => {
        let score = 0;
        if (maxReview > 0 && product.reviewCount) score += (product.reviewCount / maxReview) * 50;
        if (product.price && minPrice > 0) score += (minPrice / product.price) * 30;
        if (product.discount) score += (product.discount / 100) * 15;
        if (maxSold > 0 && product.soldCount) score += (product.soldCount / maxSold) * 5;
        return score;
    };
    return inStock.reduce((best, current) => getScore(current) > getScore(best) ? current : best);
}

function renderProducts(products) {
    const grid = document.getElementById('productGrid');
    if (products.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#9CA3AF;">No products match current filters</div>';
        return;
    }
    const cheapest = products.filter(p => p.inStock && p.price != null).sort((a,b) => a.price - b.price)[0];
    const bestDeal = getBestDealProduct(products);

    grid.innerHTML = products.map(product => {
        const isCheapest = cheapest && ((product.id && product.id === cheapest.id) || product.url === cheapest.url);
        const isBestDeal = bestDeal && ((product.id && product.id === bestDeal.id) || product.url === bestDeal.url);
        const isWishlisted = APP_STATE.wishlist.some(w => w.id === product.id);
        const isCompared = APP_STATE.comparisonList.some(c => c.id === product.id);
        const marketplaceClass = getMarketplaceClass(product.marketplace);

        let metaHTML = '';
        if (product.rating) {
            const ratingFixed = product.rating.toFixed(1);
            metaHTML = `⭐ ${ratingFixed}`;
            if (product.reviewCount) metaHTML += ` (${product.reviewCount} reviews)`;
            if (product.soldCount) metaHTML += ` • 🔥 ${product.soldCount} sold`;
        }

        return `
            <div class="product-card ${isCheapest ? 'best-choice' : ''}" data-id="${product.id}">
                <div class="card-corner-badges">
                    ${isCheapest ? '<span class="corner-badge best-price-badge">🏷 Best Price</span>' : ''}
                    ${isBestDeal ? '<span class="corner-badge best-deal-badge">★ Best Deal</span>' : ''}
                </div>
                <span class="marketplace-badge ${marketplaceClass}">${product.marketplace} ${product.isOfficial ? '✅ Official' : ''}</span>
                <div class="product-image-container">
                    ${product.image ? `<img src="${product.image}" alt="${escapeHTML(product.name || 'Product')}" onerror="this.parentElement.innerHTML='<span class=\'product-image-placeholder\'>📦</span>'">` : '<span class="product-image-placeholder">📦</span>'}
                </div>
                <div class="product-name">${escapeHTML(product.name || 'Unknown Product')}</div>
                <div class="product-pricing">
                    <span class="current-price">${formatBDT(product.price)}</span>
                    ${product.originalPrice && product.originalPrice > product.price ? `<span class="original-price">${formatBDT(product.originalPrice)}</span>` : ''}
                    ${product.discount > 0 ? `<span class="discount-badge">-${product.discount}%</span>` : ''}
                </div>
                ${metaHTML ? `<div class="product-meta" style="font-size:0.72rem; color:var(--gray-500); margin-top:4px;">${metaHTML}</div>` : ''}
                <div class="stock-status ${product.inStock ? 'in-stock' : 'out-stock'}">
                    ${product.inStock ? 'In Stock' : 'Out of Stock'}
                </div>
                ${product.coupons && product.coupons.length > 0 ? `<div class="coupon-row">${product.coupons.map(c => `<span class="coupon-chip" onclick="copyToClipboard('${c.code}')">🎫 ${c.code} (${c.type==='percentage' ? c.discount+'%' : '৳'+c.discount})</span>`).join('')}</div>` : ''}
                ${product.cashback && product.cashback.length > 0 ? `<div class="coupon-row">${product.cashback.map(c => `<span class="cashback-chip">${c.provider} ${c.percentage}% (Max ৳${c.maxAmount})</span>`).join('')}</div>` : ''}
                <div class="card-actions">
                    <a href="${product.url || '#'}" target="_blank" rel="noopener noreferrer" class="btn-visit btn-primary" onclick="trackClick('${product.marketplace}', '${product.name}')">Visit Store →</a>
                    <button class="btn-wishlist ${isWishlisted ? 'active' : ''}" onclick="toggleWishlist('${product.id}')">${isWishlisted ? '❤️' : '🤍'}</button>
                    <button class="btn-compare ${isCompared ? 'active' : ''}" onclick="toggleCompare('${product.id}')">⚖️</button>
                </div>
            </div>`;
    }).join('');
}

// ============ UPDATE BEST DEAL (review, price, sold centered) ============
function renderPriceSummary(products) {
    const valid = products.filter(p => p.inStock && p.price != null).sort((a,b) => a.price - b.price);
    let box = document.getElementById('priceSummary');
    if (!box) {
        box = document.createElement('div');
        box.id = 'priceSummary';
        box.className = 'price-summary';
        const banner = document.getElementById('bestDealBanner');
        banner.parentNode.insertBefore(box, banner.nextSibling);
    }
    if (!valid.length) { box.innerHTML = ''; return; }
    const cheapest = valid[0];
    const highest = valid[valid.length - 1];
    const savings = Math.max(0, highest.price - cheapest.price);
    box.innerHTML = `
      <div class="summary-card">
        <div class="summary-label">Lowest price found</div>
        <strong>${formatBDT(cheapest.price)}</strong>
        <span>${escapeHTML(cheapest.marketplace || 'Store')}</span>
      </div>
      <div class="summary-card">
        <div class="summary-label">Price range</div>
        <strong>${formatBDT(cheapest.price)} — ${formatBDT(highest.price)}</strong>
        <span>${valid.length} in-stock offers compared</span>
      </div>
      <div class="summary-card">
        <div class="summary-label">Possible saving</div>
        <strong>${formatBDT(savings)}</strong>
        <span>vs. highest listed price</span>
      </div>`;
}

function updateBestDeal(products) {
    // Best Deal is shown as a compact badge on the matching product card.
    const banner = document.getElementById('bestDealBanner');
    if (banner) {
        banner.innerHTML = '';
        banner.style.display = 'none';
    }
}

// ============ WISHLIST ============
function toggleWishlist(productId) {
    const product = APP_STATE.allProducts.find(p => p.id == productId);
    if (!product) return;
    const index = APP_STATE.wishlist.findIndex(w => w.id == productId);
    if (index > -1) {
        APP_STATE.wishlist.splice(index, 1);
        showNotification('Removed from wishlist', 'info');
    } else {
        APP_STATE.wishlist.push({...product, savedAt: new Date().toISOString()});
        showNotification('Added to wishlist', 'success');
    }
    localStorage.setItem('wishlist', JSON.stringify(APP_STATE.wishlist));
    updateWishlistCount();
    renderProducts(APP_STATE.filteredProducts);
    renderWishlistDrawer();
}
function updateWishlistCount() { document.getElementById('wishlist-count').textContent = APP_STATE.wishlist.length; }
function toggleWishlistDrawer() {
    setActiveNav('wishlist');
    const drawer = document.getElementById('wishlistDrawer');
    drawer.classList.toggle('active');
    renderWishlistDrawer();
}
function renderWishlistDrawer() {
    const body = document.getElementById('wishlistBody');
    if (APP_STATE.wishlist.length === 0) {
        body.innerHTML = '<p style="color:#9CA3AF; text-align:center; padding:40px 0;">No items in wishlist yet.<br>Click the heart icon to add products.</p>';
    } else {
        body.innerHTML = APP_STATE.wishlist.map((product, index) => `
            <div style="padding:12px; border:1px solid #E5E7EB; border-radius:8px; margin-bottom:8px; display:flex; gap:12px; align-items:center;">
                <div style="font-size:40px; width:50px; text-align:center;">📦</div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis;">${product.name}</div>
                    <div style="color:#6B7280; font-size:12px;">${product.marketplace} • ${formatPrice(product.price)}</div>
                    <div style="font-size:10px; color:#9CA3AF;">Saved: ${new Date(product.savedAt).toLocaleDateString()}</div>
                </div>
                <button onclick="removeFromWishlist(${index})" style="background:none; border:none; cursor:pointer; font-size:18px; color:#EF4444;">🗑️</button>
            </div>`).join('');
    }
}
function removeFromWishlist(index) {
    APP_STATE.wishlist.splice(index, 1);
    localStorage.setItem('wishlist', JSON.stringify(APP_STATE.wishlist));
    updateWishlistCount();
    renderWishlistDrawer();
    renderProducts(APP_STATE.filteredProducts);
    showNotification('Removed from wishlist', 'info');
}

// ============ COMPARISON ============
function toggleCompare(productId) {
    const product = APP_STATE.allProducts.find(p => p.id == productId);
    if (!product) return;
    const index = APP_STATE.comparisonList.findIndex(c => c.id == productId);
    if (index > -1) {
        APP_STATE.comparisonList.splice(index, 1);
        showNotification('Removed from comparison', 'info');
    } else {
        if (APP_STATE.comparisonList.length >= 5) {
            showNotification('Maximum 5 products can be compared', 'error');
            return;
        }
        APP_STATE.comparisonList.push(product);
        showNotification('Added to comparison', 'success');
    }
    localStorage.setItem('comparison', JSON.stringify(APP_STATE.comparisonList));
    updateComparisonUI();
    renderProducts(APP_STATE.filteredProducts);
}
function updateComparisonUI() {
    const count = APP_STATE.comparisonList.length;
    document.getElementById('compare-count').textContent = count;
    document.getElementById('compareCountPanel').textContent = count;
    document.getElementById('compareBtn').disabled = count < 2;
    const panel = document.getElementById('comparisonPanel');
    const itemsContainer = document.getElementById('comparisonItems');
    if (count > 0) {
        panel.classList.add('active');
        itemsContainer.innerHTML = APP_STATE.comparisonList.map(p => `
            <div class="comparison-item">
                <span class="remove-compare" onclick="toggleCompare('${p.id}')">✕</span>
                <div style="text-align:center; font-size:30px;">📦</div>
                <div style="font-size:12px; font-weight:600;">${p.marketplace}</div>
                <div style="font-weight:700;">${formatPrice(p.price)}</div>
            </div>`).join('');
    } else {
        panel.classList.remove('active');
    }
}
function clearComparison() {
    APP_STATE.comparisonList = [];
    localStorage.setItem('comparison', JSON.stringify([]));
    updateComparisonUI();
    renderProducts(APP_STATE.filteredProducts);
    showNotification('Comparison cleared', 'info');
}
function showComparison() {
    setActiveNav('compare');
    updateComparisonUI();
    document.getElementById('comparisonPanel').classList.add('active');
}
function compareProducts() {
    if (APP_STATE.comparisonList.length < 2) return;
    const modal = document.getElementById('comparisonModal');
    const body = document.getElementById('comparisonModalBody');
    body.innerHTML = `
        <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse;">
                <thead><tr>
                    <th style="padding:12px; border-bottom:2px solid #E5E7EB; text-align:left;">Feature</th>
                    ${APP_STATE.comparisonList.map(p => `<th style="padding:12px; text-align:center;"><div style="font-weight:600;">${p.marketplace}</div><div style="font-size:11px; color:#6B7280;">${p.name?.substring(0,30)}...</div></th>`).join('')}
                </tr></thead>
                <tbody>
                    ${createComparisonRow('Price', p => formatPrice(p.price))}
                    ${createComparisonRow('Original Price', p => p.originalPrice ? formatPrice(p.originalPrice) : 'N/A')}
                    ${createComparisonRow('Discount', p => p.discount > 0 ? `-${p.discount}%` : 'None')}
                    ${createComparisonRow('Status', p => p.inStock ? '🟢 In Stock' : '🔴 Out of Stock')}
                    ${createComparisonRow('Official Store', p => p.isOfficial ? '✅ Yes' : '❌ No')}
                    ${createComparisonRow('Rating', p => p.rating ? `⭐ ${p.rating.toFixed(1)} (${p.reviewCount || 0} reviews)` : 'N/A')}
                    ${createComparisonRow('Coupons', p => p.coupons?.map(c => c.code).join(', ') || 'None')}
                    ${createComparisonRow('Cashback', p => p.cashback?.map(c => `${c.provider} ${c.percentage}%`).join(', ') || 'None')}
                </tbody>
            </table>
        </div>`;
    modal.classList.add('active');
}
function createComparisonRow(label, valueFn) {
    return `<tr><td style="padding:10px; border-bottom:1px solid #F3F4F6; font-weight:600;">${label}</td>${APP_STATE.comparisonList.map(p => `<td style="padding:10px; text-align:center;">${valueFn(p)}</td>`).join('')}</tr>`;
}
function closeComparisonModal() { document.getElementById('comparisonModal').classList.remove('active'); }

// ============ DEALS PAGE ============
async function showDealsPage() {
    setActiveNav('deals');
    // হোম সেকশন লুকানো (ডিল পেজে যাওয়ার সময়ও)
    document.getElementById('heroSection').style.display = 'none';
    document.getElementById('liveStatus').style.display = 'none';
    const storesSection = document.getElementById('stores-section');
    if (storesSection) storesSection.style.display = 'none';

    // Keep the Best Deals page focused on deal results only.
    const trustStrip = document.querySelector('.trust-strip');
    if (trustStrip) trustStrip.style.display = 'none';
    const howItWorks = document.getElementById('howItWorks');
    if (howItWorks) howItWorks.style.display = 'none';

    document.getElementById('loadingSpinner').classList.add('active');
    document.getElementById('resultsSection').classList.add('active');
    const popularQueries = ['phone', 'laptop', 'tv', 'headphone', 'mouse'];
    let allProducts = [];
    for (const q of popularQueries) {
        const { products } = await scraperManager.searchAll(q);
        allProducts.push(...products);
    }
    const unique = allProducts.filter((p, i, arr) => arr.findIndex(x => x.name === p.name && x.marketplace === p.marketplace) === i);
    unique.sort((a, b) => (b.discount || 0) - (a.discount || 0));
    APP_STATE.allProducts = unique.slice(0, 50);
    APP_STATE.currentFilter = 'all';
    APP_STATE.currentSort = 'discount_desc';

    // Best Deals has its own page heading instead of the generic search-result count.
    const resultsCount = document.getElementById('resultsCount');
    if (resultsCount) resultsCount.textContent = 'Best Deals';
    document.getElementById('sortSelect').value = 'discount_desc';
    applyFiltersAndSort();
    document.getElementById('loadingSpinner').classList.remove('active');
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

// ============ INITIALIZATION ============
function init() {
    initTheme();
    updateWishlistCount();
    updateComparisonUI();
    renderWishlistDrawer();

    document.getElementById('comparisonModal').addEventListener('click', function(e) {
        if (e.target === this) closeComparisonModal();
    });

    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            document.getElementById('mainSearch').focus();
        }
    });

    updateLastUpdated();
    console.log('PricePeekBD ready.');
}

document.addEventListener('DOMContentLoaded', init);