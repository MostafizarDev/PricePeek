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

// ============ PERFORM SEARCH (keyword) ============
async function performSearch(forceRefresh = false) {
    const query = document.getElementById('mainSearch').value.trim();
    if (!query) {
        showNotification('Please enter a product name or URL', 'error');
        return;
    }
    if (APP_STATE.isSearching) return;
    APP_STATE.isSearching = true;


    // শুধু কুইক সাজেশন, লাইভ স্ট্যাটাস ও স্টোর স্লাইডার লুকানো
const quick = document.getElementById('quickSuggestions');
if (quick) quick.style.display = 'none';
document.getElementById('liveStatus').style.display = 'none';
const storesSection = document.getElementById('stores-section');
if (storesSection) storesSection.style.display = 'none';

    document.getElementById('loadingSpinner').classList.add('active');
    document.getElementById('loadingText').textContent = 'Fetching live prices...';
    document.getElementById('productGrid').innerHTML = '';
    document.getElementById('bestDealBanner').style.display = 'none';
    document.getElementById('resultsSection').classList.add('active');
    document.getElementById('statusText').textContent = 'Searching...';
    document.querySelector('.status-dot').style.background = '#F59E0B';

    try {
        const { products, errors } = await scraperManager.searchAll(query);
        if (products.length === 0) {
            document.getElementById('productGrid').innerHTML = `
                <div class="error-state" style="grid-column:1/-1;">
                    <div style="font-size:48px;">🔍</div>
                    <h3>No products found for "${query}"</h3>
                    <p>Try different keywords or check your spelling</p>
                    <button class="retry-btn" onclick="performSearch(true)">🔄 Retry Search</button>
                </div>`;
        } else {
            APP_STATE.allProducts = products;
            APP_STATE.currentFilter = 'all';
            applyFiltersAndSort();
            showNotification(`Found ${products.length} products`, 'success');
        }
    } catch (error) {
        console.error('Search error:', error);
        showNotification('Search failed. Please try again.', 'error');
    } finally {
        APP_STATE.isSearching = false;
        document.getElementById('loadingSpinner').classList.remove('active');
        document.getElementById('statusText').textContent = 'Ready';
        document.querySelector('.status-dot').style.background = '#10B981';
        updateLastUpdated();
    }
}

// ============ SEARCH BY URL ============
async function searchByUrlFromInput(url) {
    if (APP_STATE.isSearching) return;
    APP_STATE.isSearching = true;

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
            showNotification(`Found ${data.products.length} products`, 'success');
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

// ============ SMART SEARCH (URL vs keyword) ============
function handleSmartSearch() {
    const value = document.getElementById('mainSearch').value.trim();
    if (!value) {
        showNotification('Please enter a product name or URL', 'error');
        return;
    }
    const isURL = /^https?:\/\//i.test(value) || /^www\./i.test(value) || /\.(com|bd|net|org)(\/|$)/i.test(value);
    if (isURL) {
        searchByUrlFromInput(value);
    } else {
        performSearch();
    }
}

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
    updateBestDeal(products);
    document.getElementById('resultsCount').textContent = `Found ${products.length} offers`;
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
function renderProducts(products) {
    const grid = document.getElementById('productGrid');
    if (products.length === 0) {
        grid.innerHTML = '<div class="empty-state"><h3>No matching products</h3><p>Try another keyword or remove one of the active filters.</p></div>';
        return;
    }
    const cheapest = products.filter(p => p.inStock && p.price != null).sort((a, b) => a.price - b.price)[0];
    grid.innerHTML = products.map(product => {
        const isCheapest = cheapest && ((product.id && product.id === cheapest.id) || product.url === cheapest.url);
        const isWishlisted = APP_STATE.wishlist.some(w => w.id === product.id);
        const isCompared = APP_STATE.comparisonList.some(c => c.id === product.id);
        const marketplaceClass = getMarketplaceClass(product.marketplace);

        // রেটিং ও রিভিউ তথ্য (এক দশমিক স্থানে)
        let metaHTML = '';
        if (product.rating) {
            const ratingFixed = product.rating.toFixed(1);
            metaHTML = `${ratingFixed}`;
            if (product.reviewCount) metaHTML += ` (${product.reviewCount} reviews)`;
            if (product.soldCount) metaHTML += ` • ${product.soldCount} sold`;
        }

        return `
            <div class="product-card ${isCheapest ? 'best-choice' : ''}" data-id="${product.id}">
                ${isCheapest ? '<span class="best-badge">Best Price</span>' : ''}
                <span class="live-badge">LIVE</span>
                <span class="marketplace-badge ${marketplaceClass}">${product.marketplace} ${product.isOfficial ? '✅ Official' : ''}</span>
                <div class="product-image-container">
                    ${product.image ? `<img src="${product.image}" alt="${product.name}" onerror="this.parentElement.innerHTML='<span class=\'product-image-placeholder\'>📦</span>'">` : '<span class="product-image-placeholder">📦</span>'}
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
    const banner = document.getElementById('bestDealBanner');
    const inStock = products.filter(p => p.inStock && p.price);
    if (inStock.length === 0) {
        banner.style.display = 'none';
        return;
    }

    // পরিসংখ্যান বের করা (সর্বোচ্চ রিভিউ, সর্বনিম্ন দাম, সর্বোচ্চ সোল্ড)
    const maxReview = Math.max(...inStock.map(p => p.reviewCount || 0));
    const minPrice = Math.min(...inStock.map(p => p.price));
    const maxSold = Math.max(...inStock.map(p => p.soldCount || 0));

    // স্কোরিং ফাংশন
    const getScore = (product) => {
        let score = 0;

        // রিভিউ স্কোর (সর্বোচ্চ 50 পয়েন্ট)
        if (maxReview > 0 && product.reviewCount) {
            score += (product.reviewCount / maxReview) * 50;
        }

        // দাম স্কোর (সর্বোচ্চ 30 পয়েন্ট) – দাম কম হলে বেশি স্কোর
        if (product.price && minPrice > 0) {
            score += (minPrice / product.price) * 30;
        }

        // ডিসকাউন্ট স্কোর (সর্বোচ্চ 15 পয়েন্ট)
        if (product.discount) {
            score += (product.discount / 100) * 15;
        }

        // সোল্ড স্কোর (সর্বোচ্চ 5 পয়েন্ট)
        if (maxSold > 0 && product.soldCount) {
            score += (product.soldCount / maxSold) * 5;
        }

        return score;
    };

    const bestDeal = inStock.reduce((best, current) => {
        return getScore(current) > getScore(best) ? current : best;
    });

    const savings = bestDeal.originalPrice ? bestDeal.originalPrice - bestDeal.price : 0;
    const savingsText = savings > 0 ? `Save ${formatPrice(savings)} (${bestDeal.discount}% off)` : 'Best available price!';

    // ব্যানার কন্টেন্ট (সেন্টার করা)
    banner.innerHTML = `
        <a href="${bestDeal.url || '#'}" target="_blank" style="display:flex; align-items:center; justify-content:center; gap:12px; text-decoration:none; color:white; width:100%; text-align:center;">
            <span class="best-deal-icon">🏆</span>
            <div class="best-deal-text" style="text-align:center;">
                <div class="best-deal-title">Best Deal Found!</div>
                <div class="best-deal-price">${formatPrice(bestDeal.price)} at ${bestDeal.marketplace}</div>
                <div class="best-deal-savings">${savingsText}</div>
                ${bestDeal.reviewCount ? `<div style="font-size:0.8rem; opacity:0.9;">⭐ ${bestDeal.rating ? bestDeal.rating.toFixed(1) : ''} (${bestDeal.reviewCount} reviews)${bestDeal.soldCount ? ` • 🔥 ${bestDeal.soldCount} sold` : ''}</div>` : ''}
            </div>
        </a>
    `;
    banner.style.display = 'flex';
    banner.style.justifyContent = 'center';
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
    // হোম সেকশন লুকানো (ডিল পেজে যাওয়ার সময়ও)
    document.getElementById('heroSection').style.display = 'none';
    document.getElementById('liveStatus').style.display = 'none';
    const storesSection = document.getElementById('stores-section');
    if (storesSection) storesSection.style.display = 'none';

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
