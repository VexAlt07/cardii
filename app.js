/* ═══════════════════════════════════════════════════════════════
   Cardii — Flash Cards App
   Storage: localStorage  |  Export/Import: JSON  |  Sync: Google Drive
   Features: spaced repetition (3 levels), stats, list/grid view
═══════════════════════════════════════════════════════════════ */

// ── GOOGLE DRIVE CONFIG ──────────────────────────────────────
const DRIVE_CLIENT_ID = '181622455685-nq5qsa7b3rmf3gdcp1sl9pr33bt57g4n.apps.googleusercontent.com';
const DRIVE_SCOPE     = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
const DRIVE_FILENAME  = 'cardii_data.json';

let driveTokenClient = null;
let driveAccessToken = null;
let driveFileId      = null;
let driveStatus      = 'disconnected';
let pickerApiLoaded  = false;

// ── STATE ────────────────────────────────────────────────────
// card structure: { id, front, back, nextReview, interval, totalReviews, successCount }
// folder structure: { id, name, matiereId, cards[], stats: { sessions, lastSession } }
let state = {
  matieres: [],
  folders: [],
  activeFolderId: null,
};

let editingCardId     = null;
let pendingDeleteType = null;
let pendingDeleteId   = null;
let currentSection    = 'library'; // 'library' | 'dashboard'
let dashboardMatiereFilter = 'all';

// Study state
let studyCards    = [];
let studyIndex    = 0;
let studyFlipped  = false;
let studyResults  = []; // { cardId, result } result: 'fail'|'hesitant'|'success'

// Spaced repetition intervals (days)
const SR_INTERVALS = { fail: 1, hesitant: 3, success: 7 };

// ── STORAGE ──────────────────────────────────────────────────
const STORAGE_KEY        = 'cardii_data';
const LEGACY_STORAGE_KEY = 'kartis_data';
const VIEW_KEY           = 'cardii_view';

function normalizeStateData() {
  if (!Array.isArray(state.matieres)) state.matieres = [];
  if (!Array.isArray(state.folders)) state.folders = [];
  const hasUnassignedFolder = state.folders.some(f => !f.matiereId);
  if (state.matieres.length === 0 && hasUnassignedFolder) {
    state.matieres.push({ id: uid(), name: 'Sans matière' });
  }
  const fallback = state.matieres[0]?.id || null;
  state.folders.forEach(f => {
    if (!f.stats) f.stats = { sessions: 0, lastSession: null };
    if ((!f.matiereId || !state.matieres.some(m => m.id === f.matiereId)) && fallback) f.matiereId = fallback;
    f.cards.forEach(c => {
      if (!c.nextReview)    c.nextReview    = null;
      if (!c.interval)      c.interval      = 1;
      if (!c.totalReviews)  c.totalReviews  = 0;
      if (!c.successCount)  c.successCount  = 0;
    });
  });
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (driveStatus === 'connected') driveSave();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch (e) { /* ignore */ }
  normalizeStateData();
}

// ── HELPERS ──────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getActiveFolder() {
  return state.folders.find(f => f.id === state.activeFolderId) || null;
}

function getMatiereById(id) {
  return state.matieres.find(m => m.id === id) || null;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(dateStr) {
  if (!dateStr) return 999;
  const diff = new Date() - new Date(dateStr);
  return Math.floor(diff / 86400000);
}

// Cartes à réviser aujourd'hui (nextReview <= today ou jamais révisées)
function getDueCards(folder) {
  const today = todayStr();
  return folder.cards.filter(c => !c.nextReview || c.nextReview <= today);
}

// Stats calculées pour un dossier
function getFolderStats(folder) {
  const cards       = folder.cards;
  const total       = cards.length;
  const reviewed    = cards.filter(c => c.totalReviews > 0).length;
  const due         = getDueCards(folder).length;
  const successRate = reviewed === 0 ? null
    : Math.round(cards.reduce((sum, c) => sum + (c.totalReviews > 0 ? c.successCount / c.totalReviews : 0), 0) / reviewed * 100);
  const lastSession = folder.stats?.lastSession || null;
  const sessions    = folder.stats?.sessions    || 0;
  return { total, reviewed, due, successRate, lastSession, sessions };
}

function getMatiereStats(matiereId) {
  const folders = state.folders.filter(f => f.matiereId === matiereId);
  const totals = folders.map(f => ({ folder: f, stats: getFolderStats(f) }));
  const totalCards = totals.reduce((sum, entry) => sum + entry.stats.total, 0);
  const dueCards = totals.reduce((sum, entry) => sum + entry.stats.due, 0);
  const reviewed = totals.reduce((sum, entry) => sum + entry.stats.reviewed, 0);
  const successWeighted = totals.reduce((sum, entry) => {
    if (entry.stats.successRate === null) return sum;
    return sum + (entry.stats.successRate * entry.stats.reviewed);
  }, 0);
  const successRate = reviewed > 0 ? Math.round(successWeighted / reviewed) : null;
  return { folders, totals, totalCards, dueCards, successRate };
}

function getDashboardData(matiereFilter = 'all') {
  const folders = matiereFilter === 'all'
    ? state.folders
    : state.folders.filter(f => f.matiereId === matiereFilter);

  const totals = folders.map(f => ({ folder: f, stats: getFolderStats(f) }));
  const totalCards = totals.reduce((sum, entry) => sum + entry.stats.total, 0);
  const dueCards = totals.reduce((sum, entry) => sum + entry.stats.due, 0);
  const reviewedCards = folders.reduce((sum, f) => sum + f.cards.filter(c => c.totalReviews > 0).length, 0);
  const masteredCards = folders.reduce((sum, f) => sum + f.cards.filter(c => c.totalReviews > 0 && (c.successCount / c.totalReviews) >= 0.8).length, 0);
  const neverReviewedCards = totalCards - reviewedCards;
  const successRate = reviewedCards > 0
    ? Math.round((folders.reduce((sum, f) => sum + f.cards.reduce((s, c) => s + c.successCount, 0), 0) /
      folders.reduce((sum, f) => sum + f.cards.reduce((s, c) => s + (c.totalReviews || 0), 0), 0)) * 100)
    : null;

  const sessionsByMatiere = state.matieres.map(m => {
    const subset = folders.filter(f => f.matiereId === m.id);
    const sessions = subset.reduce((sum, f) => sum + (f.stats?.sessions || 0), 0);
    return { label: m.name, value: sessions };
  }).filter(row => row.value > 0 || matiereFilter === 'all');

  const intervalBuckets = { "Aujourd'hui": 0, '1-3j': 0, '4-7j': 0, '8j+': 0 };
  folders.forEach(f => {
    f.cards.forEach(c => {
      if (!c.nextReview || c.nextReview <= todayStr()) intervalBuckets["Aujourd'hui"]++;
      else {
        const days = Math.ceil((new Date(c.nextReview) - new Date()) / 86400000);
        if (days <= 3) intervalBuckets['1-3j']++;
        else if (days <= 7) intervalBuckets['4-7j']++;
        else intervalBuckets['8j+']++;
      }
    });
  });

  return {
    folders,
    totals,
    totalCards,
    dueCards,
    reviewedCards,
    masteredCards,
    neverReviewedCards,
    successRate,
    sessionsByMatiere,
    intervalBuckets,
  };
}

// ── RENDER ───────────────────────────────────────────────────
function render() {
  renderSidebar();
  renderMain();
}

function renderSidebar() {
  const list = document.getElementById('folder-list');
  list.innerHTML = '';

  if (state.folders.length === 0 && state.matieres.length === 0) {
    list.innerHTML = '<p style="font-size:12.5px;color:var(--muted);padding:12px 16px;">Aucune matière</p>';
    return;
  }

  state.matieres.forEach(matiere => {
    const folders = state.folders.filter(f => f.matiereId === matiere.id);
    const isEmptyDefault = matiere.name === 'Sans matière' && folders.length === 0;
    if (isEmptyDefault) return;

    const group = document.createElement('div');
    group.className = 'matiere-group';
    const header = document.createElement('div');
    header.className = 'matiere-header';
    header.textContent = matiere.name;
    group.appendChild(header);

    if (folders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'folder-item';
      empty.innerHTML = '<span class="folder-icon">▫</span><span class="folder-item-name" style="color:var(--muted)">Aucun sujet</span>';
      group.appendChild(empty);
    }

    folders.forEach(folder => {
      const stats = getFolderStats(folder);
      const item  = document.createElement('div');
      item.className = 'folder-item' + (folder.id === state.activeFolderId ? ' active' : '');
      item.innerHTML = `
        <span class="folder-icon">▫</span>
        <span class="folder-item-name">${esc(folder.name)}</span>
        <span class="folder-count">${folder.cards.length}</span>
        <div class="folder-tooltip">
          <div class="tooltip-row"><span>Cartes</span><strong>${stats.total}</strong></div>
          <div class="tooltip-row"><span>À réviser</span><strong class="${stats.due > 0 ? 'due-highlight' : ''}">${stats.due}</strong></div>
          <div class="tooltip-row"><span>Réussite</span><strong>${stats.successRate !== null ? stats.successRate + '%' : '—'}</strong></div>
          <div class="tooltip-row"><span>Sessions</span><strong>${stats.sessions}</strong></div>
          <div class="tooltip-row"><span>Dernière</span><strong>${stats.lastSession ? stats.lastSession : '—'}</strong></div>
        </div>
      `;
      item.addEventListener('click', () => selectFolder(folder.id));
      group.appendChild(item);
    });

    list.appendChild(group);
  });
}

function renderMain() {
  const folder  = getActiveFolder();
  const isEmpty = !folder;
  const inStudy = !document.getElementById('study-view').classList.contains('hidden');
  const inDashboard = currentSection === 'dashboard';

  document.getElementById('empty-state').classList.toggle('hidden', !isEmpty || inStudy || inDashboard);
  document.getElementById('folder-view').classList.toggle('hidden', isEmpty || inStudy || inDashboard);
  document.getElementById('dashboard-view').classList.toggle('hidden', inStudy || !inDashboard);
  document.getElementById('btn-nav-library').classList.toggle('active', currentSection === 'library');
  document.getElementById('btn-nav-dashboard').classList.toggle('active', currentSection === 'dashboard');

  if (!isEmpty && !inStudy) renderFolderView(folder);
  if (inDashboard && !inStudy) renderDashboardView();
}

function renderFolderView(folder) {
  document.getElementById('folder-title').textContent = folder.name;
  const matiere = getMatiereById(folder.matiereId);
  document.getElementById('folder-matiere-label').textContent = matiere ? `Matière : ${matiere.name}` : '';
  const stats = getFolderStats(folder);
  const count = folder.cards.length;

  // Meta bar
  let metaHtml = count === 0 ? 'Aucune carte' : `${count} carte${count > 1 ? 's' : ''}`;
  if (count > 0) {
    metaHtml += ` &nbsp;·&nbsp; <span class="${stats.due > 0 ? 'due-badge' : 'ok-badge'}">${stats.due} à réviser</span>`;
    if (stats.successRate !== null) metaHtml += ` &nbsp;·&nbsp; ${stats.successRate}% de réussite`;
  }
  document.getElementById('card-count').innerHTML = metaHtml;
  renderMatiereStats(folder.matiereId);

  const grid = document.getElementById('cards-grid');
  grid.innerHTML = '';
  grid.className = 'cards-grid';

  document.getElementById('no-cards').classList.toggle('hidden', count > 0);
  grid.classList.toggle('hidden', count === 0);

  const today = todayStr();
  folder.cards.forEach(card => {
    const isDue      = !card.nextReview || card.nextReview <= today;
    const daysLeft   = card.nextReview ? daysBetween(card.nextReview) * -1 : null;
    const rateStr    = card.totalReviews > 0
      ? Math.round(card.successCount / card.totalReviews * 100) + '%'
      : null;
    const nextStr    = card.nextReview && !isDue
      ? `dans ${Math.ceil((new Date(card.nextReview) - new Date()) / 86400000)} j`
      : null;

    const tile = document.createElement('div');
    tile.className = 'card-tile';
    tile.innerHTML = `
      <div class="card-tile-body">
        <div class="card-tile-front">${esc(card.front)}</div>
        <div class="card-tile-back">${esc(card.back)}</div>
      </div>
      <div class="card-tile-footer">
        <div class="card-tile-badges">
          ${isDue ? '<span class="badge badge-due">À réviser</span>' : ''}
          ${!isDue && nextStr ? `<span class="badge badge-ok">${nextStr}</span>` : ''}
          ${rateStr ? `<span class="badge badge-rate">${rateStr}</span>` : ''}
        </div>
        <div class="card-tile-actions">
          <button class="card-action-btn" data-edit="${card.id}">Modifier</button>
          <button class="card-action-btn danger" data-delete="${card.id}">Supprimer</button>
        </div>
      </div>
    `;
    tile.querySelector('[data-edit]').addEventListener('click', e => { e.stopPropagation(); openEditCard(card.id); });
    tile.querySelector('[data-delete]').addEventListener('click', e => { e.stopPropagation(); confirmDeleteCard(card.id); });
    grid.appendChild(tile);
  });
}

function renderMatiereStats(matiereId) {
  const wrap = document.getElementById('matiere-stats');
  const stats = getMatiereStats(matiereId);
  wrap.classList.toggle('hidden', stats.folders.length === 0);
  if (stats.folders.length === 0) return;
  document.getElementById('matiere-stat-total').textContent = stats.totalCards;
  document.getElementById('matiere-stat-due').textContent = stats.dueCards;
  document.getElementById('matiere-stat-rate').textContent = stats.successRate !== null ? `${stats.successRate}%` : '—';
  renderSimpleChart('matiere-chart-subjects', stats.totals.map(e => ({ label: e.folder.name, value: e.stats.total })));
  renderSimpleChart('matiere-chart-due', stats.totals.map(e => ({ label: e.folder.name, value: e.stats.due })));
}

function renderSimpleChart(targetId, rows) {
  const host = document.getElementById(targetId);
  host.innerHTML = '';
  const max = Math.max(1, ...rows.map(r => r.value));
  rows.sort((a, b) => b.value - a.value).forEach(row => {
    const item = document.createElement('div');
    item.className = 'chart-row';
    item.innerHTML = `
      <span class="chart-label">${esc(row.label)}</span>
      <div class="chart-track"><div class="chart-fill" style="width:${Math.round((row.value / max) * 100)}%"></div></div>
      <span class="chart-value">${row.value}</span>
    `;
    host.appendChild(item);
  });
}

function renderDashboardView() {
  const filter = document.getElementById('dashboard-matiere-filter');
  const visibleMatieres = state.matieres.filter(m => {
    const folders = state.folders.filter(f => f.matiereId === m.id);
    return !(m.name === 'Sans matière' && folders.length === 0);
  });

  if (filter.options.length !== (visibleMatieres.length + 1)) {
    filter.innerHTML = '<option value="all">Toutes les matières</option>';
    visibleMatieres.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      filter.appendChild(opt);
    });
  }
  if (![...filter.options].some(o => o.value === dashboardMatiereFilter)) dashboardMatiereFilter = 'all';
  filter.value = dashboardMatiereFilter;

  const data = getDashboardData(dashboardMatiereFilter);
  const bento = document.getElementById('dashboard-bento');

  bento.innerHTML = `
    <section class="bento-card bento-kpi">
      <span>Cartes</span><strong>${data.totalCards}</strong>
      <small>${data.folders.length} sujet(s)</small>
    </section>
    <section class="bento-card bento-kpi">
      <span>À réviser</span><strong>${data.dueCards}</strong>
      <small>${data.totalCards > 0 ? Math.round((data.dueCards / data.totalCards) * 100) : 0}% du total</small>
    </section>
    <section class="bento-card bento-kpi">
      <span>Taux de réussite</span><strong>${data.successRate !== null ? data.successRate + '%' : '—'}</strong>
      <small>${data.masteredCards} cartes maîtrisées</small>
    </section>
    <section class="bento-card bento-card-wide">
      <h3>Top sujets (cartes / à réviser)</h3>
      <div id="dashboard-chart-subjects" class="simple-chart"></div>
    </section>
    <section class="bento-card">
      <h3>Statut des cartes</h3>
      <div id="dashboard-status-donut" class="donut-chart"></div>
      <div class="donut-legend">
        <span>Jamais revues: ${data.neverReviewedCards}</span>
        <span>En progression: ${Math.max(0, data.reviewedCards - data.masteredCards)}</span>
        <span>Maîtrisées: ${data.masteredCards}</span>
      </div>
    </section>
    <section class="bento-card">
      <h3>Charge de révision</h3>
      <div id="dashboard-chart-intervals" class="simple-chart"></div>
    </section>
    <section class="bento-card bento-card-wide">
      <h3>Sessions de révision par matière</h3>
      <div id="dashboard-chart-sessions" class="simple-chart"></div>
    </section>
  `;

  renderSimpleChart(
    'dashboard-chart-subjects',
    data.totals
      .map(e => ({ label: e.folder.name, value: e.stats.total, extra: e.stats.due }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
      .map(row => ({ label: `${row.label} (${row.extra})`, value: row.value }))
  );
  renderSimpleChart(
    'dashboard-chart-intervals',
    Object.entries(data.intervalBuckets).map(([label, value]) => ({ label, value }))
  );
  renderSimpleChart(
    'dashboard-chart-sessions',
    data.sessionsByMatiere.length ? data.sessionsByMatiere : [{ label: 'Aucune session', value: 0 }]
  );
  renderDonut('dashboard-status-donut', [
    { label: 'Jamais revues', value: data.neverReviewedCards, color: '#9E9E9E' },
    { label: 'En progression', value: Math.max(0, data.reviewedCards - data.masteredCards), color: '#FFB74D' },
    { label: 'Maîtrisées', value: data.masteredCards, color: '#66BB6A' },
  ]);
}

function renderDonut(targetId, slices) {
  const total = Math.max(1, slices.reduce((sum, s) => sum + s.value, 0));
  let angle = 0;
  const parts = slices.map(slice => {
    const start = angle;
    const pct = (slice.value / total) * 100;
    angle += pct;
    return `${slice.color} ${start.toFixed(2)}% ${angle.toFixed(2)}%`;
  });
  const el = document.getElementById(targetId);
  el.style.background = `conic-gradient(${parts.join(',')})`;
  el.innerHTML = `<span>${total}</span>`;
}

// ── FOLDER ACTIONS ────────────────────────────────────────────
function selectFolder(id) {
  state.activeFolderId = id;
  currentSection = 'library';
  exitStudy();
  render();
  if (window.innerWidth <= 768) closeSidebar();
}

function switchSection(section) {
  currentSection = section;
  render();
  if (window.innerWidth <= 768) closeSidebar();
}

function createMatiere(name) {
  const matiere = { id: uid(), name: name.trim() };
  state.matieres.push(matiere);
  saveState();
  render();
  return matiere;
}

function createFolder(name, matiereId) {
  const folder = { id: uid(), name: name.trim(), matiereId, cards: [], stats: { sessions: 0, lastSession: null } };
  state.folders.push(folder);
  state.activeFolderId = folder.id;
  saveState();
  render();
}

function renameActiveFolder(name) {
  const folder = getActiveFolder();
  if (folder && name.trim()) {
    folder.name = name.trim();
    saveState();
    renderSidebar();
  }
}

function deleteFolder(id) {
  state.folders = state.folders.filter(f => f.id !== id);
  if (state.activeFolderId === id) state.activeFolderId = null;
  saveState();
  render();
}

// ── CARD ACTIONS ──────────────────────────────────────────────
function createCard(front, back) {
  const folder = getActiveFolder();
  if (!folder) return;
  folder.cards.push({
    id: uid(), front: front.trim(), back: back.trim(),
    nextReview: null, interval: 1, totalReviews: 0, successCount: 0,
  });
  saveState();
  renderFolderView(folder);
  renderSidebar();
}

function updateCard(id, front, back) {
  const folder = getActiveFolder();
  if (!folder) return;
  const card = folder.cards.find(c => c.id === id);
  if (card) { card.front = front.trim(); card.back = back.trim(); }
  saveState();
  renderFolderView(folder);
}

function deleteCard(id) {
  const folder = getActiveFolder();
  if (!folder) return;
  folder.cards = folder.cards.filter(c => c.id !== id);
  saveState();
  renderFolderView(folder);
  renderSidebar();
}



function onDashboardMatiereFilterChange(value) {
  dashboardMatiereFilter = value;
  renderDashboardView();
}

// ── MODALS ────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function openSettings() {
  openModal('modal-settings');
  if (window.innerWidth <= 768) closeSidebar();
}

function openNewFolder() {
  if (state.matieres.length === 0) {
    showToast('Crée d’abord une matière', 'error');
    openNewMatiere();
    return;
  }
  const select = document.getElementById('input-folder-matiere');
  select.innerHTML = '';
  state.matieres.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    select.appendChild(opt);
  });
  const active = getActiveFolder();
  if (active?.matiereId) select.value = active.matiereId;
  document.getElementById('input-folder-name').value = '';
  openModal('modal-folder');
  setTimeout(() => document.getElementById('input-folder-name').focus(), 50);
}

function openNewMatiere() {
  document.getElementById('input-matiere-name').value = '';
  openModal('modal-matiere');
  setTimeout(() => document.getElementById('input-matiere-name').focus(), 50);
}

function openNewCard() {
  editingCardId = null;
  document.getElementById('modal-card-title').textContent = 'Nouvelle carte';
  document.getElementById('input-card-front').value = '';
  document.getElementById('input-card-back').value  = '';
  openModal('modal-card');
  setTimeout(() => document.getElementById('input-card-front').focus(), 50);
}

function openEditCard(id) {
  const folder = getActiveFolder();
  const card   = folder?.cards.find(c => c.id === id);
  if (!card) return;
  editingCardId = id;
  document.getElementById('modal-card-title').textContent = 'Modifier la carte';
  document.getElementById('input-card-front').value = card.front;
  document.getElementById('input-card-back').value  = card.back;
  openModal('modal-card');
  setTimeout(() => document.getElementById('input-card-front').focus(), 50);
}

function confirmDeleteFolder() {
  const folder = getActiveFolder();
  if (!folder) return;
  pendingDeleteType = 'folder';
  pendingDeleteId   = folder.id;
  document.getElementById('modal-confirm-title').textContent = 'Supprimer le sujet ?';
  document.getElementById('modal-confirm-msg').textContent =
    `"${folder.name}" et ses ${folder.cards.length} carte(s) seront supprimés définitivement.`;
  openModal('modal-confirm');
}

function confirmDeleteCard(id) {
  const folder = getActiveFolder();
  const card   = folder?.cards.find(c => c.id === id);
  if (!card) return;
  pendingDeleteType = 'card';
  pendingDeleteId   = id;
  document.getElementById('modal-confirm-title').textContent = 'Supprimer la carte ?';
  document.getElementById('modal-confirm-msg').textContent =
    `La carte "${card.front.slice(0, 60)}..." sera supprimée définitivement.`;
  openModal('modal-confirm');
}

// ── STUDY MODE ────────────────────────────────────────────────
function startStudy() {
  const folder = getActiveFolder();
  if (!folder || folder.cards.length === 0) return;

  // Priorité aux cartes dues, puis les autres
  const due   = getDueCards(folder).sort(() => Math.random() - 0.5);
  const later = folder.cards.filter(c => !getDueCards(folder).includes(c)).sort(() => Math.random() - 0.5);
  studyCards   = [...due, ...later];
  studyIndex   = 0;
  studyFlipped = false;
  studyResults = [];

  document.getElementById('folder-view').classList.add('hidden');
  document.getElementById('study-done').classList.add('hidden');
  document.getElementById('study-deck').classList.remove('hidden');
  document.querySelector('.study-controls').classList.remove('hidden');
  document.getElementById('study-view').classList.remove('hidden');
  document.getElementById('study-due-count').textContent =
    due.length > 0 ? `${due.length} carte${due.length > 1 ? 's' : ''} à réviser aujourd'hui` : 'Révision libre';
  document.body.classList.add('in-study');

  updateStudyCard();
}

function updateStudyCard() {
  const card = studyCards[studyIndex];
  document.getElementById('study-front').textContent = card.front;
  document.getElementById('study-back').textContent  = card.back;

  studyFlipped = false;
  document.getElementById('study-card').classList.remove('flipped');

  // Score buttons: masqués tant que la carte n'est pas retournée
  document.getElementById('study-score-btns').classList.add('hidden');
  document.getElementById('study-nav-btns').classList.remove('hidden');

  const pct = (studyIndex / studyCards.length) * 100;
  document.getElementById('study-progress-fill').style.width = pct + '%';
  document.getElementById('study-progress-text').textContent = `${studyIndex + 1} / ${studyCards.length}`;
  document.getElementById('btn-prev').disabled = studyIndex === 0;
}

function flipStudyCard() {
  if (studyFlipped) return;
  studyFlipped = true;
  document.getElementById('study-card').classList.add('flipped');
  // Affiche les boutons de score après le retournement
  document.getElementById('study-score-btns').classList.remove('hidden');
  document.getElementById('study-nav-btns').classList.add('hidden');
}

function scoreCard(result) {
  // result: 'fail' | 'hesitant' | 'success'
  const card    = studyCards[studyIndex];
  const folder  = getActiveFolder();
  const cardRef = folder.cards.find(c => c.id === card.id);

  if (cardRef) {
    cardRef.totalReviews++;
    if (result === 'success') cardRef.successCount++;
    else if (result === 'hesitant') cardRef.successCount += 0.5;

    // Calcul de la prochaine date de révision
    const days = SR_INTERVALS[result];
    const next = new Date();
    next.setDate(next.getDate() + days);
    cardRef.nextReview = next.toISOString().slice(0, 10);
    cardRef.interval   = days;
  }

  studyResults.push({ cardId: card.id, result });

  if (studyIndex < studyCards.length - 1) {
    studyIndex++;
    updateStudyCard();
  } else {
    finishStudy(folder);
  }
}

function nextStudyCard() {
  if (studyIndex < studyCards.length - 1) { studyIndex++; updateStudyCard(); }
  else finishStudy(getActiveFolder());
}

function prevStudyCard() {
  if (studyIndex > 0) { studyIndex--; updateStudyCard(); }
}

function finishStudy(folder) {
  // Met à jour les stats du dossier
  if (folder) {
    if (!folder.stats) folder.stats = { sessions: 0, lastSession: null };
    folder.stats.sessions++;
    folder.stats.lastSession = todayStr();
    saveState();
  }

  document.getElementById('study-deck').classList.add('hidden');
  document.querySelector('.study-controls').classList.add('hidden');
  document.getElementById('study-progress-fill').style.width = '100%';
  document.getElementById('study-score-btns').classList.add('hidden');
  document.getElementById('study-nav-btns').classList.remove('hidden');

  // Résumé
  const fail     = studyResults.filter(r => r.result === 'fail').length;
  const hesitant = studyResults.filter(r => r.result === 'hesitant').length;
  const success  = studyResults.filter(r => r.result === 'success').length;
  const total    = studyResults.length;
  const skipped  = studyCards.length - total;

  let summary = `${studyCards.length} carte${studyCards.length > 1 ? 's' : ''} révisée${studyCards.length > 1 ? 's' : ''}`;
  if (total > 0) summary += ` — ✓ ${success} &nbsp; ~ ${hesitant} &nbsp; ✗ ${fail}`;
  if (skipped > 0) summary += ` &nbsp; (${skipped} passée${skipped > 1 ? 's' : ''})`;

  document.getElementById('study-done-count').innerHTML = summary;
  document.getElementById('study-done').classList.remove('hidden');
}

function exitStudy() {
  document.getElementById('study-view').classList.add('hidden');
  if (currentSection === 'library') document.getElementById('folder-view').classList.remove('hidden');
  if (currentSection === 'dashboard') document.getElementById('dashboard-view').classList.remove('hidden');
  document.getElementById('study-done').classList.add('hidden');
  document.getElementById('study-deck').classList.remove('hidden');
  document.querySelector('.study-controls').classList.remove('hidden');
  document.getElementById('study-score-btns').classList.add('hidden');
  document.getElementById('study-nav-btns').classList.remove('hidden');
  document.body.classList.remove('in-study');
  render();
}

// ── EXPORT / IMPORT ───────────────────────────────────────────
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'cardii_export_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.folders || !Array.isArray(imported.folders)) throw new Error();
      if (!Array.isArray(imported.matieres)) imported.matieres = [];
      imported.matieres.forEach(m => {
        if (!state.matieres.some(existing => existing.id === m.id)) state.matieres.push(m);
      });
      if (state.matieres.length === 0) state.matieres.push({ id: uid(), name: 'Sans matière' });
      const fallback = state.matieres[0].id;
      const existingIds = new Set(state.folders.map(f => f.id));
      let added = 0;
      imported.folders.forEach(f => {
        if (!f.stats) f.stats = { sessions: 0, lastSession: null };
        if (!f.matiereId) f.matiereId = fallback;
        if (!existingIds.has(f.id)) { state.folders.push(f); added++; }
      });
      normalizeStateData();
      saveState();
      render();
      showToast(`Import réussi — ${added} dossier(s) ajouté(s)`);
    } catch { showToast('Fichier invalide', 'error'); }
  };
  reader.readAsText(file);
}

// ── GOOGLE DRIVE ─────────────────────────────────────────────
function driveInit() {
  const gsi    = document.createElement('script');
  gsi.src      = 'https://accounts.google.com/gsi/client';
  gsi.onload   = () => {
    driveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID, scope: DRIVE_SCOPE, callback: driveOnToken,
    });
    const saved = sessionStorage.getItem('cardii_drive_token');
    if (saved) { driveAccessToken = saved; driveSetStatus('connected'); driveLoad(); }
  };
  document.head.appendChild(gsi);

  const gapiScript  = document.createElement('script');
  gapiScript.src    = 'https://apis.google.com/js/api.js';
  gapiScript.onload = () => { gapi.load('picker', () => { pickerApiLoaded = true; }); };
  document.head.appendChild(gapiScript);
}

function driveConnect()    { if (!driveTokenClient) { showToast('Google non chargé, réessaie', 'error'); return; } driveTokenClient.requestAccessToken(); }
function driveDisconnect() {
  if (driveAccessToken) google.accounts.oauth2.revoke(driveAccessToken);
  driveAccessToken = null; driveFileId = null;
  sessionStorage.removeItem('cardii_drive_token');
  driveSetStatus('disconnected');
  showToast('Déconnecté de Google Drive');
}

function driveOnToken(response) {
  if (response.error) { driveSetStatus('error'); showToast('Connexion Drive échouée', 'error'); return; }
  driveAccessToken = response.access_token;
  sessionStorage.setItem('cardii_drive_token', driveAccessToken);
  driveSetStatus('connected');
  showToast('Connecté à Google Drive ✓');
  driveLoad();
}

function driveSetStatus(status) {
  driveStatus = status;
  const sidebarLabels = {
    disconnected: 'Connecter Drive',
    connected: 'Drive connecté',
    syncing: 'Synchronisation…',
    error: 'Erreur Drive',
  };
  const settingsLabels = {
    disconnected: 'Connecter Drive',
    connected: 'Déconnecter Drive',
    syncing: 'Synchronisation…',
    error: 'Erreur Drive',
  };
  const statusLabels = {
    disconnected: 'Drive déconnecté',
    connected: 'Drive connecté',
    syncing: 'Synchronisation en cours…',
    error: 'Erreur de connexion Drive',
  };
  const colors = { disconnected: 'var(--muted)', connected: '#4CAF50', syncing: 'var(--accent)', error: 'var(--danger)' };

  const sidebarBtn = document.getElementById('btn-drive');
  if (sidebarBtn) {
    sidebarBtn.textContent = sidebarLabels[status] || status;
    sidebarBtn.disabled = status === 'syncing';
    sidebarBtn.onclick = status === 'connected' ? driveDisconnect : driveConnect;
  }

  const sidebarDot = document.getElementById('drive-dot');
  if (sidebarDot) sidebarDot.style.background = colors[status] || 'var(--muted)';

  const connectBtn = document.getElementById('settings-drive-connect');
  if (connectBtn) {
    connectBtn.textContent = settingsLabels[status] || status;
    connectBtn.disabled = status === 'syncing';
  }

  const statusLabel = document.getElementById('settings-drive-label');
  if (statusLabel) statusLabel.textContent = statusLabels[status] || status;

  const settingsDot = document.getElementById('settings-drive-dot');
  if (settingsDot) settingsDot.style.background = colors[status] || 'var(--muted)';
}

async function driveFindOrCreateFile() {
  if (driveFileId) return driveFileId;
  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FILENAME}' and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${driveAccessToken}` } }
  );
  const data = await search.json();
  if (data.files && data.files.length > 0) { driveFileId = data.files[0].id; return driveFileId; }
  const meta = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${driveAccessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FILENAME, mimeType: 'application/json' }),
  });
  const file = await meta.json();
  driveFileId = file.id;
  return driveFileId;
}

async function driveLoad() {
  if (!driveAccessToken) return;
  driveSetStatus('syncing');
  try {
    const fileId = await driveFindOrCreateFile();
    const res    = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${driveAccessToken}` } });
    if (!res.ok) throw new Error();
    const text = await res.text();
    if (!text || text.trim() === '') { driveSetStatus('connected'); return; }
    const remote = JSON.parse(text);
    if (remote.folders && Array.isArray(remote.folders)) {
      if (Array.isArray(remote.matieres)) {
        remote.matieres.forEach(m => {
          if (!state.matieres.some(existing => existing.id === m.id)) state.matieres.push(m);
        });
      }
      const localIds = new Set(state.folders.map(f => f.id));
      remote.folders.forEach(f => {
        if (!f.stats) f.stats = { sessions: 0, lastSession: null };
        if (!localIds.has(f.id)) state.folders.push(f);
      });
      normalizeStateData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      showToast('Données Drive chargées ✓');
    }
    driveSetStatus('connected');
  } catch (e) { driveSetStatus('error'); showToast('Impossible de lire Drive', 'error'); }
}

async function driveSave() {
  if (!driveAccessToken) return;
  driveSetStatus('syncing');
  try {
    const fileId = await driveFindOrCreateFile();
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${driveAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(state, null, 2),
    });
    driveSetStatus('connected');
  } catch (e) { driveSetStatus('error'); showToast('Sauvegarde Drive échouée', 'error'); }
}

function driveOpenPicker() {
  if (!driveAccessToken) { showToast('Connecte-toi à Drive d\'abord', 'error'); return; }
  if (!pickerApiLoaded)  { showToast('Picker non chargé, réessaie dans 2s', 'error'); return; }
  const picker = new google.picker.PickerBuilder()
    .addView(new google.picker.DocsView().setMimeTypes('application/json').setMode(google.picker.DocsViewMode.LIST))
    .setOAuthToken(driveAccessToken)
    .setTitle('Choisir un fichier Cardii à importer')
    .setCallback(pickerCallback)
    .build();
  picker.setVisible(true);
}

async function pickerCallback(data) {
  if (data.action !== google.picker.Action.PICKED) return;
  const fileId = data.docs[0].id;
  driveSetStatus('syncing');
  try {
    const res      = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${driveAccessToken}` } });
    if (!res.ok) throw new Error();
    const imported = await res.json();
    if (!imported.folders || !Array.isArray(imported.folders)) throw new Error('Format invalide');
    if (Array.isArray(imported.matieres)) {
      imported.matieres.forEach(m => {
        if (!state.matieres.some(existing => existing.id === m.id)) state.matieres.push(m);
      });
    }
    if (state.matieres.length === 0) state.matieres.push({ id: uid(), name: 'Sans matière' });
    const fallback = state.matieres[0].id;
    const existingIds = new Set(state.folders.map(f => f.id));
    let added = 0;
    imported.folders.forEach(f => {
      if (!f.matiereId) f.matiereId = fallback;
      if (!existingIds.has(f.id)) { state.folders.push(f); added++; }
    });
    normalizeStateData();
    saveState(); render();
    showToast(`Import Drive réussi — ${added} dossier(s) ajouté(s)`);
    driveSetStatus('connected');
  } catch (e) { driveSetStatus('connected'); showToast('Fichier invalide ou illisible', 'error'); }
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.className = 'toast' + (type === 'error' ? ' toast-error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ── THEME ─────────────────────────────────────────────────────
const THEME_KEY = 'cardii_theme';
const ACCENT_KEY = 'cardii_accent';
const ACCENT_MAP = {
  gray:   { accent: '#9E9E9E', accentH: '#7E7E7E', btn: '#9E9E9E', btnH: '#7E7E7E' },
  brown:  { accent: '#A9745B', accentH: '#8A5C47', btn: '#A9745B', btnH: '#8A5C47' },
  orange: { accent: '#FF8A33', accentH: '#E67310', btn: '#FF8A33', btnH: '#E67310' },
  yellow: { accent: '#FFCA28', accentH: '#FFB300', btn: '#FFCA28', btnH: '#FFB300' },
  green:  { accent: '#4CAF50', accentH: '#388E3C', btn: '#4CAF50', btnH: '#388E3C' },
  blue:   { accent: '#2F76F3', accentH: '#235FCC', btn: '#2F76F3', btnH: '#235FCC' },
  purple: { accent: '#8E6CFF', accentH: '#715CFF', btn: '#8E6CFF', btnH: '#715CFF' },
  pink:   { accent: '#FF6FAF', accentH: '#FF3B8E', btn: '#FF6FAF', btnH: '#FF3B8E' },
  red:    { accent: '#E53935', accentH: '#C62828', btn: '#E53935', btnH: '#C62828' },
};

function getSavedAccent() { return localStorage.getItem(ACCENT_KEY) || 'blue'; }

function accentToRgb(hex) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function applyAccent(key) {
  const cfg = ACCENT_MAP[key] || ACCENT_MAP.blue;
  document.documentElement.style.setProperty('--accent', cfg.accent);
  document.documentElement.style.setProperty('--accent-h', cfg.accentH);
  document.documentElement.style.setProperty('--accent-rgb', accentToRgb(cfg.accent));
  document.documentElement.style.setProperty('--btn-primary-bg', cfg.btn);
  document.documentElement.style.setProperty('--btn-primary-h', cfg.btnH);
  document.querySelectorAll('.chart-fill').forEach(f => { f.style.background = cfg.accent; });
  document.querySelectorAll('.accent-swatch').forEach(btn => {
    btn.classList.toggle('selected', btn.getAttribute('data-accent') === key);
  });
  localStorage.setItem(ACCENT_KEY, key);
}
function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const sun  = document.querySelector('#btn-theme .icon-sun');
  const moon = document.querySelector('#btn-theme .icon-moon');
  if (sun && moon) { sun.classList.toggle('hidden', theme === 'dark'); moon.classList.toggle('hidden', theme !== 'dark'); }
  document.getElementById('btn-theme').title = theme === 'dark' ? 'Mode jour' : 'Mode nuit';
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ── MOBILE SIDEBAR ────────────────────────────────────────────
function openSidebar()  { document.getElementById('sidebar').classList.add('open'); document.getElementById('sidebar-backdrop').classList.remove('hidden'); document.body.classList.add('sidebar-open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebar-backdrop').classList.add('hidden'); document.body.classList.remove('sidebar-open'); }

// ── ESCAPE HTML ───────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── EVENTS ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getPreferredTheme());
  applyAccent(getSavedAccent());
  loadState();
  render();
  driveInit();

  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-settings-sidebar').addEventListener('click', openSettings);
  document.getElementById('btn-menu').addEventListener('click', openSidebar);
  document.getElementById('btn-close-sidebar').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => { if (window.innerWidth > 768) closeSidebar(); });

  driveSetStatus('disconnected');


  document.getElementById('btn-nav-library').addEventListener('click', () => switchSection('library'));
  document.getElementById('btn-nav-dashboard').addEventListener('click', () => switchSection('dashboard'));
  document.getElementById('dashboard-matiere-filter').addEventListener('change', e => onDashboardMatiereFilterChange(e.target.value));

  // Folders
  document.getElementById('btn-new-matiere').addEventListener('click', openNewMatiere);
  document.getElementById('btn-cancel-matiere').addEventListener('click', () => closeModal('modal-matiere'));
  document.getElementById('modal-matiere').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('modal-matiere'); });
  document.getElementById('btn-confirm-matiere').addEventListener('click', () => {
    const name = document.getElementById('input-matiere-name').value.trim();
    if (!name) return;
    createMatiere(name);
    closeModal('modal-matiere');
    showToast('Matière créée');
  });
  document.getElementById('btn-new-folder').addEventListener('click', openNewFolder);
  document.getElementById('btn-new-folder-main').addEventListener('click', openNewFolder);
  document.getElementById('btn-cancel-folder').addEventListener('click', () => closeModal('modal-folder'));
  document.getElementById('modal-folder').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('modal-folder'); });
  document.getElementById('btn-confirm-folder').addEventListener('click', () => {
    const name = document.getElementById('input-folder-name').value.trim();
    const matiereId = document.getElementById('input-folder-matiere').value;
    if (!name) return;
    if (!matiereId) return;
    createFolder(name, matiereId);
    closeModal('modal-folder');
  });
  document.getElementById('input-folder-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-confirm-folder').click();
    if (e.key === 'Escape') closeModal('modal-folder');
  });
  document.getElementById('folder-title').addEventListener('blur', e => renameActiveFolder(e.target.textContent));
  document.getElementById('folder-title').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  document.getElementById('btn-delete-folder').addEventListener('click', confirmDeleteFolder);

  // Cards
  document.getElementById('btn-add-card').addEventListener('click', openNewCard);
  document.getElementById('btn-cancel-card').addEventListener('click', () => closeModal('modal-card'));
  document.getElementById('modal-card').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('modal-card'); });
  document.getElementById('btn-confirm-card').addEventListener('click', () => {
    const front = document.getElementById('input-card-front').value.trim();
    const back  = document.getElementById('input-card-back').value.trim();
    if (!front || !back) return;
    if (editingCardId) updateCard(editingCardId, front, back);
    else createCard(front, back);
    closeModal('modal-card');
  });

  // Confirm delete
  document.getElementById('btn-cancel-confirm').addEventListener('click', () => closeModal('modal-confirm'));
  document.getElementById('modal-confirm').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('modal-confirm'); });
  document.getElementById('btn-do-confirm').addEventListener('click', () => {
    if (pendingDeleteType === 'folder') deleteFolder(pendingDeleteId);
    else if (pendingDeleteType === 'card') deleteCard(pendingDeleteId);
    pendingDeleteType = null; pendingDeleteId = null;
    closeModal('modal-confirm');
  });

  // Study
  document.getElementById('btn-study').addEventListener('click', startStudy);
  document.getElementById('btn-exit-study').addEventListener('click', exitStudy);
  document.getElementById('btn-exit-study-done').addEventListener('click', exitStudy);
  document.getElementById('btn-flip').addEventListener('click', flipStudyCard);
  document.getElementById('study-card').addEventListener('click', flipStudyCard);
  document.getElementById('btn-next').addEventListener('click', nextStudyCard);
  document.getElementById('btn-prev').addEventListener('click', prevStudyCard);
  document.getElementById('btn-restart').addEventListener('click', startStudy);

  // Score buttons
  document.getElementById('btn-score-fail').addEventListener('click', () => scoreCard('fail'));
  document.getElementById('btn-score-hesitant').addEventListener('click', () => scoreCard('hesitant'));
  document.getElementById('btn-score-success').addEventListener('click', () => scoreCard('success'));

  // Import / Export (paramètres uniquement)
  document.getElementById('import-file').addEventListener('change', e => {
    if (e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; }
  });

  // Settings modal
  document.getElementById('btn-cancel-settings').addEventListener('click', () => closeModal('modal-settings'));
  document.getElementById('modal-settings').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('modal-settings');
  });

  document.querySelectorAll('.accent-swatch').forEach(btn => {
    btn.addEventListener('click', () => applyAccent(btn.getAttribute('data-accent')));
  });

  document.getElementById('settings-drive-connect').addEventListener('click', () => {
    if (driveStatus === 'connected') driveDisconnect();
    else driveConnect();
  });
  document.getElementById('settings-export').addEventListener('click', exportData);
  document.getElementById('settings-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('settings-drive-import').addEventListener('click', driveOpenPicker);

  // Keyboard — révision
  document.addEventListener('keydown', e => {
    const inStudy = !document.getElementById('study-view').classList.contains('hidden');
    if (!inStudy) return;
    if (!studyFlipped) {
      if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); flipStudyCard(); }
      if (e.key === 'ArrowRight') nextStudyCard();
      if (e.key === 'ArrowLeft')  prevStudyCard();
    } else {
      if (e.key === '1') scoreCard('fail');
      if (e.key === '2') scoreCard('hesitant');
      if (e.key === '3') scoreCard('success');
    }
    if (e.key === 'Escape') exitStudy();
  });

  // Keyboard — fermer les modales avec Échap
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    ['modal-settings', 'modal-folder', 'modal-matiere', 'modal-card', 'modal-confirm'].forEach(id => {
      const modal = document.getElementById(id);
      if (modal && !modal.classList.contains('hidden')) closeModal(id);
    });
  });
});
