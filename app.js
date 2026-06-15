<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cardii — Flash Cards</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>

  <!-- MOBILE MENU BUTTON -->
  <button id="btn-menu" class="icon-btn mobile-menu-btn" title="Menu" aria-label="Ouvrir le menu">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
  </button>

  <!-- SIDEBAR BACKDROP (mobile) -->
  <div id="sidebar-backdrop" class="sidebar-backdrop hidden"></div>

  <!-- SIDEBAR -->
  <aside id="sidebar">
    <div class="sidebar-header">
      <span class="logo">Cardii</span>
      <div class="sidebar-header-actions">
        <button id="btn-theme" class="icon-btn" title="Mode nuit" aria-label="Basculer le thème">
          <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          <svg class="icon-moon hidden" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
        <button id="btn-new-folder" class="icon-btn" title="Nouveau dossier">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <button id="btn-close-sidebar" class="icon-btn mobile-only" title="Fermer" aria-label="Fermer le menu">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
    <nav id="folder-list"></nav>
    <div class="sidebar-footer">
      <div class="drive-row">
        <span id="drive-dot" class="drive-dot"></span>
        <button id="btn-drive" class="text-btn drive-btn">Connecter Drive</button>
      </div>
      <div class="sidebar-footer-row">
        <button id="btn-export" class="text-btn">↓ Exporter</button>
        <button id="btn-import" class="text-btn">↑ Importer</button>
        <input type="file" id="import-file" accept=".json" style="display:none" />
      </div>
      <button id="btn-drive-import" class="text-btn drive-import-btn">↑ Drive → Importer</button>
    </div>
  </aside>

  <!-- MAIN -->
  <main id="main">

    <!-- EMPTY STATE -->
    <div id="empty-state">
      <p class="empty-icon">⬡</p>
      <h2>Aucun dossier sélectionné</h2>
      <p>Crée un dossier pour commencer à organiser tes flash cards.</p>
      <button class="btn-primary" id="btn-new-folder-main">Nouveau dossier</button>
    </div>

    <!-- FOLDER VIEW -->
    <div id="folder-view" class="hidden">
      <header class="folder-header">
        <div>
          <span class="folder-label">Dossier</span>
          <h1 id="folder-title" class="folder-name" contenteditable="true" spellcheck="false"></h1>
        </div>
        <div class="folder-actions">
          <button id="btn-study" class="btn-primary">Réviser</button>
          <button id="btn-add-card" class="btn-secondary">+ Carte</button>
          <button id="btn-delete-folder" class="icon-btn danger" title="Supprimer le dossier">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </header>

      <div id="card-count" class="card-meta"></div>

      <div id="cards-grid"></div>

      <div id="no-cards" class="hidden">
        <p>Ce dossier est vide. Ajoute ta première carte !</p>
      </div>
    </div>

    <!-- STUDY MODE -->
    <div id="study-view" class="hidden">
      <header class="study-header">
        <button id="btn-exit-study" class="text-btn">← Retour</button>
        <div id="study-progress-wrap">
          <span id="study-progress-text"></span>
          <div id="study-progress-bar"><div id="study-progress-fill"></div></div>
        </div>
      </header>

      <div id="study-deck">
        <div id="study-card" class="flip-card">
          <div class="flip-card-inner">
            <div class="flip-card-front">
              <span class="card-side-label">Question</span>
              <p id="study-front"></p>
            </div>
            <div class="flip-card-back">
              <span class="card-side-label">Réponse</span>
              <p id="study-back"></p>
            </div>
          </div>
        </div>
        <p class="study-hint">Cliquer pour retourner</p>
      </div>

      <div class="study-controls">
        <button id="btn-prev" class="btn-secondary">←</button>
        <button id="btn-flip" class="btn-primary">Retourner</button>
        <button id="btn-next" class="btn-secondary">→</button>
      </div>

      <div id="study-done" class="hidden">
        <p class="done-emoji">✓</p>
        <h2>Révision terminée !</h2>
        <p id="study-done-count"></p>
        <button id="btn-restart" class="btn-primary">Recommencer</button>
        <button id="btn-exit-study-done" class="text-btn">Retour au dossier</button>
      </div>
    </div>

  </main>

  <!-- MODALS -->

  <!-- New Folder Modal -->
  <div id="modal-folder" class="modal-overlay hidden">
    <div class="modal">
      <h3>Nouveau dossier</h3>
      <input type="text" id="input-folder-name" placeholder="Ex : Mathématiques" class="modal-input" />
      <div class="modal-actions">
        <button class="text-btn" id="btn-cancel-folder">Annuler</button>
        <button class="btn-primary" id="btn-confirm-folder">Créer</button>
      </div>
    </div>
  </div>

  <!-- New/Edit Card Modal -->
  <div id="modal-card" class="modal-overlay hidden">
    <div class="modal modal-lg">
      <h3 id="modal-card-title">Nouvelle carte</h3>
      <label class="modal-label">Question (recto)</label>
      <textarea id="input-card-front" class="modal-textarea" placeholder="Qu'est-ce que la photosynthèse ?"></textarea>
      <label class="modal-label">Réponse (verso)</label>
      <textarea id="input-card-back" class="modal-textarea" placeholder="Processus par lequel les plantes..."></textarea>
      <div class="modal-actions">
        <button class="text-btn" id="btn-cancel-card">Annuler</button>
        <button class="btn-primary" id="btn-confirm-card">Enregistrer</button>
      </div>
    </div>
  </div>

  <!-- Confirm Delete Modal -->
  <div id="modal-confirm" class="modal-overlay hidden">
    <div class="modal">
      <h3 id="modal-confirm-title">Supprimer ?</h3>
      <p id="modal-confirm-msg" class="modal-confirm-msg"></p>
      <div class="modal-actions">
        <button class="text-btn" id="btn-cancel-confirm">Annuler</button>
        <button class="btn-danger" id="btn-do-confirm">Supprimer</button>
      </div>
    </div>
  </div>

  <script src="app.js"></script>
</body>
</html>
