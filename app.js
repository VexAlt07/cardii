/* ═══════════════════════════════════════════════════════════════
   Cardii — Flash Cards App
   Storage: localStorage  |  Export/Import: JSON  |  Sync: Google Drive
═══════════════════════════════════════════════════════════════ */

// ── GOOGLE DRIVE CONFIG ──────────────────────────────────────
const DRIVE_CLIENT_ID = '181622455685-nq5qsa7b3rmf3gdcp1sl9pr33bt57g4n.apps.googleusercontent.com';
const DRIVE_SCOPE     = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILENAME  = 'cardii_data.json';

let driveTokenClient = null;
let driveAccessToken = null;
let driveFileId      = null;  // ID du fichier sur Drive
let driveStatus      = 'disconnected'; // 'disconnected' | 'connected' | 'syncing' | 'error'

// ── STATE ────────────────────────────────────────────────────
let state = {
  folders: [],
  activeFolderId: null,
};

let editingCardId    = null;
let pendingDeleteType = null;
let pendingDeleteId  = null;

// Study state
let studyCards  = [];
let studyIndex  = 0;
let studyFlipped = false;

// ── STORAGE (localStorage) ───────────────────────────────────
const STORAGE_KEY        = 'cardii_data';
const LEGACY_STORAGE_KEY = 'kartis_data';

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  // Auto-sync Drive si connecté
  if (driveStatus === 'connected') driveSave();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch (e) { /* ignore */ }
}

// ── HELPERS ──────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getActiveFolder() {
  return state.folders.find(f => f.id === state.activeFolderId) || null;
}

// ── RENDER ───────────────────────────────────────────────────
function render() {
  renderSidebar();
  renderMain();
}

function renderSidebar() {
  const list = document.getElementById('folder-list');
  list.innerHTML = '';

  if (state.folders.length === 0) {
    list.innerHTML = '<p style="font-size:12.5px;color:var(--muted);padding:12px 16px;">Aucun dossier</p>';
    return;
  }

  state.folders.forEach(folder => {
    const item = document.createElement('div');
    item.className = 'folder-item' + (folder.id === state.activeFolderId ? ' active' : '');
    item.innerHTML = `
      <span class="folder-icon">▫</span>
      <span class="folder-item-name">${esc(folder.name)}</span>
      <span class="folder-count">${folder.cards.length}</span>
    `;
    item.addEventListener('click', () => selectFolder(folder.id));
    list.appendChild(item);
  });
}

function renderMain() {
  const folder  = getActiveFolder();
  const isEmpty = !folder;
  const inStudy = !document.getElementById('study-view').classList.contains('hidden');

  document.getElementById('empty-state').classList.toggle('hidden', !isEmpty);
  document.getElementById('folder-view').classList.toggle('hidden', isEmpty || inStudy);

  if (!isEmpty && !inStudy) renderFolderView(folder);
}

function renderFolderView(folder) {
  document.getElementById('folder-title').textContent = folder.name;
  const count = folder.cards.length;
  document.getElementById('card-count').textContent =
    count === 0 ? 'Aucune carte' : `${count} carte${count > 1 ? 's' : ''}`;

  const grid = document.getElementById('cards-grid');
  grid.innerHTML = '';

  document.getElementById('no-cards').classList.toggle('hidden', count > 0);
  grid.classList.toggle('hidden', count === 0);

  folder.cards.forEach(card => {
    const tile = document.createElement('div');
    tile.className = 'card-tile';
    tile.innerHTML = `
      <div class="card-tile-front">${esc(card.front)}</div>
      <div class="card-tile-back">${esc(card.back)}</div>
      <div class="card-tile-actions">
        <button class="card-action-btn" data-edit="${card.id}">Modifier</button>
        <button class="card-action-btn danger" data-delete="${card.id}">Supprimer</button>
      </div>
    `;
    tile.querySelector('[data-edit]').addEventListener('click', e => { e.stopPropagation(); openEditCard(card.id); });
    tile.querySelector('[data-delete]').addEventListener('click', e => { e.stopPropagation(); confirmDeleteCard(card.id); });
    grid.appendChild(tile);
  });
}

// ── FOLDER ACTIONS ────────────────────────────────────────────
function selectFolder(id) {
  state.activeFolderId = id;
  exitStudy();
  render();
  if (window.innerWidth <= 768) closeSidebar();
}

function createFolder(name) {
  const folder = { id: uid(), name: name.trim(), cards: [] };
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
  folder.cards.push({ id: uid(), front: front.trim(), back: back.trim() });
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

// ── MODALS ────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function openNewFolder() {
  document.getElementById('input-folder-name').value = '';
  openModal('modal-folder');
  setTimeout(() => document.getElementById('input-folder-name').focus(), 50);
}

function openNewCard() {
  editingCardId = null;
  document.getElementById('modal-card-title').textContent = 'Nouvelle carte';
  document.getElementById('input-card-front').value = '';
  document.getElementById('input-card-back').value = '';
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
  document.getElementById('modal-confirm-title').textContent = 'Supprimer le dossier ?';
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

  studyCards   = [...folder.cards].sort(() => Math.random() - 0.5);
  studyIndex   = 0;
  studyFlipped = false;

  document.getElementById('folder-view').classList.add('hidden');
  document.getElementById('study-done').classList.add('hidden');
  document.getElementById('study-deck').classList.remove('hidden');
  document.querySelector('.study-controls').classList.remove('hidden');
  document.getElementById('study-view').classList.remove('hidden');
  document.body.classList.add('in-study');

  updateStudyCard();
}

function updateStudyCard() {
  const card = studyCards[studyIndex];
  document.getElementById('study-front').textContent = card.front;
  document.getElementById('study-back').textContent  = card.back;

  studyFlipped = false;
  document.getElementById('study-card').classList.remove('flipped');

  const pct = (studyIndex / studyCards.length) * 100;
  document.getElementById('study-progress-fill').style.width = pct + '%';
  document.getElementById('study-progress-text').textContent = `${studyIndex + 1} / ${studyCards.length}`;

  document.getElementById('btn-prev').disabled = studyIndex === 0;
}

function flipStudyCard() {
  studyFlipped = !studyFlipped;
  document.getElementById('study-card').classList.toggle('flipped', studyFlipped);
}

function nextStudyCard() {
  if (studyIndex < studyCards.length - 1) { studyIndex++; updateStudyCard(); }
  else finishStudy();
}

function prevStudyCard() {
  if (studyIndex > 0) { studyIndex--; updateStudyCard(); }
}

function finishStudy() {
  document.getElementById('study-deck').classList.add('hidden');
  document.querySelector('.study-controls').classList.add('hidden');
  document.getElementById('study-progress-fill').style.width = '100%';
  document.getElementById('study-done-count').textContent =
    `Tu as révisé ${studyCards.length} carte${studyCards.length > 1 ? 's' : ''}.`;
  document.getElementById('study-done').classList.remove('hidden');
}

function exitStudy() {
  document.getElementById('study-view').classList.add('hidden');
  document.getElementById('folder-view').classList.remove('hidden');
  document.getElementById('study-done').classList.add('hidden');
  document.getElementById('study-deck').classList.remove('hidden');
  document.querySelector('.study-controls').classList.remove('hidden');
  document.body.classList.remove('in-study');
}

// ── EXPORT / IMPORT (JSON local) ─────────────────────────────
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
      const existingIds = new Set(state.folders.map(f => f.id));
      let added = 0;
      imported.folders.forEach(f => {
        if (!existingIds.has(f.id)) { state.folders.push(f); added++; }
      });
      saveState();
      render();
      showToast(`Import réussi — ${added} dossier(s) ajouté(s)`);
    } catch {
      showToast('Fichier invalide', 'error');
    }
  };
  reader.readAsText(file);
}

// ── GOOGLE DRIVE ─────────────────────────────────────────────

function driveInit() {
  // Charge le script Google Identity Services
  const script  = document.createElement('script');
  script.src    = 'https://accounts.google.com/gsi/client';
  script.onload = () => {
    driveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope:     DRIVE_SCOPE,
      callback:  driveOnToken,
    });
    // Tente de restaurer le token depuis sessionStorage
    const saved = sessionStorage.getItem('cardii_drive_token');
    if (saved) {
      driveAccessToken = saved;
      driveSetStatus('connected');
      driveLoad(); // Charge les données depuis Drive au démarrage
    }
  };
  document.head.appendChild(script);
}

function driveConnect() {
  if (!driveTokenClient) { showToast('Google non chargé, réessaie dans 2s', 'error'); return; }
  driveTokenClient.requestAccessToken();
}

function driveDisconnect() {
  if (driveAccessToken) google.accounts.oauth2.revoke(driveAccessToken);
  driveAccessToken = null;
  driveFileId      = null;
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
  const btn   = document.getElementById('btn-drive');
  const dot   = document.getElementById('drive-dot');
  if (!btn) return;

  const labels = {
    disconnected: 'Connecter Drive',
    connected:    'Drive connecté',
    syncing:      'Synchronisation…',
    error:        'Erreur Drive',
  };
  const colors = {
    disconnected: 'var(--muted)',
    connected:    '#4CAF50',
    syncing:      'var(--accent)',
    error:        'var(--danger)',
  };

  btn.textContent = labels[status] || status;
  if (dot) dot.style.background = colors[status] || 'var(--muted)';
  btn.onclick = status === 'connected' ? driveDisconnect : driveConnect;
}

// Trouve ou crée le fichier cardii_data.json sur Drive
async function driveFindOrCreateFile() {
  if (driveFileId) return driveFileId;

  // Cherche le fichier existant
  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FILENAME}' and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${driveAccessToken}` } }
  );
  const data = await search.json();

  if (data.files && data.files.length > 0) {
    driveFileId = data.files[0].id;
    return driveFileId;
  }

  // Crée le fichier s'il n'existe pas
  const meta = await fetch('https://www.googleapis.com/drive/v3/files', {
    method:  'POST',
    headers: { Authorization: `Bearer ${driveAccessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: DRIVE_FILENAME, mimeType: 'application/json' }),
  });
  const file = await meta.json();
  driveFileId = file.id;
  return driveFileId;
}

// Charge les données depuis Drive (au démarrage)
async function driveLoad() {
  if (!driveAccessToken) return;
  driveSetStatus('syncing');
  try {
    const fileId = await driveFindOrCreateFile();
    const res    = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${driveAccessToken}` } }
    );
    if (!res.ok) throw new Error('Lecture échouée');
    const text = await res.text();
    if (!text || text.trim() === '') { driveSetStatus('connected'); return; } // Fichier vide = nouveau

    const remote = JSON.parse(text);
    if (remote.folders && Array.isArray(remote.folders)) {
      // Fusionne : les dossiers Drive + local sans doublons
      const localIds = new Set(state.folders.map(f => f.id));
      remote.folders.forEach(f => { if (!localIds.has(f.id)) state.folders.push(f); });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      showToast('Données Drive chargées ✓');
    }
    driveSetStatus('connected');
  } catch (e) {
    driveSetStatus('error');
    showToast('Impossible de lire Drive', 'error');
  }
}

// Sauvegarde les données sur Drive
async function driveSave() {
  if (!driveAccessToken) return;
  driveSetStatus('syncing');
  try {
    const fileId = await driveFindOrCreateFile();
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method:  'PATCH',
      headers: {
        Authorization:  `Bearer ${driveAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(state, null, 2),
    });
    driveSetStatus('connected');
  } catch (e) {
    driveSetStatus('error');
    showToast('Sauvegarde Drive échouée', 'error');
  }
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id    = 'toast';
  t.className = 'toast' + (type === 'error' ? ' toast-error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('toast-show'), 10);
  setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ── THEME ─────────────────────────────────────────────────────
const THEME_KEY = 'cardii_theme';

function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const sun  = document.querySelector('#btn-theme .icon-sun');
  const moon = document.querySelector('#btn-theme .icon-moon');
  if (sun && moon) {
    sun.classList.toggle('hidden', theme === 'dark');
    moon.classList.toggle('hidden', theme !== 'dark');
  }
  document.getElementById('btn-theme').title = theme === 'dark' ? 'Mode jour' : 'Mode nuit';
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ── MOBILE SIDEBAR ────────────────────────────────────────────
function openSidebar()  {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.remove('hidden');
  document.body.classList.add('sidebar-open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.add('hidden');
  document.body.classList.remove('sidebar-open');
}

// ── ESCAPE HTML ───────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── EVENTS ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getPreferredTheme());
  loadState();
  render();
  driveInit();

  // Theme
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);

  // Mobile sidebar
  document.getElementById('btn-menu').addEventListener('click', openSidebar);
  document.getElementById('btn-close-sidebar').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => { if (window.innerWidth > 768) closeSidebar(); });

  // Drive button (status géré par driveSetStatus)
  driveSetStatus('disconnected');

  // Folders
  document.getElementById('btn-new-folder').addEventListener('click', openNewFolder);
  document.getElementById('btn-new-folder-main').addEventListener('click', openNewFolder);

  document.getElementById('btn-cancel-folder').addEventListener('click', () => closeModal('modal-folder'));
  document.getElementById('modal-folder').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal('modal-folder'); });
  document.getElementById('btn-confirm-folder').addEventListener('click', () => {
    const name = document.getElementById('input-folder-name').value.trim();
    if (!name) return;
    createFolder(name);
    closeModal('modal-folder');
  });
  document.getElementById('input-folder-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-confirm-folder').click();
    if (e.key === 'Escape') closeModal('modal-folder');
  });

  document.getElementById('folder-title').addEventListener('blur', e => renameActiveFolder(e.target.textContent));
  document.getElementById('folder-title').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
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

  // Export / Import
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', e => {
    if (e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; }
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    const inStudy = !document.getElementById('study-view').classList.contains('hidden');
    if (!inStudy) return;
    if (e.key === 'ArrowRight') nextStudyCard();
    if (e.key === 'ArrowLeft')  prevStudyCard();
    if (e.key === ' ') { e.preventDefault(); flipStudyCard(); }
    if (e.key === 'Escape') exitStudy();
  });
});