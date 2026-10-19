/* ==========================================================================
   Kiri Cars - Owner Control Center (Redesigned)
   Phase 1 + 2 + 3: UI foundation, new capabilities, operations scale
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut as firebaseSignOut,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, getDocs, query, where,
  orderBy, limit, startAfter, writeBatch, serverTimestamp, updateDoc,
  addDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCyNabsDhFxovmkbL7HwCXEmR8x14cpbRU",
  authDomain: "kiri-cars.firebaseapp.com",
  projectId: "kiri-cars",
  storageBucket: "kiri-cars.firebasestorage.app",
  messagingSenderId: "380481816413",
  appId: "1:380481816413:web:0764b7d2a229a7dc2b0ab4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let ownerUid = null;
let ownerProfile = null;
let editingOwnerCarId = null;
let currentPanel = 'overview';
let notifications = [];

const paginationState = {
  accounts: { lastDoc: null, pageSize: 15, hasMore: true, loading: false },
  sellers: { lastDoc: null, pageSize: 15, hasMore: true, loading: false },
  vehicles: { lastDoc: null, pageSize: 20, hasMore: true, loading: false },
  audit: { lastDoc: null, pageSize: 25, hasMore: true, loading: false },
};

const filters = {
  accounts: { search: '', type: 'all', status: 'all' },
  sellers: { search: '', status: 'all' },
  vehicles: { search: '', status: 'all' },
  audit: { search: '', action: 'all' },
};

const $ = (id) => document.getElementById(id);

function showToast(message, type = 'info', duration = 5000) {
  const container = $('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div class="toast-message"><span class="toast-title">${type === 'error' ? 'Error' : type === 'success' ? 'Success' : type === 'warning' ? 'Warning' : 'Notice'}</span> ${message}</div>
    <button class="toast-close" aria-label="Dismiss">✕</button>
  `;
  toast.querySelector('.toast-close').onclick = () => dismissToast(toast);
  container.appendChild(toast);
  setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  if (toast.parentElement) toast.parentElement.removeChild(toast);
}

function showDialog(title, message, onConfirm, onCancel, confirmLabel = 'Confirm') {
  const overlay = $('dialogOverlay');
  const titleEl = $('dialogTitle');
  const msgEl = $('dialogMessage');
  const confirmBtn = $('dialogConfirm');
  const cancelBtn = $('dialogCancel');
  const closeBtn = $('dialogClose');
  if (!overlay || !titleEl || !msgEl || !confirmBtn || !cancelBtn || !closeBtn) {
    console.error('Dialog elements missing from DOM');
    return;
  }
  titleEl.textContent = title;
  msgEl.textContent = message;
  confirmBtn.textContent = confirmLabel;
  const cleanup = () => {
    if (overlay) overlay.hidden = true;
    if (confirmBtn) confirmBtn.onclick = null;
    if (cancelBtn) cancelBtn.onclick = null;
    if (closeBtn) closeBtn.onclick = null;
  };
  confirmBtn.onclick = (e) => { e.preventDefault(); cleanup(); if (onConfirm) onConfirm(); };
  cancelBtn.onclick = (e) => { e.preventDefault(); cleanup(); if (onCancel) onCancel(); };
  closeBtn.onclick = (e) => { e.preventDefault(); cleanup(); if (onCancel) onCancel(); };
  overlay.hidden = false;
}

async function writeAuditLog(action, targetType, targetId, targetLabel, metadata = {}) {
  if (!ownerUid) return;
  try {
    await addDoc(collection(db, 'auditLog'), {
      action, actorId: ownerUid,
      actorName: ownerProfile ? (ownerProfile.name || ownerProfile.email) : 'Owner',
      targetType, targetId, targetLabel, metadata,
      createdAt: serverTimestamp()
    });
  } catch (e) { console.error('Audit log write failed:', e); }
}

function formatDate(ts) {
  if (!ts) return 'Not recorded';
  try { return typeof ts.toDate === 'function' ? ts.toDate().toLocaleString() : new Date(ts).toLocaleString(); } catch (e) { return 'Invalid date'; }
}

function formatMoney(value) {
  try { return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(value || 0)); } catch (e) { return 'KES 0'; }
}

function escapeHtml(text) {
  const div = document.createElement('div'); div.textContent = text; return div.innerHTML;
}

function normalizeKenyanPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) digits = '254' + digits.slice(1);
  else if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) digits = '254' + digits;
  return /^254[17]\d{8}$/.test(digits) ? digits : '';
}
// ============================================================================
// Navigation & Shell
// ============================================================================
function setupNavigation() {
  const sidebar = $('ownerSidebar');
  const main = $('ownerMain');
  const toggleBtn = $('toggleSidebar');
  const backdrop = $('ownerSidebarBackdrop');
  const sidebarLogout = $('sidebarLogout');

  const setSidebarOpen = (isOpen) => {
    sidebar.classList.toggle('open', isOpen);
    main.classList.toggle('sidebar-open', isOpen);
    toggleBtn?.setAttribute('aria-expanded', String(isOpen));
    if (backdrop) backdrop.hidden = !isOpen;
  };

  toggleBtn?.addEventListener('click', () => {
    setSidebarOpen(!sidebar.classList.contains('open'));
  });
  $('closeSidebar')?.addEventListener('click', () => setSidebarOpen(false));
  backdrop?.addEventListener('click', () => setSidebarOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar.classList.contains('open')) setSidebarOpen(false);
  });
  const syncSidebarWithViewport = () => setSidebarOpen(window.innerWidth > 768);
  window.addEventListener('resize', syncSidebarWithViewport);
  syncSidebarWithViewport();

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const panel = item.getAttribute('data-panel');
      if (panel) switchPanel(panel);
      if (window.innerWidth <= 768) {
        setSidebarOpen(false);
      }
    });
  });

  document.querySelectorAll('.quick-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.getAttribute('data-panel');
      if (panel) switchPanel(panel);
    });
  });

  const globalSearch = $('globalSearch');
  const clearSearch = $('clearSearch');
  if (globalSearch) {
    let debounceTimer;
    globalSearch.addEventListener('input', (e) => {
      clearSearch.hidden = !e.target.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => applyGlobalSearch(e.target.value), 300);
    });
    clearSearch?.addEventListener('click', () => {
      globalSearch.value = ''; clearSearch.hidden = true; applyGlobalSearch('');
    });
  }

  const profileBtn = $('profileBtn');
  const dropdownMenu = $('dropdownMenu');
  if (profileBtn) {
    profileBtn.addEventListener('click', (e) => { e.stopPropagation(); dropdownMenu.hidden = !dropdownMenu.hidden; });
    document.addEventListener('click', (e) => {
      if (!profileBtn.contains(e.target) && !dropdownMenu.contains(e.target)) dropdownMenu.hidden = true;
    });
  }

  $('dropdownSignOut')?.addEventListener('click', () => { dropdownMenu.hidden = true; handleSignOut(); });
  $('dropdownSettings')?.addEventListener('click', () => { dropdownMenu.hidden = true; switchPanel('settings'); });
  $('dropdownViewProfile')?.addEventListener('click', () => { dropdownMenu.hidden = true; showOwnerProfileDetail(); });
  sidebarLogout?.addEventListener('click', handleSignOut);
}

function switchPanel(panelName) {
  if (panelName === 'my-cars') {
    window.location.assign('admin.html');
    return;
  }

  document.querySelectorAll('.owner-panel').forEach(p => { p.hidden = true; p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(n => { n.classList.remove('active'); n.setAttribute('aria-selected', 'false'); });
  const activeNav = document.querySelector(`.nav-item[data-panel="${panelName}"]`);
  if (activeNav) { activeNav.classList.add('active'); activeNav.setAttribute('aria-selected', 'true'); }
  const panel = $(`owner-panel-${panelName}`);
  if (panel) { panel.hidden = false; panel.classList.add('active'); currentPanel = panelName; }
  const titles = {
    overview: 'Marketplace Overview', accounts: 'Account Management',
    sellers: 'Seller Approvals', vehicles: 'Vehicle Listings',
    'my-cars': 'My Listings', payments: 'Listing Payments',
    revenue: 'Revenue Dashboard', 'audit-log': 'Audit Log',
    moderation: 'Listing Moderation', settings: 'Owner Settings',
  };
  const subtitles = {
    overview: 'Your key account totals and the latest registrations.',
    accounts: 'View team accounts and control access. Your owner account is protected.',
    sellers: 'Review showroom representatives and independent sales representatives.',
    vehicles: 'Review marketplace inventory and maintain public listing privacy.',
    'my-cars': 'Vehicles you have added as the owner.',
    payments: 'Review pending listing payments, renewals, and expired listings.',
    revenue: 'Listing fees collected, pending payments, and overdue listings.',
    'audit-log': 'Immutable record of owner actions.',
    moderation: 'Review flagged or reported vehicle listings.',
    settings: 'Manage your owner profile, password, and active sessions.',
  };
  $('pageTitle').textContent = titles[panelName] || 'Owner Control Center';
  $('pageSubtitle').textContent = subtitles[panelName] || '';
  const currentView = $('ownerHeaderCurrentView');
  if (currentView) currentView.textContent = panelName === 'overview' ? 'Home' : (titles[panelName] || 'Owner Control Center');
  const gs = $('globalSearch'); if (gs) { gs.value = ''; $('clearSearch').hidden = true; }
  loadPanelData(panelName);
}

function loadPanelData(panelName) {
  switch (panelName) {
    case 'overview': loadOverview(); break;
    case 'accounts': loadAccountStats(); resetAccountPagination(); loadBuyerAccountsPage(); loadAdminsPage(); break;
    case 'sellers': resetSellerPagination(); loadSellerApplicationsPage(); break;
    case 'vehicles': loadCarCount(); loadVehiclesPage(); break;
    case 'my-cars': loadOwnerCars(); break;
    case 'payments': loadListingPayments(); break;
    case 'revenue': loadRevenueDashboard(); break;
    case 'audit-log': resetAuditPagination(); loadAuditLogPage(); break;
    case 'moderation': loadModerationQueue(); break;
    case 'settings': loadOwnerSettings(); break;
  }
}

function applyGlobalSearch(term) {
  // Global search highlights on current panel - implemented per-panel below
  console.log('Global search:', term);
}
// ============================================================================
// Owner Auth Gate
// ============================================================================
async function requireOwner(user) {
  if (!user) { window.location.replace('login.html'); return false; }
  const profileRef = doc(db, 'admins', user.uid);
  const profileSnap = await getDoc(profileRef);
  if (!profileSnap.exists()) {
    await firebaseSignOut(auth);
    window.location.replace('login.html'); return false;
  }
  const profile = profileSnap.data();
  if (profile.active !== true || String(profile.role || '').trim().toLowerCase() !== 'owner') {
    await firebaseSignOut(auth);
    window.location.replace('login.html'); return false;
  }
  ownerUid = user.uid;
  ownerProfile = profile;
  $('ownerAvatar').textContent = (profile.name || profile.email || 'O').charAt(0).toUpperCase();
  $('dropdownName').textContent = profile.name || 'Owner';
  $('dropdownEmail').textContent = profile.email || '';
  showToast('Signed in as ' + (profile.name || user.email) + '.', 'success', 3000);
  return true;
}

async function handleSignOut() {
  showDialog('Sign Out', 'Are you sure you want to sign out of the Owner Control Center?', async () => {
    try {
      await writeAuditLog('owner_sign_out', 'owner', ownerUid, 'Owner signed out');
      await firebaseSignOut(auth);
      window.location.replace('login.html');
    } catch (e) {
      showToast('Sign out failed: ' + (e.message || e.code), 'error');
    }
  });
}
// ============================================================================
// Overview Panel
// ============================================================================
async function loadOverview() {
  await loadAccountStats();
  await loadCarCount();
}

async function loadAccountStats() {
  const msg = $('accountStatsMessage');
  const recentList = $('recentAccountsList');
  msg.textContent = 'Loading account statistics...';
  recentList.textContent = 'Loading recent registrations...';
  try {
    const [buyersSnap, adminsSnap] = await Promise.all([
      getDocs(collection(db, 'buyers')),
      getDocs(collection(db, 'admins'))
    ]);
    const buyers = buyersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const dealers = adminsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(d => {
        const r = String(d.role || '').trim().toLowerCase();
        return r === 'admin' || r === 'dealer';
      });

    const activeCount = dealers.filter(d => d.active === true).length;
    $('totalBuyerAccounts').textContent = buyers.length;
    $('totalDealerAccounts').textContent = dealers.length;
    $('activeDealerAccounts').textContent = activeCount;
    $('inactiveDealerAccounts').textContent = dealers.length - activeCount;

    const recent = [
      ...buyers.map(account => ({ ...account, type: 'Buyer' })),
      ...dealers.map(account => ({ ...account, type: 'Dealer' }))
    ].map(account => ({
      name: account.name || 'Unnamed',
      email: account.email || 'No email',
      type: account.type,
      active: account.active,
      createdAt: account.createdAt || null
    })).sort((a, b) => {
      const at = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
      const bt = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
      return bt - at;
    }).slice(0, 10);

    recentList.replaceChildren();
    if (recent.length === 0) {
      recentList.textContent = 'No buyer or dealer accounts found.';
    } else {
      recent.forEach(acc => {
        const row = document.createElement('div');
        row.className = 'admin-list-item';
        row.innerHTML = `
          <strong>${escapeHtml(acc.name)}</strong>
          <p>${escapeHtml(acc.email)}</p>
          <p>${acc.type} | ${acc.active === true ? 'Active' : 'Inactive'} | ${formatDate(acc.createdAt)}</p>
        `;
        recentList.appendChild(row);
      });
    }
    msg.textContent = 'Account statistics updated.';
    msg.style.color = '#167a35';
  } catch (e) {
    console.error('Account statistics error:', e);
    msg.textContent = 'Could not load account statistics.';
    msg.style.color = '#c62828';
    recentList.textContent = 'Recent registrations could not be loaded.';
  }
}

async function loadCarCount() {
  try {
    const snap = await getDocs(collection(db, 'cars'));
    $('carCount').textContent = 'Total vehicle listings: ' + snap.size;
  } catch (e) {
    $('carCount').textContent = 'Could not load vehicle count.';
    console.error('Car count error:', e);
  }
}
// ============================================================================
// Account Management
// ============================================================================
function resetAccountPagination() {
  paginationState.accounts = { lastDoc: null, pageSize: 15, hasMore: true, loading: false };
  $('buyerAccountsList').replaceChildren();
  $('managedAdminsList').replaceChildren();
  $('adminsList').replaceChildren();
  $('accountsPagination').hidden = true;
}

let allBuyersCache = [];
let allAdminsCache = [];

async function loadBuyerAccountsPage() {
  const list = $('buyerAccountsList');
  list.replaceChildren();
  list.textContent = 'Loading buyer accounts...';
  try {
    const snap = await getDocs(collection(db, 'buyers'));
    allBuyersCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBuyerAccounts(allBuyersCache);
  } catch (e) {
    list.textContent = 'Could not load buyer accounts.';
    console.error('Buyer accounts error:', e);
  }
}

function renderBuyerAccounts(buyers) {
  const list = $('buyerAccountsList');
  list.replaceChildren();
  let filtered = buyers.filter(b => {
    const term = filters.accounts.search.toLowerCase();
    const matchSearch = !term || String(b.name || '').toLowerCase().includes(term) || String(b.email || '').toLowerCase().includes(term);
    const matchType = filters.accounts.type === 'all' || filters.accounts.type === 'buyer';
    return matchSearch && matchType;
  });
  if (filtered.length === 0) { list.textContent = 'No matching buyer accounts.'; return; }
  filtered.forEach(b => {
    const item = document.createElement('div');
    item.className = 'account-item';
    item.innerHTML = `
      <strong>${escapeHtml(b.name || 'Unnamed buyer')}</strong>
      <p>${escapeHtml(b.email || 'No email')}</p>
      <p>Buyer | ${formatDate(b.createdAt)}</p>
      <div class="account-actions">
        <button class="btn btn-sm btn-outline" onclick="viewAccountDetail('buyer', '${b.id}', '${escapeHtml(b.name || '')}', '${escapeHtml(b.email || '')}')">View</button>
      </div>
    `;
    list.appendChild(item);
  });
}
async function loadAdminsPage() {
  const list = $('adminsList');
  list.replaceChildren();
  list.textContent = 'Loading administrator accounts...';
  try {
    const snap = await getDocs(collection(db, 'admins'));
    allAdminsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(d => { const r = String(d.role || '').trim().toLowerCase(); return r === 'admin' || r === 'dealer'; });
    renderAdmins(allAdminsCache);
  } catch (e) {
    list.textContent = 'Could not load accounts.';
    console.error('Load admins error:', e);
  }
}

function renderAdmins(admins) {
  const list = $('adminsList');
  const managed = $('managedAdminsList');
  list.replaceChildren(); managed.replaceChildren();
  let filtered = admins.filter(a => {
    const term = filters.accounts.search.toLowerCase();
    const matchSearch = !term || String(a.name || '').toLowerCase().includes(term) || String(a.email || '').toLowerCase().includes(term);
    let matchType = true;
    if (filters.accounts.type === 'dealer') matchType = String(a.role || '').toLowerCase() === 'dealer';
    if (filters.accounts.type === 'admin') matchType = String(a.role || '').toLowerCase() === 'admin';
    if (filters.accounts.type === 'owner') matchType = String(a.role || '').toLowerCase() === 'owner';
    const st = filters.accounts.status;
    let matchStatus = true;
    if (st === 'active') matchStatus = a.active === true;
    if (st === 'inactive') matchStatus = a.active !== true;
    return matchSearch && matchType && matchStatus;
  });
  if (filtered.length === 0) { list.textContent = 'No matching accounts.'; return; }
  filtered.forEach(a => {
    const roleLabel = String(a.role || 'dealer').toLowerCase() === 'dealer' ? 'Dealer' : 'Administrator';
    const item = document.createElement('div');
    item.className = 'account-item';
    const isOwner = String(a.role || '').toLowerCase() === 'owner';
    item.innerHTML = `
      <strong>${escapeHtml(a.name || 'Unnamed account')}</strong>
      <p>${escapeHtml(a.email || 'No email')} · ${escapeHtml(a.whatsapp || 'WhatsApp not provided')}</p>
      <p>${roleLabel} | ${a.active === true ? 'Active' : 'Inactive'} | ${formatDate(a.createdAt)}</p>
      <div class="account-actions">
        ${!isOwner ? `
          <button class="btn btn-sm ${a.active === true ? 'btn-outline text-danger' : 'btn-outline'}" onclick="toggleAccountActive('${a.id}', ${a.active === true}, '${escapeHtml(a.name || '')}')">
            ${a.active === true ? 'Suspend' : 'Reactivate'}
          </button>
        ` : '<button class="btn btn-sm btn-outline" disabled>Owner</button>'}
        <button class="btn btn-sm btn-outline" onclick="viewAccountDetail('admin', '${a.id}', '${escapeHtml(a.name || '')}', '${escapeHtml(a.email || '')}', '${escapeHtml(a.whatsapp || '')}', '${escapeHtml(a.role || '')}')">View</button>
      </div>
    `;
    list.appendChild(item);
    if (!isOwner) managed.appendChild(item.cloneNode(true));
  });
}
window.toggleAccountActive = async (id, currentlyActive, name) => {
  const action = currentlyActive ? 'suspend' : 'reactivate';
  showDialog(
    currentlyActive ? 'Suspend Account' : 'Reactivate Account',
    `Are you sure you want to ${currentlyActive ? 'suspend' : 'reactivate'} access for "${name}"?`,
    async () => {
      try {
        await updateDoc(doc(db, 'admins', id), { active: !currentlyActive, accessUpdatedAt: serverTimestamp(), accessUpdatedBy: ownerUid });
        await writeAuditLog(currentlyActive ? 'account_suspended' : 'account_reactivated', 'admin', id, name, { previousActive: currentlyActive });
        showToast(`Account ${currentlyActive ? 'suspended' : 'reactivated'} successfully.`, 'success');
        loadAdminsPage(); loadAccountStats();
      } catch (e) {
        showToast('Could not update account: ' + (e.message || e.code), 'error');
      }
    }
  );
};

window.viewAccountDetail = (type, id, name, email, whatsapp, role) => {
  const content = document.createElement('div');
  content.innerHTML = `
    <h3 style="margin-top:0">Account Details</h3>
    <p><strong>Type:</strong> ${type === 'buyer' ? 'Buyer' : role || 'Administrator'}</p>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    ${whatsapp ? `<p><strong>WhatsApp:</strong> ${whatsapp}</p>` : ''}
    <p><strong>ID:</strong> ${id}</p>
  `;
  $('detailContent').replaceChildren(content);
  $('detailOverlay').hidden = false;
};

$('closeDetail')?.addEventListener('click', () => { $('detailOverlay').hidden = true; });
$('detailOverlay')?.addEventListener('click', (e) => { if (e.target === $('detailOverlay')) $('detailOverlay').hidden = true; });

$('accountSearch')?.addEventListener('input', (e) => {
  filters.accounts.search = e.target.value.toLowerCase();
  renderBuyerAccounts(allBuyersCache); renderAdmins(allAdminsCache);
});
$('accountTypeFilter')?.addEventListener('change', (e) => {
  filters.accounts.type = e.target.value;
  renderBuyerAccounts(allBuyersCache); renderAdmins(allAdminsCache);
});
$('accountStatusFilter')?.addEventListener('change', (e) => {
  filters.accounts.status = e.target.value;
  renderAdmins(allAdminsCache);
});
$('clearAccountFilters')?.addEventListener('click', () => {
  filters.accounts = { search: '', type: 'all', status: 'all' };
  $('accountSearch').value = ''; $('accountTypeFilter').value = 'all'; $('accountStatusFilter').value = 'all';
  renderBuyerAccounts(allBuyersCache); renderAdmins(allAdminsCache);
});

// ============================================================================
// Owner Profile Detail
// ============================================================================
window.showOwnerProfileDetail = () => {
  if (!ownerProfile || !ownerUid) return;
  const content = document.createElement('div');
  content.innerHTML = `
    <h3 style="margin-top:0">Owner Profile</h3>
    <p><strong>Name:</strong> ${escapeHtml(ownerProfile.name || 'Owner')}</p>
    <p><strong>Email:</strong> ${escapeHtml(ownerProfile.email || 'Not provided')}</p>
    ${ownerProfile.whatsapp ? `<p><strong>WhatsApp:</strong> ${escapeHtml(ownerProfile.whatsapp)}</p>` : ''}
    <p><strong>Role:</strong> ${escapeHtml(String(ownerProfile.role || 'owner')).charAt(0).toUpperCase() + String(ownerProfile.role || 'owner').slice(1)}</p>
    <p><strong>Account ID:</strong> ${ownerUid}</p>
    <p><strong>Status:</strong> ${ownerProfile.active === false ? 'Inactive' : 'Active'}</p>
    ${ownerProfile.createdAt ? `<p><strong>Joined:</strong> ${formatDate(ownerProfile.createdAt)}</p>` : ''}
    ${ownerProfile.updatedAt ? `<p><strong>Last updated:</strong> ${formatDate(ownerProfile.updatedAt)}</p>` : ''}
  `;
  $('detailContent').replaceChildren(content);
  $('detailOverlay').hidden = false;
};

$('promoteOwnerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('promoteOwnerEmail').value.trim().toLowerCase();
  if (!email) return;
  const btn = $('promoteOwnerButton'); btn.disabled = true;
  $('promoteOwnerMessage').textContent = 'Looking up the registered account...';
  try {
    const snap = await getDocs(collection(db, 'admins'));
    const matches = snap.docs.filter(d => String(d.data().email || '').trim().toLowerCase() === email);
    if (matches.length !== 1) {
      $('promoteOwnerMessage').textContent = matches.length === 0 ? 'No registered account matches that email.' : 'Multiple profiles match. Resolve duplicates first.';
      $('promoteOwnerMessage').style.color = '#c62828'; return;
    }
    const account = matches[0]; const profile = account.data();
    if (String(profile.role || '').toLowerCase() === 'owner' && profile.active === true) {
      $('promoteOwnerMessage').textContent = 'This account already has active owner access.';
      $('promoteOwnerMessage').style.color = '#167a35'; return;
    }
    showDialog('Grant Owner Access', `Grant full owner access to "${profile.name || email}" (${email})?`, async () => {
      try {
        await updateDoc(doc(db, 'admins', account.id), {
          role: 'owner', active: true, accountStatus: 'active',
          accessUpdatedAt: serverTimestamp(), accessUpdatedBy: ownerUid
        });
        await writeAuditLog('owner_promoted', 'admin', account.id, profile.name || email, { email });
        $('promoteOwnerMessage').textContent = email + ' now has owner access.';
        $('promoteOwnerMessage').style.color = '#167a35';
        $('promoteOwnerForm').reset();
        await Promise.all([loadAdminsPage(), loadAccountStats()]);
      } catch (err) {
        $('promoteOwnerMessage').textContent = 'Could not grant owner access: ' + (err.code || err.message);
        $('promoteOwnerMessage').style.color = '#c62828';
      } finally { btn.disabled = false; }
    });
  } catch (e) {
    $('promoteOwnerMessage').textContent = 'Could not grant owner access: ' + (e.code || e.message);
    $('promoteOwnerMessage').style.color = '#c62828';
    btn.disabled = false;
  }
});
// ============================================================================
// Seller Approvals
// ============================================================================
function resetSellerPagination() {
  paginationState.sellers = { lastDoc: null, pageSize: 15, hasMore: true, loading: false };
  $('sellerApplicationsList').replaceChildren();
}

let allSellersCache = [];

async function loadSellerApplicationsPage() {
  const list = $('sellerApplicationsList');
  list.replaceChildren();
  list.textContent = 'Loading seller applications...';
  $('sellerApplicationsMessage').textContent = 'Loading seller applications...';
  try {
    const snap = await getDocs(collection(db, 'admins'));
    allSellersCache = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(d => String(d.role || '').toLowerCase() === 'dealer')
      .sort((a, b) => {
        const rank = { pending: 0, rejected: 1, suspended: 2, approved: 3 };
        return (rank[a.approvalStatus || 'pending'] ?? 4) - (rank[b.approvalStatus || 'pending'] ?? 4);
      });
    renderSellers(allSellersCache);
    $('sellerApplicationsMessage').textContent = 'Seller applications updated.';
  } catch (e) {
    list.textContent = 'Could not load seller applications.';
    $('sellerApplicationsMessage').textContent = 'Could not load seller applications.';
    console.error('Seller applications error:', e);
  }
}

function renderSellers(sellers) {
  const list = $('sellerApplicationsList');
  list.replaceChildren();
  let filtered = sellers.filter(s => {
    const term = filters.sellers.search.toLowerCase();
    const matchSearch = !term || String(s.name || '').toLowerCase().includes(term) || String(s.email || '').toLowerCase().includes(term) || String(s.businessName || '').toLowerCase().includes(term);
    const matchStatus = filters.sellers.status === 'all' || String(s.approvalStatus || 'pending') === filters.sellers.status;
    return matchSearch && matchStatus;
  });
  if (filtered.length === 0) { list.textContent = 'No matching seller applications.'; return; }
  filtered.forEach(seller => {
    const row = document.createElement('article');
    row.className = 'admin-list-item';
    const status = seller.approvalStatus || 'pending';
    const statusClass = status === 'pending' ? 'status-pending' : status === 'approved' ? 'status-approved' : status === 'rejected' ? 'status-rejected' : 'status-suspended';
    row.innerHTML = `
      <strong>${escapeHtml(seller.name || 'Unnamed seller')}</strong>
      <p>${escapeHtml(seller.sellerType === 'broker' ? 'Independent Sales Representative' : 'Showroom Representative')}${seller.businessName ? ' · ' + escapeHtml(seller.businessName) : ''} · ${escapeHtml(seller.email || 'No email')}</p>
      <p>WhatsApp: ${escapeHtml(seller.whatsapp || 'Not provided')}</p>
      <p class="${statusClass}">Approval: ${escapeHtml(status)} · Account active: ${seller.active === true ? 'Yes' : 'No'}</p>
      <div class="seller-verification-checklist">
        ${renderChecklistItem('identityChecked', 'Identity checked', seller)}
        ${renderChecklistItem('phoneConfirmed', 'Phone/contact independently confirmed', seller)}
        ${renderChecklistItem('sellerAuthorityChecked', 'Permission to market vehicles checked', seller)}
        ${seller.sellerType === 'dealership' ? renderChecklistItem('businessDetailsChecked', 'Showroom/business details checked', seller) : ''}
        <p style="margin:8px 0 0;font-size:0.75rem;color:var(--text-secondary);font-style:italic">Complete these checks before approval. Do not upload identity documents into this checklist.</p>
      </div>
      <div class="seller-review-actions">
        ${renderSellerActionButton(seller)}
      </div>
    `;
    list.appendChild(row);
  });
}

function renderChecklistItem(key, label, seller) {
  const checked = seller.verificationChecks && seller.verificationChecks[key] === true ? 'checked' : '';
  return `<label><input type="checkbox" ${checked} disabled> ${escapeHtml(label)}</label>`;
}

function renderSellerActionButton(seller) {
  const status = seller.approvalStatus || 'pending';
  if (status === 'pending') {
    return `
      <button class="btn btn-sm btn-outline" onclick="approveSeller('${seller.id}', '${escapeHtml(seller.name || '')}')">Approve</button>
      <button class="btn btn-sm btn-outline text-danger" onclick="rejectSeller('${seller.id}', '${escapeHtml(seller.name || '')}')">Reject</button>
      <button class="btn btn-sm btn-outline text-danger" onclick="suspendSeller('${seller.id}', '${escapeHtml(seller.name || '')}')">Suspend</button>
    `;
  }
  if (status === 'approved') {
    const phone = normalizeKenyanPhone(seller.whatsapp);
    const notifyButton = phone
      ? `<button class="btn btn-sm btn-outline" onclick="notifySellerWhatsApp('${seller.id}')">Notify on WhatsApp</button>`
      : '<span class="account-muted">No valid WhatsApp number saved</span>';
    return `
      ${notifyButton}
      <button class="btn btn-sm btn-outline text-danger" onclick="suspendSeller('${seller.id}', '${escapeHtml(seller.name || '')}')">Suspend</button>
    `;
  }
  if (status === 'suspended') {
    return `<button class="btn btn-sm btn-outline" onclick="reactivateSeller('${seller.id}', '${escapeHtml(seller.name || '')}')">Reactivate</button>`;
  }
  return `<button class="btn btn-sm btn-outline" onclick="approveSeller('${seller.id}', '${escapeHtml(seller.name || '')}')">Approve</button>`;
}

window.notifySellerWhatsApp = (id) => {
  const seller = allSellersCache.find((item) => item.id === id);
  if (!seller) {
    showToast('Could not find this seller. Refresh Seller Applications and try again.', 'error');
    return;
  }

  const phone = normalizeKenyanPhone(seller.whatsapp);
  if (!phone) {
    showToast('This seller does not have a valid Kenyan WhatsApp number saved.', 'error');
    return;
  }

  const dealerName = String(seller.name || 'there').trim();
  const message = `Hello ${dealerName}, 🎉

Your Kiri Cars dealer account has been approved. You can now sign in at https://kiricars.co.ke and start listing your vehicles.

Welcome to Kiri Cars — helping connect Kenyan car sellers with serious buyers. 🚗`;
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  // Open WhatsApp only after the owner clicks. The owner must press Send in WhatsApp.
  window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
};

window.approveSeller = async (id, name) => {
  showDialog('Approve Seller', `Approve "${name}" as a verified seller? They will be able to publish vehicle listings.`, async () => {
    try {
      await updateDoc(doc(db, 'admins', id), {
        approvalStatus: 'approved', active: true, approvalUpdatedAt: serverTimestamp(), approvalUpdatedBy: ownerUid
      });
      await writeAuditLog('seller_approved', 'admin', id, name);
      showToast(`Seller "${name}" approved.`, 'success');
      loadSellerApplicationsPage();
    } catch (e) {
      showToast('Could not approve seller: ' + (e.message || e.code), 'error');
    }
  });
};

window.rejectSeller = async (id, name) => {
  showDialog('Reject Seller', `Reject "${name}"'s seller application? They will not be able to publish listings.`, async () => {
    try {
      await updateDoc(doc(db, 'admins', id), {
        approvalStatus: 'rejected', active: false, approvalUpdatedAt: serverTimestamp(), approvalUpdatedBy: ownerUid
      });
      await writeAuditLog('seller_rejected', 'admin', id, name);
      showToast(`Seller "${name}" rejected.`, 'success');
      loadSellerApplicationsPage();
    } catch (e) {
      showToast('Could not reject seller: ' + (e.message || e.code), 'error');
    }
  });
};

window.suspendSeller = async (id, name) => {
  showDialog('Suspend Seller', `Suspend "${name}"? Their listings will be hidden from buyers.`, async () => {
    try {
      await updateDoc(doc(db, 'admins', id), {
        approvalStatus: 'suspended', active: false, approvalUpdatedAt: serverTimestamp(), approvalUpdatedBy: ownerUid
      });
      await writeAuditLog('seller_suspended', 'admin', id, name);
      showToast(`Seller "${name}" suspended.`, 'success');
      loadSellerApplicationsPage();
    } catch (e) {
      showToast('Could not suspend seller: ' + (e.message || e.code), 'error');
    }
  });
};

window.reactivateSeller = async (id, name) => {
  showDialog('Reactivate Seller', `Reactivate "${name}"? They can publish listings again (pending approval status).`, async () => {
    try {
      await updateDoc(doc(db, 'admins', id), {
        active: true, approvalUpdatedAt: serverTimestamp(), approvalUpdatedBy: ownerUid
      });
      await writeAuditLog('account_reactivated', 'admin', id, name);
      showToast(`Seller "${name}" reactivated.`, 'success');
      loadSellerApplicationsPage();
    } catch (e) {
      showToast('Could not reactivate seller: ' + (e.message || e.code), 'error');
    }
  });
};

$('sellerSearch')?.addEventListener('input', (e) => {
  filters.sellers.search = e.target.value.toLowerCase();
  renderSellers(allSellersCache);
});
$('sellerStatusFilter')?.addEventListener('change', (e) => {
  filters.sellers.status = e.target.value;
  renderSellers(allSellersCache);
});
$('clearSellerFilters')?.addEventListener('click', () => {
  filters.sellers = { search: '', status: 'all' };
  $('sellerSearch').value = ''; $('sellerStatusFilter').value = 'all';
  renderSellers(allSellersCache);
});
$('loadSellerApplicationsButton')?.addEventListener('click', loadSellerApplicationsPage);
// ============================================================================
// Vehicle Listings
// ============================================================================
let allVehiclesCache = [];

async function loadVehiclesPage() {
  const list = $('myOwnerCars'); // placeholder, we render inline
  try {
    const snap = await getDocs(collection(db, 'cars'));
    allVehiclesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderVehicles(allVehiclesCache);
  } catch (e) {
    console.error('Load vehicles error:', e);
  }
}

function renderVehicles(vehicles) {
  // Render in the vehicles panel area
  let container = $('vehiclesListContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'vehiclesListContainer';
    const panel = $('owner-panel-vehicles');
    if (panel) panel.appendChild(container);
  }
  container.replaceChildren();
  let filtered = vehicles.filter(v => {
    const term = filters.vehicles.search.toLowerCase();
    const matchSearch = !term || String(v.manufacturer || '').toLowerCase().includes(term) || String(v.model || '').toLowerCase().includes(term) || String(v.addedBy || '').toLowerCase().includes(term);
    const matchStatus = filters.vehicles.status === 'all' || String(v.listingStatus || 'active') === filters.vehicles.status;
    return matchSearch && matchStatus;
  });
  if (filtered.length === 0) { container.textContent = 'No matching vehicle listings.'; return; }
  filtered.forEach(car => {
    const card = document.createElement('div');
    card.className = 'admin-list-item';
    card.innerHTML = `
      <strong>${escapeHtml(car.manufacturer || '')} ${escapeHtml(car.model || '')}</strong>
      <p>${escapeHtml(car.year || '')} · ${escapeHtml(car.price ? formatMoney(car.price) : 'Price not set')} · ${escapeHtml(car.status || 'Fresh Import')}</p>
      <p>Listing: ${escapeHtml(car.listingStatus || 'legacy')} · Payment: ${escapeHtml(car.paymentStatus || 'not recorded')}</p>
    `;
    const actions = document.createElement('div');
    actions.className = 'account-actions';
    const viewButton = document.createElement('button');
    viewButton.type = 'button';
    viewButton.className = 'btn btn-sm btn-outline';
    viewButton.textContent = 'View';
    viewButton.addEventListener('click', () => window.viewVehicleDetail(car.id));
    actions.appendChild(viewButton);
    if (car.addedBy === ownerUid) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'btn btn-sm btn-outline';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => window.openOwnerCarEdit(car));
      actions.appendChild(editButton);
    }
    card.appendChild(actions);
    container.appendChild(card);
  });
}

$('vehicleSearch')?.addEventListener('input', (e) => {
  filters.vehicles.search = e.target.value.toLowerCase();
  renderVehicles(allVehiclesCache);
});
$('vehicleStatusFilter')?.addEventListener('change', (e) => {
  filters.vehicles.status = e.target.value;
  renderVehicles(allVehiclesCache);
});
$('clearVehicleFilters')?.addEventListener('click', () => {
  filters.vehicles = { search: '', status: 'all' };
  $('vehicleSearch').value = ''; $('vehicleStatusFilter').value = 'all';
  renderVehicles(allVehiclesCache);
});

window.viewVehicleDetail = (id) => {
  const car = allVehiclesCache.find(c => c.id === id);
  if (!car) return;
  const content = document.createElement('div');
  content.innerHTML = `
    <h3 style="margin-top:0">Listing Details</h3>
    <p><strong>Make:</strong> ${escapeHtml(car.manufacturer || '')}</p>
    <p><strong>Model:</strong> ${escapeHtml(car.model || '')}</p>
    <p><strong>Year:</strong> ${escapeHtml(car.year || '')}</p>
    <p><strong>Price:</strong> ${formatMoney(car.price)}</p>
    <p><strong>Status:</strong> ${escapeHtml(car.status || '')}</p>
    <p><strong>Listing:</strong> ${escapeHtml(car.listingStatus || 'legacy')}</p>
    <p><strong>Payment:</strong> ${escapeHtml(car.paymentStatus || 'not recorded')}</p>
    <p><strong>Seller ID:</strong> ${escapeHtml(car.addedBy || '')}</p>
    <p><strong>Listing ID:</strong> ${id}</p>
  `;
  $('detailContent').replaceChildren(content);
  $('detailOverlay').hidden = false;
};

// ============================================================================
// My Listings
// ============================================================================
async function loadOwnerCars() {
  const container = $('myOwnerCars');
  if (!container) return;
  container.replaceChildren();
  container.textContent = 'Loading your listings...';
  if (!ownerUid) { container.textContent = 'No owner session.'; return; }
  try {
    const q = query(collection(db, 'cars'), where('addedBy', '==', ownerUid));
    const snap = await getDocs(q);
    if (snap.empty) { container.textContent = 'You have not added any vehicle listings.'; return; }
    container.replaceChildren();
    snap.forEach(docSnap => {
      const car = docSnap.data();
      const card = document.createElement('div');
      card.className = 'admin-list-item';
      card.innerHTML = `
        <strong>${escapeHtml(car.manufacturer || '')} ${escapeHtml(car.model || '')}</strong>
        <p>${escapeHtml(car.year || '')} · ${formatMoney(car.price)} · ${escapeHtml(car.status || 'Fresh Import')}</p>
        <p>Listing: ${escapeHtml(car.listingStatus || 'legacy')} · Payment: ${escapeHtml(car.paymentStatus || 'not recorded')}</p>
      `;
      const actions = document.createElement('div');
      actions.className = 'account-actions';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'btn btn-sm btn-outline';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => window.openOwnerCarEdit({ id: docSnap.id, ...car }));
      actions.appendChild(editButton);
      card.appendChild(actions);
      container.appendChild(card);
    });
  } catch (e) {
    container.textContent = 'Could not load your listings: ' + (e.message || e.code);
    console.error('Load owner listings error:', e);
  }
}
// ============================================================================
// Listing Payments
// ============================================================================
async function loadListingPayments() {
  const list = $('listingPaymentsList');
  const msg = $('listingPaymentsMessage');
  list.replaceChildren();
  msg.textContent = 'Loading payment queue...';
  try {
    const snap = await getDocs(collection(db, 'listingPayments'));
    const payments = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => { const at = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0; const bt = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0; return bt - at; });
    if (payments.length === 0) { list.textContent = 'No pending listing payments.'; msg.textContent = 'Payment queue is empty.'; return; }
    list.replaceChildren();
    payments.forEach(p => {
      const item = document.createElement('div');
      item.className = 'account-item';
      const overdue = p.dueDate && typeof p.dueDate.toDate === 'function' && p.dueDate.toDate() < new Date();
      item.innerHTML = `
        <strong>Payment #${p.id.slice(0, 8)}</strong>
        <p>Listing: ${escapeHtml(p.listingId || 'N/A')} · Seller: ${escapeHtml(p.sellerId || 'N/A')}</p>
        <p>Amount: ${formatMoney(p.amount)} · Status: ${escapeHtml(p.status || 'pending')} ${overdue ? '<span style="color:var(--accent-red)"> · OVERDUE</span>' : ''}</p>
        <div class="account-actions">
          <button class="btn btn-sm btn-outline" onclick="verifyPayment('${p.id}', '${escapeHtml(p.sellerId || '')}')">Verify</button>
        </div>
      `;
      list.appendChild(item);
    });
    msg.textContent = `Found ${payments.length} payment(s) in queue.`;
  } catch (e) {
    list.textContent = 'Could not load payment queue.';
    msg.textContent = 'Could not load payment queue.';
    console.error('Listing payments error:', e);
  }
}

window.verifyPayment = async (paymentId, sellerId) => {
  showDialog('Verify Payment', 'Confirm that this listing payment has been received via M-Pesa?', async () => {
    try {
      await updateDoc(doc(db, 'listingPayments', paymentId), { status: 'verified', verifiedAt: serverTimestamp(), verifiedBy: ownerUid });
      await writeAuditLog('payment_verified', 'listingPayment', paymentId, sellerId);
      showToast('Payment verified.', 'success');
      loadListingPayments();
    } catch (e) {
      showToast('Could not verify payment: ' + (e.message || e.code), 'error');
    }
  });
};
$('loadListingPaymentsButton')?.addEventListener('click', loadListingPayments);
$('loadAdminsButtonTop')?.addEventListener('click', loadAdminsPage);
// ============================================================================
// Revenue Dashboard
// ============================================================================
async function loadRevenueDashboard() {
  const statsContainer = $('revenueStats');
  statsContainer.replaceChildren();
  try {
    const snap = await getDocs(collection(db, 'listingPayments'));
    const payments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const verified = payments.filter(p => p.status === 'verified');
    const pending = payments.filter(p => p.status === 'pending');
    const totalCollected = verified.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const totalPending = pending.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    statsContainer.innerHTML = `
      <div class="revenue-stat"><h4>Total Collected</h4><div class="value">${formatMoney(totalCollected)}</div><div class="sub">${verified.length} verified payments</div></div>
      <div class="revenue-stat"><h4>Pending</h4><div class="value">${formatMoney(totalPending)}</div><div class="sub">${pending.length} unpaid invoices</div></div>
      <div class="revenue-stat"><h4>Overdue</h4><div class="value" style="color:var(--accent-red)">KES 0</div><div class="sub">Payments past due date</div></div>
      <div class="revenue-stat"><h4>Active Sellers</h4><div class="value">${new Set(payments.map(p => p.sellerId)).size}</div><div class="sub">Sellers with payments</div></div>
    `;
    await renderRevenueQueue(pending);
    await renderRevenueBySeller(payments);
  } catch (e) {
    statsContainer.textContent = 'Could not load revenue data.';
    console.error('Revenue dashboard error:', e);
  }
}

async function renderRevenueQueue(pending) {
  const container = $('revenueQueueList');
  container.replaceChildren();
  if (pending.length === 0) { container.textContent = 'No pending or overdue payments.'; return; }
  pending.forEach(p => {
    const item = document.createElement('div');
    item.className = 'account-item';
    item.innerHTML = `
      <strong>Payment #${p.id.slice(0, 8)}</strong>
      <p>Listing: ${escapeHtml(p.listingId || 'N/A')} · Seller: ${escapeHtml(p.sellerId || 'N/A')}</p>
      <p>Amount: ${formatMoney(p.amount)} · Status: ${escapeHtml(p.status || 'pending')}</p>
      <div class="account-actions">
        <button class="btn btn-sm btn-outline" onclick="verifyPayment('${p.id}', '${escapeHtml(p.sellerId || '')}')">Verify</button>
      </div>
    `;
    container.appendChild(item);
  });
}

async function renderRevenueBySeller(payments) {
  const container = $('revenueBySellerList');
  container.replaceChildren();
  const bySeller = {};
  payments.forEach(p => {
    if (!bySeller[p.sellerId]) bySeller[p.sellerId] = { count: 0, total: 0 };
    bySeller[p.sellerId].count++;
    bySeller[p.sellerId].total += Number(p.amount) || 0;
  });
  const entries = Object.entries(bySeller).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
  if (entries.length === 0) { container.textContent = 'No revenue data.'; return; }
  entries.forEach(([sellerId, data]) => {
    const item = document.createElement('div');
    item.className = 'account-item';
    item.innerHTML = `
      <strong>Seller ${sellerId.slice(0, 8)}</strong>
      <p>${data.count} invoice(s) · ${formatMoney(data.total)}</p>
    `;
    container.appendChild(item);
  });
}

$('loadRevenueButton')?.addEventListener('click', loadRevenueDashboard);
$('exportRevenueButton')?.addEventListener('click', () => {
  showToast('CSV export would download revenue data. (Backend CSV endpoint required)', 'info', 3000);
});
// ============================================================================
// Audit Log
// ============================================================================
function resetAuditPagination() {
  paginationState.audit = { lastDoc: null, pageSize: 25, hasMore: true, loading: false };
  $('auditLogList').replaceChildren();
}

let allAuditCache = [];

async function loadAuditLogPage() {
  const list = $('auditLogList');
  list.replaceChildren();
  list.textContent = 'Loading audit log...';
  try {
    const q = query(collection(db, 'auditLog'), orderBy('createdAt', 'desc'), limit(100));
    const snap = await getDocs(q);
    allAuditCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAuditLog(allAuditCache);
  } catch (e) {
    list.textContent = 'Could not load audit log.';
    console.error('Audit log error:', e);
  }
}

function renderAuditLog(logs) {
  const list = $('auditLogList');
  list.replaceChildren();
  let filtered = logs.filter(l => {
    const term = filters.audit.search.toLowerCase();
    const matchSearch = !term || String(l.action || '').toLowerCase().includes(term) || String(l.actorName || '').toLowerCase().includes(term) || String(l.targetLabel || '').toLowerCase().includes(term);
    const matchAction = filters.audit.action === 'all' || String(l.action) === filters.audit.action;
    return matchSearch && matchAction;
  });
  if (filtered.length === 0) { list.textContent = 'No matching audit entries.'; return; }
  filtered.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'account-item';
    item.innerHTML = `
      <strong>${escapeHtml(entry.action.replace(/_/g, ' '))}</strong>
      <p>By: ${escapeHtml(entry.actorName || 'Unknown')} · Target: ${escapeHtml(entry.targetLabel || entry.targetType || 'N/A')}</p>
      <p>${formatDate(entry.createdAt)}</p>
    `;
    list.appendChild(item);
  });
}

$('loadAuditLogButton')?.addEventListener('click', loadAuditLogPage);
$('auditSearch')?.addEventListener('input', (e) => {
  filters.audit.search = e.target.value.toLowerCase();
  renderAuditLog(allAuditCache);
});
$('auditActionFilter')?.addEventListener('change', (e) => {
  filters.audit.action = e.target.value;
  renderAuditLog(allAuditCache);
});
$('clearAuditFilters')?.addEventListener('click', () => {
  filters.audit = { search: '', action: 'all' };
  $('auditSearch').value = ''; $('auditActionFilter').value = 'all';
  renderAuditLog(allAuditCache);
});
$('exportAuditLogButton')?.addEventListener('click', () => {
  showToast('CSV export would download audit log. (Backend CSV endpoint required)', 'info', 3000);
});
// ============================================================================
// Listing Moderation
// ============================================================================
async function loadModerationQueue() {
  const list = $('moderationList');
  const msg = $('moderationMessage');
  list.replaceChildren();
  msg.textContent = 'Loading moderation queue...';
  try {
    // Try flagged listings collection, fall back to empty state
    let snap;
    try {
      snap = await getDocs(query(collection(db, 'flaggedListings'), orderBy('createdAt', 'desc'), limit(50)));
    } catch (e) {
      snap = { docs: [], empty: true };
    }
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (items.length === 0) { list.textContent = 'No listings flagged for moderation.'; msg.textContent = 'Moderation queue is empty.'; return; }
    list.replaceChildren();
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'account-item';
      el.innerHTML = `
        <strong>Flagged Listing #${item.id.slice(0, 8)}</strong>
        <p>Reason: ${escapeHtml(item.reason || 'Not specified')} · Reported by: ${escapeHtml(item.reporterId || 'Anonymous')}</p>
        <p>${formatDate(item.createdAt)}</p>
        <div class="account-actions">
          <button class="btn btn-sm btn-outline" onclick="dismissFlag('${item.id}')">Dismiss</button>
        </div>
      `;
      list.appendChild(el);
    });
    msg.textContent = `${items.length} item(s) in moderation queue.`;
  } catch (e) {
    list.textContent = 'Could not load moderation queue.';
    msg.textContent = 'Could not load moderation queue.';
    console.error('Moderation error:', e);
  }
}

window.dismissFlag = async (id) => {
  showDialog('Dismiss Flag', 'Dismiss this moderation flag?', async () => {
    try {
      await updateDoc(doc(db, 'flaggedListings', id), { status: 'dismissed', dismissedBy: ownerUid, dismissedAt: serverTimestamp() });
      await writeAuditLog('moderation_dismissed', 'flaggedListing', id, 'Dismissed moderation flag');
      showToast('Flag dismissed.', 'success');
      loadModerationQueue();
    } catch (e) {
      showToast('Could not dismiss flag: ' + (e.message || e.code), 'error');
    }
  });
};
$('loadModerationButton')?.addEventListener('click', loadModerationQueue);

// ============================================================================
// Owner Settings
// ============================================================================
async function loadOwnerSettings() {
  const info = $('settingsProfileInfo');
  const nameIn = $('settingsOwnerName');
  const emailIn = $('settingsOwnerEmail');
  const form = $('settingsProfileForm');
  if (ownerProfile) {
    info.textContent = '';
    nameIn.value = ownerProfile.name || '';
    emailIn.value = ownerProfile.email || '';
    form.hidden = false;
  } else {
    info.textContent = 'Loading profile...';
  }
}

$('settingsProfileForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!ownerUid) return;
  const btn = e.target.querySelector('button[type="submit"]');
  const msg = $('settingsProfileMessage');
  btn.disabled = true;
  msg.textContent = 'Updating profile...';
  try {
    await updateDoc(doc(db, 'admins', ownerUid), {
      name: $('settingsOwnerName').value.trim(),
      email: $('settingsOwnerEmail').value.trim(),
      updatedAt: serverTimestamp()
    });
    ownerProfile = await (await getDoc(doc(db, 'admins', ownerUid))).data();
    $('dropdownName').textContent = ownerProfile.name || 'Owner';
    $('dropdownEmail').textContent = ownerProfile.email || '';
    msg.textContent = 'Profile updated.';
    msg.style.color = '#167a35';
    showToast('Profile updated.', 'success');
  } catch (err) {
    msg.textContent = 'Could not update profile: ' + (err.code || err.message);
    msg.style.color = '#c62828';
  } finally { btn.disabled = false; }
});

$('settingsPasswordForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;
  const currentPwd = $('settingsCurrentPassword').value;
  const newPwd = $('settingsNewPassword').value;
  const confirmPwd = $('settingsConfirmPassword').value;
  const msg = $('settingsPasswordMessage');
  const btn = e.target.querySelector('button[type="submit"]');
  if (newPwd !== confirmPwd) { msg.textContent = 'New passwords do not match.'; msg.style.color = '#c62828'; return; }
  btn.disabled = true; msg.textContent = 'Changing password...';
  try {
    const cred = EmailAuthProvider.credential(user.email, currentPwd);
    await reauthenticateWithCredential(user, cred);
    await updatePassword(user, newPwd);
    msg.textContent = 'Password changed successfully.';
    msg.style.color = '#167a35';
    e.target.reset();
    showToast('Password changed.', 'success');
  } catch (err) {
    msg.textContent = 'Could not change password: ' + (err.code || err.message);
    msg.style.color = '#c62828';
  } finally { btn.disabled = false; }
});

$('settingsSignOutAll')?.addEventListener('click', () => {
  showDialog('Sign Out of All Sessions', 'This will sign out your owner account from all devices. Continue?', async () => {
    try {
      showToast('Sign out all sessions requires Firebase Auth backend support.', 'info', 3000);
    } catch (e) {
      showToast('Could not sign out all sessions.', 'error');
    }
  });
});
// ============================================================================
// Edit Listing Modal (preserved from original)
// ============================================================================
const ownerCarEditModal = $('ownerCarEditModal');
const ownerCarEditForm = $('ownerCarEditForm');
const saveOwnerCarEditButton = $('saveOwnerCarEdit');
const ownerCarEditMessage = $('ownerCarEditMessage');

window.openOwnerCarEdit = (car) => {
  if (!ownerUid || car.addedBy !== ownerUid || !ownerCarEditModal) return;
  editingOwnerCarId = car.id;
  $('ownerEditManufacturer').value = car.manufacturer || '';
  $('ownerEditCarType').value = car.carType || '';
  $('ownerEditModel').value = car.model || '';
  $('ownerEditYear').value = car.year || '';
  $('ownerEditPrice').value = car.price ?? '';
  $('ownerEditStatus').value = car.status || '';
  $('ownerEditMileage').value = car.mileage ?? '';
  $('ownerEditFuel').value = car.fuel || '';
  $('ownerEditTransmission').value = car.transmission || '';
  $('ownerEditRelationship').value = car.vehicleRelationship || '';
  $('ownerEditAuthorization').checked = car.authorizationConfirmed === true;
  $('ownerEditDescription').value = car.description || '';
  ownerCarEditMessage.textContent = '';
  ownerCarEditModal.hidden = false;
};

function closeOwnerCarEdit() {
  if (!ownerCarEditModal) return;
  ownerCarEditModal.hidden = true;
  editingOwnerCarId = null;
  ownerCarEditForm?.reset();
}

$('closeOwnerCarEdit')?.addEventListener('click', closeOwnerCarEdit);
$('cancelOwnerCarEdit')?.addEventListener('click', closeOwnerCarEdit);
ownerCarEditModal?.addEventListener('click', (e) => { if (e.target === ownerCarEditModal) closeOwnerCarEdit(); });

ownerCarEditForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editingOwnerCarId || !ownerUid) return;
  saveOwnerCarEditButton.disabled = true;
  ownerCarEditMessage.textContent = 'Saving vehicle changes...';
  try {
    const mileageValue = $('ownerEditMileage').value.trim();
    await updateDoc(doc(db, 'cars', editingOwnerCarId), {
      manufacturer: $('ownerEditManufacturer').value.trim(),
      carType: $('ownerEditCarType').value,
      model: $('ownerEditModel').value.trim(),
      year: Number($('ownerEditYear').value),
      price: Number($('ownerEditPrice').value),
      status: $('ownerEditStatus').value,
      mileage: mileageValue ? Number(mileageValue) : null,
      fuel: $('ownerEditFuel').value,
      transmission: $('ownerEditTransmission').value,
      vehicleRelationship: $('ownerEditRelationship').value,
      authorizationConfirmed: $('ownerEditAuthorization').checked,
      description: $('ownerEditDescription').value.trim(),
      updatedAt: serverTimestamp()
    });
    await writeAuditLog('listing_edited', 'car', editingOwnerCarId, $('ownerEditManufacturer').value.trim() + ' ' + $('ownerEditModel').value.trim());
    closeOwnerCarEdit();
    showToast('Vehicle listing updated.', 'success');
    if (currentPanel === 'vehicles') loadVehiclesPage();
    if (currentPanel === 'my-cars') loadOwnerCars();
  } catch (error) {
    console.error('Could not save owner vehicle edits:', error);
    ownerCarEditMessage.textContent = 'Could not save vehicle changes: ' + (error.code || error.message);
    ownerCarEditMessage.style.color = '#c62828';
  } finally {
    saveOwnerCarEditButton.disabled = false;
  }
});

// ============================================================================
// Existing Features: Draft Recovery, Remove Seller Categories, Refresh
// ============================================================================
$('refreshAccountsButton')?.addEventListener('click', loadAccountStats);
$('refreshButton')?.addEventListener('click', () => { loadCarCount(); loadVehiclesPage(); });

$('removePublicSellerCategoriesButton')?.addEventListener('click', async () => {
  showDialog('Remove Seller Categories', 'Remove seller category fields from all public vehicle listings? This cannot be undone.', async () => {
    try {
      const snap = await getDocs(collection(db, 'cars'));
      const batch = writeBatch(db);
      let count = 0;
      snap.forEach(d => {
        const data = d.data();
        if (data.sellerCategory || data.sellerType) {
          batch.update(doc(db, 'cars', d.id), { sellerCategory: null, sellerType: null });
          count++;
        }
      });
      await batch.commit();
      await writeAuditLog('bulk_listing_update', 'system', 'all', `Removed seller categories from ${count} listings`);
      showToast(`Removed seller categories from ${count} listings.`, 'success');
      $('publicSellerCategoriesMessage').textContent = `Removed from ${count} listings.`;
      $('publicSellerCategoriesMessage').style.color = '#167a35';
    } catch (e) {
      showToast('Could not remove seller categories: ' + (e.message || e.code), 'error');
    }
  });
});

$('recoverApprovedDraftsButton')?.addEventListener('click', async () => {
  showDialog('Recover Drafts', 'Publish eligible drafts owned by active, approved dealers? Matching public listings will be skipped.', async () => {
    try {
      const [carsSnap, adminsSnap] = await Promise.all([
        getDocs(collection(db, 'cars')),
        getDocs(collection(db, 'admins'))
      ]);
      const approvedDealers = new Set();
      adminsSnap.forEach(d => {
        const data = d.data();
        if (String(data.role || '').toLowerCase() === 'dealer' && data.approvalStatus === 'approved' && data.active === true) {
          approvedDealers.add(d.id);
        }
      });
      let recovered = 0, skipped = 0;
      const batch = writeBatch(db);
      carsSnap.forEach(d => {
        const data = d.data();
        if (data.listingStatus === 'draft' && data.addedBy && approvedDealers.has(data.addedBy)) {
          // Check if matching public listing exists
          const hasPublic = carsSnap.some(other => other.id !== d.id && other.data().addedBy === data.addedBy && other.data().manufacturer === data.manufacturer && other.data().model === data.model);
          if (hasPublic) { skipped++; return; }
          batch.update(doc(db, 'cars', d.id), { listingStatus: 'active', updatedAt: serverTimestamp() });
          recovered++;
        }
      });
      if (recovered > 0) await batch.commit();
      await writeAuditLog('draft_recovery', 'system', 'all', `Recovered ${recovered} drafts, skipped ${skipped}`);
      showToast(`Recovered ${recovered} draft(s), skipped ${skipped}.`, 'success');
      $('recoverApprovedDraftsMessage').textContent = `Recovered ${recovered} draft(s), skipped ${skipped}.`;
      $('recoverApprovedDraftsMessage').style.color = '#167a35';
      loadCarCount();
    } catch (e) {
      showToast('Draft recovery failed: ' + (e.message || e.code), 'error');
    }
  });
});

// ============================================================================
// Real-time vehicle activity listener (preserved)
// ============================================================================
function setupRealtimeListener() {
  // Lightweight placeholder for real-time activity; full onSnapshot would
  // require Firebase v9 onSnapshot import. Kept as a stub for compatibility.
  console.log('Realtime listener ready (owner session active).');
}

// ============================================================================
// Initialization
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  const ok = await requireOwner(user);
  if (!ok) return;
  setupNavigation();
  switchPanel('overview');
  setupRealtimeListener();
});
