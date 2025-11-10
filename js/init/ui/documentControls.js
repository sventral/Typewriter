import {
  DEFAULT_DOCUMENT_TITLE,
  normalizeDocumentTitle,
  generateDocumentId,
  createDocumentRecord,
  loadDocumentIndexFromStorage,
  migrateLegacyDocument,
  persistDocuments,
} from '../../document/documentStore.js';
import { markDocumentDirty, hasPendingDocumentChanges, syncSavedRevision } from '../../state/saveRevision.js';

export function createDocumentControls({
  app,
  state,
  storageKey,
  focusStage,
  updateStageEnvironment,
  setZoomPercent,
  renderMargins,
  setMarginBoxesVisible,
  clampCaretToBounds,
  updateCaretPosition,
  positionRulers,
  requestVirtualization,
  requestHammerNudge,
  isZooming,
  createNewDocument,
  serializeState,
  deserializeState,
  getSaveTimer,
  setSaveTimer,
}) {
  const docState = { documents: [], activeId: null };
  const docMenuState = { open: false };
  let isEditingTitle = false;

  const docUpdatedFormatter = (() => {
    if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') {
      return null;
    }
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  })();

  function formatUpdatedAt(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return '';
    if (!docUpdatedFormatter) return '';
    try {
      return docUpdatedFormatter.format(new Date(ts));
    } catch {
      return '';
    }
  }

  function sortDocumentsInPlace() {
    docState.documents.sort((a, b) => {
      const au = Number(a?.updatedAt) || 0;
      const bu = Number(b?.updatedAt) || 0;
      return bu - au;
    });
  }

  function persistDocumentIndex() {
    sortDocumentsInPlace();
    persistDocuments(storageKey, docState);
  }

  function renderDocumentList() {
    if (!app.docMenuList) return;
    sortDocumentsInPlace();
    app.docMenuList.innerHTML = '';
    if (!docState.documents.length) {
      const empty = document.createElement('div');
      empty.className = 'doc-menu-empty';
      empty.textContent = 'No documents yet';
      app.docMenuList.appendChild(empty);
      return;
    }
    docState.documents.forEach((doc) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'doc-list-item';
      item.setAttribute('role', 'menuitem');
      item.dataset.id = doc.id;
      if (doc.id === docState.activeId) {
        item.classList.add('is-active');
      }
      const titleSpan = document.createElement('span');
      titleSpan.textContent = doc.title || DEFAULT_DOCUMENT_TITLE;
      item.appendChild(titleSpan);
      const updatedText = formatUpdatedAt(doc.updatedAt);
      if (updatedText) {
        const meta = document.createElement('span');
        meta.className = 'doc-updated';
        meta.textContent = updatedText;
        item.appendChild(meta);
      }
      app.docMenuList.appendChild(item);
    });
  }

  function ensureDocumentTitleInput() {
    if (!app.docTitleInput || isEditingTitle) return;
    app.docTitleInput.value = state.documentTitle || '';
  }

  function openDocMenu() {
    if (!app.docMenuPopup || docMenuState.open) return;
    app.docMenuPopup.classList.add('open');
    if (app.docMenuBtn) app.docMenuBtn.setAttribute('aria-expanded', 'true');
    docMenuState.open = true;
  }

  function closeDocMenu() {
    if (!app.docMenuPopup || !docMenuState.open) return;
    app.docMenuPopup.classList.remove('open');
    if (app.docMenuBtn) app.docMenuBtn.setAttribute('aria-expanded', 'false');
    docMenuState.open = false;
  }

  function toggleDocMenu() {
    if (docMenuState.open) closeDocMenu();
    else openDocMenu();
  }

  function getActiveDocument() {
    if (!docState.activeId) return null;
    return docState.documents.find((doc) => doc.id === docState.activeId) || null;
  }

  function refreshDocumentEnvironment() {
    updateStageEnvironment();
    setZoomPercent(Math.round((state.zoom || 1) * 100) || 100);
    renderMargins();
    setMarginBoxesVisible(state.showMarginBox);
    clampCaretToBounds();
    updateCaretPosition();
    positionRulers();
    document.body.classList.toggle('rulers-off', !state.showRulers);
    if (!isZooming()) requestHammerNudge();
    requestVirtualization();
  }

  function syncDocumentUi() {
    ensureDocumentTitleInput();
    renderDocumentList();
  }

  function applyDocumentRecord(doc) {
    if (!doc) return;
    doc.title = normalizeDocumentTitle(doc.title);
    let loaded = false;
    if (doc.data) {
      try {
        loaded = deserializeState(doc.data);
      } catch {
        loaded = false;
      }
    }
    if (!loaded) {
      createNewDocument({ documentId: doc.id, documentTitle: doc.title, skipSave: true });
    } else {
      state.documentId = doc.id;
      state.documentTitle = doc.title;
    }
    docState.activeId = doc.id;
    refreshDocumentEnvironment();
    syncDocumentUi();
    if (!loaded) {
      queueDirtySave();
    }
    focusStage();
  }

  function handleDocumentSelection(id) {
    if (!id || docState.activeId === id) {
      closeDocMenu();
      return;
    }
    saveStateNow();
    const nextDoc = docState.documents.find((record) => record.id === id);
    if (!nextDoc) {
      closeDocMenu();
      return;
    }
    applyDocumentRecord(nextDoc);
    closeDocMenu();
  }

  function handleCreateDocument() {
    saveStateNow();
    const now = Date.now();
    const existingIds = new Set(docState.documents.map((doc) => doc.id));
    const newId = generateDocumentId(existingIds);
    const newDoc = createDocumentRecord(
      {
        id: newId,
        title: DEFAULT_DOCUMENT_TITLE,
        createdAt: now,
        updatedAt: now,
        data: null,
      },
      existingIds,
    );
    docState.documents.push(newDoc);
    docState.activeId = newId;
    createNewDocument({ documentId: newId, documentTitle: newDoc.title, skipSave: true });
    newDoc.data = serializeState();
    persistDocumentIndex();
    applyDocumentRecord(newDoc);
    markDocumentDirty(state);
    saveStateNow();
    closeDocMenu();
  }

  function handleDeleteDocument() {
    const active = getActiveDocument();
    if (!active) return;
    const idx = docState.documents.findIndex((doc) => doc.id === active.id);
    if (idx < 0) return;
    docState.documents.splice(idx, 1);
    if (!docState.documents.length) {
      const existingIds = new Set();
      const blankId = generateDocumentId(existingIds);
      const blank = createDocumentRecord({ id: blankId, title: DEFAULT_DOCUMENT_TITLE }, existingIds);
      docState.documents.push(blank);
      docState.activeId = blank.id;
      createNewDocument({ documentId: blank.id, documentTitle: blank.title, skipSave: true });
      blank.data = serializeState();
      blank.createdAt = Date.now();
      blank.updatedAt = blank.createdAt;
      persistDocumentIndex();
      refreshDocumentEnvironment();
      syncDocumentUi();
      markDocumentDirty(state);
      saveStateNow();
      closeDocMenu();
      return;
    }
    const nextDoc = docState.documents[Math.min(idx, docState.documents.length - 1)];
    docState.activeId = nextDoc.id;
    persistDocumentIndex();
    applyDocumentRecord(nextDoc);
    closeDocMenu();
  }

  function handleDocumentTitleInput() {
    if (!app.docTitleInput) return;
    const raw = app.docTitleInput.value.slice(0, 200);
    state.documentTitle = raw;
    const active = getActiveDocument();
    if (active) {
      active.title = raw;
    }
    renderDocumentList();
  }

  function commitDocumentTitle() {
    if (!app.docTitleInput) return;
    const sanitized = normalizeDocumentTitle(app.docTitleInput.value);
    app.docTitleInput.value = sanitized;
    const active = getActiveDocument();
    state.documentTitle = sanitized;
    let changed = false;
    if (active) {
      const prev = normalizeDocumentTitle(active.title);
      if (prev !== sanitized) {
        active.title = sanitized;
        active.updatedAt = Date.now();
        changed = true;
      } else {
        active.title = sanitized;
      }
    }
    syncDocumentUi();
    if (changed) {
      markDocumentDirty(state);
      saveStateNow();
    } else {
      persistDocumentIndex();
    }
  }

  function exportToTextFile() {
    const out = [];
    for (let p = 0; p < state.pages.length; p++) {
      const page = state.pages[p];
      if (!page) {
        out.push('');
        continue;
      }
      const rows = Array.from(page.grid.keys()).sort((a, b) => a - b);
      if (!rows.length) {
        out.push('');
        continue;
      }
      for (let i = 0; i < rows.length; i++) {
        const rmu = rows[i];
        const rowMap = page.grid.get(rmu);
        let minCol = Infinity;
        let maxCol = -1;
        for (const c of rowMap.keys()) {
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
        }
        if (!isFinite(minCol) || maxCol < 0) {
          out.push('');
          continue;
        }
        let line = '';
        for (let c = minCol; c <= maxCol; c++) {
          const st = rowMap?.get(c);
          line += st && st.length ? st[st.length - 1].char : ' ';
        }
        out.push(line.replace(/\s+$/, ''));
      }
      if (p < state.pages.length - 1) out.push('');
    }
    const txt = out.join('\n');
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'typewriter.txt';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  }

  function queueDirtySave() {
    markDocumentDirty(state);
    saveStateDebounced();
  }

  function saveStateNow(options = {}) {
    const force = typeof options === 'object' && options !== null ? !!options.force : false;
    if (!force && !hasPendingDocumentChanges(state)) {
      return;
    }
    try {
      const serialized = serializeState();
      const activeId = typeof state.documentId === 'string' && state.documentId.trim()
        ? state.documentId.trim()
        : (docState.activeId || generateDocumentId(new Set(docState.documents.map((doc) => doc.id))));
      const title = normalizeDocumentTitle(serialized.documentTitle || state.documentTitle);
      const now = Date.now();
      let doc = docState.documents.find((d) => d.id === activeId);
      if (!doc) {
        doc = {
          id: activeId,
          title,
          createdAt: now,
          updatedAt: now,
          data: serialized,
        };
        docState.documents.push(doc);
      } else {
        doc.title = title;
        doc.updatedAt = now;
        doc.data = serialized;
        if (!Number.isFinite(doc.createdAt)) {
          doc.createdAt = now;
        }
      }
      state.documentId = activeId;
      state.documentTitle = title;
      docState.activeId = activeId;
      persistDocumentIndex();
      syncDocumentUi();
      syncSavedRevision(state);
    } catch {}
  }

  function saveStateDebounced(options = {}) {
    const force = typeof options === 'object' && options !== null ? !!options.force : false;
    if (!force && !hasPendingDocumentChanges(state)) {
      return;
    }
    const timer = getSaveTimer();
    if (timer) clearTimeout(timer);
    const newTimer = setTimeout(() => {
      setSaveTimer(0);
      saveStateNow();
    }, 400);
    setSaveTimer(newTimer);
  }

  function bindDocumentControls() {
    if (app.docMenuBtn) {
      app.docMenuBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleDocMenu();
      });
    }
    if (app.docMenuPopup) {
      app.docMenuPopup.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    if (app.docMenuList) {
      app.docMenuList.addEventListener('click', (e) => {
        const item = e.target.closest('.doc-list-item');
        if (!item) return;
        e.preventDefault();
        handleDocumentSelection(item.dataset.id || '');
      });
    }
    if (app.docTitleInput) {
      app.docTitleInput.addEventListener('focus', () => {
        isEditingTitle = true;
      });
      app.docTitleInput.addEventListener('blur', () => {
        isEditingTitle = false;
        commitDocumentTitle();
      });
      app.docTitleInput.addEventListener('input', handleDocumentTitleInput);
      app.docTitleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          app.docTitleInput.blur();
        }
      });
    }
    if (app.deleteDocBtn) {
      app.deleteDocBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleDeleteDocument();
      });
    }
    if (app.newDocBtn) {
      app.newDocBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCreateDocument();
      });
    }
    if (app.exportBtn) {
      app.exportBtn.addEventListener('click', exportToTextFile);
    }
    document.addEventListener('pointerdown', (e) => {
      if (!docMenuState.open) return;
      if (app.docMenuPopup?.contains(e.target) || app.docMenuBtn?.contains(e.target)) return;
      closeDocMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDocMenu();
      }
    });
  }

  function loadPersistedState() {
    let savedFont = null;
    let loaded = false;
    const { documents, activeId } = loadDocumentIndexFromStorage(storageKey);
    docState.documents = documents;
    sortDocumentsInPlace();
    docState.activeId = activeId || (documents[0]?.id ?? null);

    let activeDoc = getActiveDocument();
    if (!activeDoc && docState.documents.length) {
      activeDoc = docState.documents[0];
      docState.activeId = activeDoc.id;
    }

    if (!activeDoc) {
      const migrated = migrateLegacyDocument(storageKey);
      if (migrated) {
        docState.documents.push(migrated);
        docState.activeId = migrated.id;
        activeDoc = migrated;
        persistDocumentIndex();
      }
    }

    if (activeDoc && activeDoc.data) {
      try {
        loaded = deserializeState(activeDoc.data);
        savedFont = activeDoc.data.fontName || null;
      } catch {
        loaded = false;
      }
    }

    if (!activeDoc) {
      const existingIds = new Set(docState.documents.map((doc) => doc.id));
      const blankId = generateDocumentId(existingIds);
      const blank = createDocumentRecord({ id: blankId, title: DEFAULT_DOCUMENT_TITLE }, existingIds);
      docState.documents.push(blank);
      docState.activeId = blank.id;
      createNewDocument({ documentId: blank.id, documentTitle: blank.title, skipSave: true });
      blank.data = serializeState();
      blank.createdAt = Date.now();
      blank.updatedAt = blank.createdAt;
      persistDocumentIndex();
      loaded = false;
      state.documentId = blank.id;
      state.documentTitle = blank.title;
    } else if (!loaded) {
      createNewDocument({ documentId: activeDoc.id, documentTitle: activeDoc.title, skipSave: true });
      state.documentId = activeDoc.id;
      state.documentTitle = normalizeDocumentTitle(activeDoc.title);
    } else {
      state.documentId = activeDoc.id;
      state.documentTitle = normalizeDocumentTitle(activeDoc.title);
    }

    renderDocumentList();
    ensureDocumentTitleInput();

    return {
      loaded,
      savedFont,
      documents: docState.documents.map((doc) => ({ ...doc })),
      activeDocumentId: docState.activeId,
    };
  }

  function populateDocumentUI({ documents, activeDocumentId } = {}) {
    if (Array.isArray(documents)) {
      docState.documents = documents.map((doc) => ({ ...doc }));
      sortDocumentsInPlace();
    }
    if (activeDocumentId) {
      docState.activeId = activeDocumentId;
    }
    syncDocumentUi();
  }

  return {
    bindDocumentControls,
    loadPersistedState,
    populateDocumentUI,
    saveStateNow,
    saveStateDebounced,
    docState,
  };
}
