// ============ UTILITY FUNCTIONS ============

let notificationTimer;

function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    if (!notification) return;
    const labels = { success: 'Done', error: 'Error', info: 'Notice' };
    notification.setAttribute('role', 'status');
    notification.setAttribute('aria-live', 'polite');
    notification.textContent = `${labels[type] || labels.info}: ${message}`;
    notification.className = `notification ${type} show`;
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
        notification.classList.remove('show');
    }, 3200);
}

function formatPrice(price) {
    if (!price && price !== 0) return 'N/A';
    return '৳' + Number(price).toLocaleString('en-BD');
}

function getMarketplaceClass(marketplace) {
    return 'marketplace-' + marketplace.toLowerCase().replace(/[^a-z]/g, '');
}

function scrollToSearch() {
    const hero = document.getElementById('heroSection');
    if (hero) hero.scrollIntoView({ behavior: 'smooth' });
    const searchInput = document.getElementById('mainSearch');
    if (searchInput) searchInput.focus();
}

function quickSearch(query) {
    const input = document.getElementById('mainSearch');
    if (input) input.value = query;
    performSearch();
    setTimeout(() => {
        const results = document.getElementById('resultsSection');
        if (results) results.scrollIntoView({ behavior: 'smooth' });
    }, 300);
}

function calculateDiscount(price, originalPrice) {
    if (!originalPrice || !price || originalPrice <= price) return 0;
    return Math.round(((originalPrice - price) / originalPrice) * 100);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('Coupon copied: ' + text, 'success');
    }).catch(() => {
        showNotification('Failed to copy coupon', 'error');
    });
}

function refreshResults() {
    const query = document.getElementById('mainSearch')?.value.trim();
    if (query) {
        performSearch(true);
    } else {
        showDealsPage(true);
    }
}

function updateLastUpdated() {
    const el = document.getElementById('lastUpdated');
    if (!el) return;
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-BD', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    el.textContent = 'Last updated: ' + timeString;
}


// Escape untrusted text before inserting it into HTML.
function escapeHTML(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
