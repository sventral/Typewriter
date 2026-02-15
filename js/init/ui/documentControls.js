import {
  DEFAULT_DOCUMENT_TITLE,
  normalizeDocumentTitle,
  generateDocumentId,
  createDocumentRecord,
  loadDocumentIndexFromStorage,
  migrateLegacyDocument,
  persistDocuments,
  loadDocumentDataById,
  estimateDocumentDataBytes,
} from '../../document/documentStore.js';
import { getPaperSize, normalizePaperSizeId, DEFAULT_PAPER_SIZE } from '../../config/paperSizes.js';
import {
  markDocumentDirty,
  hasPendingDocumentChanges,
  syncSavedRevision,
  getDirtyPageIndices as getTrackedDirtyPageIndices,
  syncSavedPageRevisions as syncTrackedPageRevisions,
} from '../../state/saveRevision.js';
import { refreshSavedInkStylesUI, hydrateInkSettingsFromState } from '../../config/ink/inkSettingsView.js';
import { createExportDialog } from './exportDialog.js';
import { exportDocumentAsPdf } from '../../export/pdfExporter.js';
import { detectCanvasDimensionLimit, DEFAULT_CANVAS_DIMENSION_CAP } from '../../init/environment.js';
import { createDropboxSyncController } from '../../storage/dropboxSync.js';

export function createDocumentControls({
  app,
  state,
  storageKey,
  focusStage,
  updateStageEnvironment,
  setRenderScaleForZoom,
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
  serializeStateBase,
  serializePageState,
  getDirtyPageIndices,
  syncSavedPageRevisions,
  deserializeState,
  getSaveTimer,
  setSaveTimer,
  schedulePaint,
  lifecycleController,
}) {
  const docState = { documents: [], activeId: null };
  const docMenuState = { open: false };
  let isEditingTitle = false;
  let lastSaveNowTs = 0;
  let storageNoticeTimer = 0;
  const LARGE_DOC_SIZE_WARNING = 4.5 * 1024 * 1024; // ~4.5 MB
  let pdfExportInProgress = false;
  let pdfExportRestoreState = null;
  let pdfVisualMaskRestore = null;
  let pdfOverlayStartTs = 0;
  let suppressDropboxAutoSync = false;

  const waitForOverlayPaint = () => new Promise((resolve) => {
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    raf(() => raf(resolve));
  });

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

  const exportDialog = createExportDialog({
    app,
    onExportRaw: exportDocumentData,
    onExportPlain: exportPlainTextFile,
    onExportPdf: exportPdfFile,
  });

  function clearStorageNotice() {
    if (storageNoticeTimer) {
      clearTimeout(storageNoticeTimer);
      storageNoticeTimer = 0;
    }
    if (app.storageNotice) {
      app.storageNotice.textContent = '';
      app.storageNotice.classList.remove('is-visible', 'is-error');
    }
  }

  function showStorageNotice(message, options = {}) {
    if (!app.storageNotice || !message) return;
    const durationMs = Number.isFinite(options.durationMs) ? options.durationMs : 5000;
    const isError = options.level === 'error';
    app.storageNotice.textContent = message;
    app.storageNotice.classList.toggle('is-error', !!isError);
    app.storageNotice.classList.add('is-visible');
    if (storageNoticeTimer) clearTimeout(storageNoticeTimer);
    storageNoticeTimer = setTimeout(() => {
      app.storageNotice?.classList.remove('is-visible', 'is-error');
      storageNoticeTimer = 0;
    }, durationMs);
  }

  async function warnIfApproachingQuota(nextBytes, previousBytes = 0) {
    if (!navigator?.storage?.estimate || !Number.isFinite(nextBytes)) return;
    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (!quota || usage == null) return;
      const projected = usage + Math.max(0, nextBytes - (previousBytes || 0));
      const fill = projected / quota;
      if (fill >= 0.98) {
        showStorageNotice('Storage is full. Export or delete documents before continuing.', { level: 'error', durationMs: 9000 });
      } else if (fill >= 0.9) {
        showStorageNotice('Storage almost full. Consider exporting or deleting older documents.', { level: 'error', durationMs: 8000 });
      } else if (fill >= 0.8) {
        showStorageNotice('Storage is getting tight. Export large documents to avoid data loss.', { durationMs: 6500 });
      }
    } catch {}
  }

  function formatUpdatedAt(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return '';
    if (!docUpdatedFormatter) return '';
    try {
      return docUpdatedFormatter.format(new Date(ts));
    } catch {
      return '';
    }
  }

  function buildExportFileName({ suffix, ext }) {
    const normalized = normalizeDocumentTitle(state.documentTitle || DEFAULT_DOCUMENT_TITLE);
    const slug = normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'typewriter';
    const stamp = new Date().toISOString().replace(/[:]/g, '-').replace('T', '_').split('.')[0];
    const parts = [slug, suffix, stamp].filter(Boolean);
    return `${parts.join('-')}.${ext}`;
  }

  function downloadBlob(blob, filename) {
    if (!blob || !filename) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  }

  function beginPdfExportUi(message = 'Preparing PDF…', previewUrl) {
    if (pdfExportInProgress) return;
    pdfExportInProgress = true;
    state.pdfExportActive = true;
    pdfExportRestoreState = {
      noticeText: app.lagNotice?.textContent,
      btnDisabled: app.exportPdfBtn?.disabled,
      lagPreview: app.lagOverlay?.style?.getPropertyValue('--lag-preview-url') || '',
    };
    pdfOverlayStartTs = performance.now ? performance.now() : Date.now();
    if (app.exportPdfBtn) {
      app.exportPdfBtn.disabled = true;
      app.exportPdfBtn.textContent = 'Exporting…';
    }
    if (app.lagNotice) {
      app.lagNotice.textContent = message;
      app.lagNotice.classList.add('lag-notice--visible');
      app.lagNotice.setAttribute('aria-hidden', 'false');
    }
    if (app.lagOverlay) {
      if (previewUrl) {
        app.lagOverlay.style.setProperty('--lag-preview-url', `url("${previewUrl}")`);
      }
      app.lagOverlay.classList.add('lag-overlay--visible', 'lag-overlay--export');
      app.lagOverlay.setAttribute('aria-hidden', 'false');
      app.lagOverlay.dataset.phase = 'export';
    }
  }

  function endPdfExportUi(finalText) {
    if (!pdfExportInProgress) return;
    const restore = pdfExportRestoreState || {};
    if (app.exportPdfBtn) {
      app.exportPdfBtn.disabled = restore.btnDisabled || false;
      app.exportPdfBtn.textContent = 'Save as PDF';
    }
    if (app.lagNotice) {
      app.lagNotice.textContent = finalText || restore.noticeText || '';
    }

    const minVisibleMs = 1200;
    const elapsed = (performance.now ? performance.now() : Date.now()) - pdfOverlayStartTs;
    const hideDelay = Math.max(0, minVisibleMs - elapsed);

    setTimeout(() => {
      if (app.lagOverlay) {
        app.lagOverlay.classList.remove('lag-overlay--visible', 'lag-overlay--export');
        app.lagOverlay.setAttribute('aria-hidden', 'true');
        app.lagOverlay.dataset.phase = 'idle';
        if (restore.lagPreview) {
          app.lagOverlay.style.setProperty('--lag-preview-url', restore.lagPreview);
        } else {
          app.lagOverlay.style.removeProperty('--lag-preview-url');
        }
      }
      if (app.lagNotice) {
        app.lagNotice.classList.remove('lag-notice--visible');
        app.lagNotice.setAttribute('aria-hidden', 'true');
        app.lagNotice.textContent = restore.noticeText || '';
      }
      pdfExportInProgress = false;
      pdfExportRestoreState = null;
      state.pdfExportActive = false;
    }, hideDelay);
  }

  function makeStagePreview() {
    if (!app?.stage) return null;
    const vpW = Math.max(10, Math.round(window.innerWidth || document.documentElement.clientWidth || 800));
    const vpH = Math.max(10, Math.round(window.innerHeight || document.documentElement.clientHeight || 600));
    const stageRect = app.stage.getBoundingClientRect();
    const width = vpW;
    const height = vpH;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const bodyBg = getComputedStyle(document.body).backgroundColor || '#111';
    ctx.fillStyle = bodyBg;
    ctx.fillRect(0, 0, width, height);

    // draw stage background
    const stageBg = getComputedStyle(app.stage).backgroundColor || bodyBg;
    ctx.fillStyle = stageBg;
    const sx = Math.round(stageRect.left);
    const sy = Math.round(stageRect.top);
    ctx.fillRect(sx, sy, Math.round(stageRect.width), Math.round(stageRect.height));

    if (Array.isArray(state.pages)) {
      for (const page of state.pages) {
        const c = page?.canvas;
        if (!c || !c.getBoundingClientRect) continue;
        const rect = c.getBoundingClientRect();
        const dstW = Math.max(1, Math.round(rect.width));
        const dstH = Math.max(1, Math.round(rect.height));
        const dx = Math.round(rect.left);
        const dy = Math.round(rect.top);
        try {
          ctx.drawImage(c, 0, 0, c.width, c.height, dx, dy, dstW, dstH);
        } catch {}
      }
    }
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  function refreshPageBuffersForCurrentZoom() {
    if (!Array.isArray(state.pages)) return;
    for (const page of state.pages) {
      if (!page) continue;
      lifecycleController?.prepareCanvas?.(page.canvas);
      lifecycleController?.prepareCanvas?.(page.backCanvas);
      lifecycleController?.configureCanvasContext?.(page.ctx);
      lifecycleController?.configureCanvasContext?.(page.backCtx);
      page.dirtyAll = true;
      page._dirtyRowMinMu = page._dirtyRowMaxMu = undefined;
      if (page._dirtyRows) page._dirtyRows.clear();
      schedulePaint?.(page);
    }
  }

  function setAllPagesActive(active) {
    if (!Array.isArray(state.pages)) return;
    for (const page of state.pages) {
      lifecycleController?.setPageActive?.(page, active);
    }
  }

  function sortDocumentsInPlace() {
    docState.documents.sort((a, b) => {
      const au = Number(a?.updatedAt) || 0;
      const bu = Number(b?.updatedAt) || 0;
      return bu - au;
    });
  }

  async function persistDocumentIndex() {
    sortDocumentsInPlace();
    try {
      await persistDocuments(storageKey, docState, {
        onSaveError: (err) => {
          const message = err?.name === 'QuotaExceededError'
            ? 'Storage is full. Try exporting or deleting older documents.'
            : 'Could not save documents. Changes may not persist.';
          showStorageNotice(message, { level: 'error', durationMs: 7000 });
        },
      });
    } catch (err) {
      showStorageNotice('Could not save documents. Changes may not persist.', { level: 'error', durationMs: 7000 });
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error('Typewriter: persistDocuments failed', err);
      }
    }
  }

  function renderDocumentList() {
    sortDocumentsInPlace();
    const renderInto = (listEl) => {
      if (!listEl) return;
      listEl.innerHTML = '';
      if (!docState.documents.length) {
        const empty = document.createElement('div');
        empty.className = 'doc-menu-empty';
        empty.textContent = 'No documents yet';
        listEl.appendChild(empty);
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
        listEl.appendChild(item);
      });
    };
    renderInto(app.docMenuList);
    renderInto(app.inkFileDocMenuList);
  }

  function getTitleInputs() {
    return [app.docTitleInput, app.inkFileDocTitleInput].filter(Boolean);
  }

  function primaryTitleInput() {
    const [first] = getTitleInputs();
    return first || null;
  }

  function ensureDocumentTitleInput() {
    if (isEditingTitle) return;
    getTitleInputs().forEach((input) => {
      input.value = state.documentTitle || '';
    });
  }

  function getDocMenuTargets(source = 'main') {
    if (source === 'ink') {
      return {
        popup: app.inkFileDocMenuPopup,
        btn: app.inkFileDocMenuBtn,
        list: app.inkFileDocMenuList,
        input: app.inkFileDocTitleInput,
      };
    }
    return {
      popup: app.docMenuPopup,
      btn: app.docMenuBtn,
      list: app.docMenuList,
      input: app.docTitleInput,
    };
  }

  function closeAllDocMenus() {
    ['main', 'ink'].forEach((src) => {
      const { popup, btn } = getDocMenuTargets(src);
      if (popup) popup.classList.remove('open');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
    docMenuState.open = false;
  }

  function openDocMenu(source = 'main') {
    closeAllDocMenus();
    const { popup, btn } = getDocMenuTargets(source);
    if (!popup) return;
    popup.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    docMenuState.open = true;
  }

  function closeDocMenu() {
    if (!docMenuState.open) return;
    closeAllDocMenus();
  }

  function toggleDocMenu(source = 'main') {
    if (docMenuState.open) closeDocMenu(source);
    else openDocMenu(source);
  }

  function getActiveDocument() {
    if (!docState.activeId) return null;
    return docState.documents.find((doc) => doc.id === docState.activeId) || null;
  }

  async function ensureDocumentData(doc) {
    if (!doc || doc.data) return doc?.data || null;
    const hydrated = await loadDocumentDataById(doc.id);
    if (hydrated) {
      doc.data = hydrated;
    }
    return doc.data || null;
  }

  async function hydrateAllDocumentData() {
    if (!Array.isArray(docState.documents) || !docState.documents.length) return;
    await Promise.all(docState.documents.map((doc) => ensureDocumentData(doc)));
  }

  function cloneSyncDocument(doc) {
    if (!doc || !doc.data || typeof doc.data !== 'object') return null;
    return {
      id: doc.id,
      title: normalizeDocumentTitle(doc.title),
      createdAt: Number.isFinite(doc.createdAt) ? Number(doc.createdAt) : Date.now(),
      updatedAt: Number.isFinite(doc.updatedAt) ? Number(doc.updatedAt) : Date.now(),
      dataSize: Number.isFinite(doc.dataSize) ? Number(doc.dataSize) : 0,
      data: JSON.parse(JSON.stringify(doc.data)),
    };
  }

  async function getDropboxLocalSnapshot() {
    await hydrateAllDocumentData();
    const documents = docState.documents
      .map((doc) => cloneSyncDocument(doc))
      .filter(Boolean);
    const idSet = new Set(documents.map((doc) => doc.id));
    const activeId = (typeof docState.activeId === 'string' && idSet.has(docState.activeId))
      ? docState.activeId
      : (documents[0]?.id || null);
    return { activeId, documents };
  }

  async function applyDropboxMergedSnapshot(snapshot = {}) {
    const incoming = Array.isArray(snapshot.documents) ? snapshot.documents : [];
    const seen = new Set();
    const nextDocuments = incoming
      .map((entry) => {
        const item = entry && typeof entry === 'object' ? entry : {};
        if (!item.data || typeof item.data !== 'object') return null;
        return createDocumentRecord({
          id: item.id,
          title: item.title,
          createdAt: Number(item.createdAt),
          updatedAt: Number(item.updatedAt),
          data: item.data,
        }, seen);
      })
      .filter(Boolean);

    if (!nextDocuments.length) return;

    const validIds = new Set(nextDocuments.map((doc) => doc.id));
    const nextActiveId = (typeof snapshot.activeId === 'string' && validIds.has(snapshot.activeId))
      ? snapshot.activeId
      : (nextDocuments[0]?.id || null);

    suppressDropboxAutoSync = true;
    try {
      docState.documents = nextDocuments;
      docState.activeId = nextActiveId;
      await persistDocumentIndex();

      const active = getActiveDocument() || docState.documents[0] || null;
      if (active) {
        await ensureDocumentData(active);
        applyDocumentRecord(active);
      } else {
        syncDocumentUi();
      }
    } finally {
      suppressDropboxAutoSync = false;
    }
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
    refreshSavedInkStylesUI();
    hydrateInkSettingsFromState({ updateStyleName: true });
    syncDocumentUi();
    if (!loaded) {
      queueDirtySave();
    }
    focusStage();
  }

  async function handleDocumentSelection(id) {
    if (!id || docState.activeId === id) {
      closeDocMenu();
      return;
    }
    await saveStateNow();
    const nextDoc = docState.documents.find((record) => record.id === id);
    if (!nextDoc) {
      closeDocMenu();
      return;
    }
    await ensureDocumentData(nextDoc);
    applyDocumentRecord(nextDoc);
    closeDocMenu();
  }

  function handleCreateDocument() {
    void saveStateNow();
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
    void persistDocumentIndex();
    applyDocumentRecord(newDoc);
    markDocumentDirty(state);
    void saveStateNow();
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
      void persistDocumentIndex();
      refreshDocumentEnvironment();
      syncDocumentUi();
      markDocumentDirty(state);
      void saveStateNow();
      closeDocMenu();
      return;
    }
    const nextDoc = docState.documents[Math.min(idx, docState.documents.length - 1)];
    docState.activeId = nextDoc.id;
    void persistDocumentIndex();
    applyDocumentRecord(nextDoc);
    closeDocMenu();
  }

  function handleDocumentTitleInput(sourceInput = primaryTitleInput()) {
    const input = sourceInput;
    if (!input) return;
    const raw = input.value.slice(0, 200);
    getTitleInputs().forEach((el) => {
      if (el !== input) el.value = raw;
    });
    state.documentTitle = raw;
    const active = getActiveDocument();
    if (active) {
      active.title = raw;
    }
    renderDocumentList();
  }

  function commitDocumentTitle(sourceInput = primaryTitleInput()) {
    const input = sourceInput;
    if (!input) return;
    const sanitized = normalizeDocumentTitle(input.value);
    getTitleInputs().forEach((el) => { el.value = sanitized; });
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
      void saveStateNow();
    } else {
      void persistDocumentIndex();
    }
  }

  function exportPlainTextFile() {
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
    downloadBlob(blob, buildExportFileName({ suffix: 'plain-text', ext: 'txt' }));
  }

  function exportDocumentData() {
    let serialized = null;
    try {
      serialized = serializeState();
    } catch {
      serialized = null;
    }
    if (!serialized) return;
    const payload = JSON.stringify(serialized, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, buildExportFileName({ suffix: 'raw', ext: 'json' }));
  }

  function computeExportZoomPct() {
    const paper = getPaperSize(normalizePaperSizeId(state?.paperSize || DEFAULT_PAPER_SIZE));
    const cssPpi = paper?.widthIn && app?.PAGE_W ? app.PAGE_W / paper.widthIn : 110;
    const targetDpi = 300; // aim for print-friendly resolution without blowing memory
    const dpr = Math.max(1, Math.min(4, window.devicePixelRatio || 1));
    const baseScale = targetDpi / Math.max(1, cssPpi);
    const { width: capW = DEFAULT_CANVAS_DIMENSION_CAP, height: capH = DEFAULT_CANVAS_DIMENSION_CAP } = detectCanvasDimensionLimit() || {};
    const capScale = Math.min(
      capW && app?.PAGE_W ? capW / app.PAGE_W : baseScale,
      capH && app?.PAGE_H ? capH / app.PAGE_H : baseScale,
    );
    const exportScale = Math.max(1, Math.min(baseScale, capScale, 3.5));
    const pct = Math.round((exportScale / dpr) * 100);
    return Math.min(400, Math.max(150, pct || 200));
  }

  async function exportPdfFile() {
    const previewUrl = makeStagePreview();
    beginPdfExportUi('Preparing PDF…', previewUrl);
    await waitForOverlayPaint();
    const prevZoomPct = Math.round(Math.max(1, (state.zoom || 1) * 100));
    const exportZoomPct = computeExportZoomPct();
    const prevLowRes = state.lowResZoomEnabled;
    state.lowResZoomEnabled = false;
    setRenderScaleForZoom?.();
    setZoomPercent(exportZoomPct);
    setRenderScaleForZoom?.();
    refreshPageBuffersForCurrentZoom();
    try {
      await exportDocumentAsPdf({
        app,
        state,
        buildExportFileName,
        downloadBlob,
        schedulePaint,
        setPageActive: lifecycleController?.setPageActive,
        requestVirtualization,
      });
    } catch (err) {
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error('Typewriter: PDF export failed', err);
      }
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('Could not create PDF. Check your connection and try again.');
      }
    } finally {
      state.lowResZoomEnabled = prevLowRes;
      setRenderScaleForZoom?.();
      setZoomPercent(prevZoomPct);
      setRenderScaleForZoom?.();
      refreshPageBuffersForCurrentZoom();
      requestVirtualization?.();
      endPdfExportUi('PDF saved');
    }
  }

  function queueDirtySave() {
    markDocumentDirty(state);
    saveStateDebounced();
  }

  function normalizeChangedPageIndices(pageCount, tracked = []) {
    const deduped = new Set();
    if (Array.isArray(tracked)) {
      tracked.forEach((index) => {
        if (!Number.isInteger(index)) return;
        if (index < 0 || index >= pageCount) return;
        deduped.add(index);
      });
    }
    return Array.from(deduped).sort((a, b) => a - b);
  }

  function buildIncrementalSerializedState(previousSerialized = null) {
    const fullSnapshot = () => ({
      serialized: serializeState(),
      changedPages: null,
      usedIncremental: false,
    });

    if (typeof serializeStateBase !== 'function' || typeof serializePageState !== 'function') {
      return fullSnapshot();
    }

    const base = serializeStateBase();
    if (!base || typeof base !== 'object') {
      return fullSnapshot();
    }

    const pageCount = Array.isArray(state.pages) ? state.pages.length : 0;
    const previousPages = Array.isArray(previousSerialized?.pages) ? previousSerialized.pages : null;
    const mergedPages = previousPages ? previousPages.slice(0, pageCount) : new Array(pageCount);
    const rawDirtyPages = typeof getDirtyPageIndices === 'function'
      ? getDirtyPageIndices()
      : getTrackedDirtyPageIndices(state);
    const changedPageSet = new Set(normalizeChangedPageIndices(pageCount, rawDirtyPages));

    if (!previousPages) {
      for (let i = 0; i < pageCount; i += 1) changedPageSet.add(i);
    } else if (previousPages.length < pageCount) {
      for (let i = previousPages.length; i < pageCount; i += 1) changedPageSet.add(i);
    }

    for (let i = 0; i < pageCount; i += 1) {
      if (mergedPages[i] !== undefined) continue;
      changedPageSet.add(i);
    }

    const changedPages = Array.from(changedPageSet).sort((a, b) => a - b);
    changedPages.forEach((index) => {
      mergedPages[index] = serializePageState(index);
    });

    return {
      serialized: {
        ...base,
        pages: mergedPages,
      },
      changedPages,
      usedIncremental: true,
    };
  }

  async function saveStateNow(options = {}) {
    const opts = (typeof options === 'object' && options !== null) ? options : {};
    const force = !!opts.force;
    const skipDropboxNotify = !!opts.skipDropboxNotify;
    if (!force && !hasPendingDocumentChanges(state)) {
      return;
    }
    try {
      const activeId = typeof state.documentId === 'string' && state.documentId.trim()
        ? state.documentId.trim()
        : (docState.activeId || generateDocumentId(new Set(docState.documents.map((doc) => doc.id))));
      let doc = docState.documents.find((d) => d.id === activeId);
      const serializedBuild = buildIncrementalSerializedState(doc?.data);
      const serialized = serializedBuild.serialized;
      const encodedBytes = estimateDocumentDataBytes(serialized);
      if (encodedBytes >= LARGE_DOC_SIZE_WARNING) {
        showStorageNotice('This document is large; saving may take a moment.', { durationMs: 5000 });
      }
      const title = normalizeDocumentTitle(serialized.documentTitle || state.documentTitle);
      const now = Date.now();
      const previousBytes = Number(doc?.dataSize) || 0;
      if (!doc) {
        doc = {
          id: activeId,
          title,
          createdAt: now,
          updatedAt: now,
          data: serialized,
          dataSize: encodedBytes,
          lastSavedRevision: state.saveRevision,
        };
        docState.documents.push(doc);
      } else {
        doc.title = title;
        doc.updatedAt = now;
        doc.data = serialized;
        doc.dataSize = encodedBytes;
        doc.lastSavedRevision = state.saveRevision;
        if (!Number.isFinite(doc.createdAt)) {
          doc.createdAt = now;
        }
      }
      state.documentId = activeId;
      state.documentTitle = title;
      docState.activeId = activeId;
      void warnIfApproachingQuota(encodedBytes, previousBytes);
      await persistDocumentIndex();
      syncDocumentUi();
      syncSavedRevision(state);
      if (serializedBuild.usedIncremental) {
        const syncPages = typeof syncSavedPageRevisions === 'function'
          ? syncSavedPageRevisions
          : (pageIndices) => syncTrackedPageRevisions(state, pageIndices);
        syncPages(serializedBuild.changedPages);
      }
      lastSaveNowTs = Date.now();
      if (!skipDropboxNotify && !suppressDropboxAutoSync) {
        dropboxSyncController.notifyLocalMutation();
      }
    } catch (err) {
      showStorageNotice('Save failed. Export your document to avoid losing changes.', { level: 'error', durationMs: 8000 });
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error('Typewriter: saveStateNow failed', err);
      }
    }
  }

  function adaptiveSaveDelayMs() {
    const pages = Array.isArray(state.pages) ? state.pages.length : 0;
    if (pages > 18) return 1700;
    if (pages > 12) return 1400;
    if (pages > 8) return 1100;
    if (pages > 4) return 750;
    return 450;
  }

  let pendingIdleHandle = 0;
  function saveStateDebounced(options = {}) {
    const force = typeof options === 'object' && options !== null ? !!options.force : false;
    if (!force && !hasPendingDocumentChanges(state)) {
      return;
    }
    const timer = getSaveTimer();
    if (timer) clearTimeout(timer);
    if (pendingIdleHandle && typeof cancelIdleCallback === 'function') {
      try { cancelIdleCallback(pendingIdleHandle); } catch {}
      pendingIdleHandle = 0;
    }

    const delay = adaptiveSaveDelayMs();
    const scheduleIdle = () => {
      const run = () => {
        pendingIdleHandle = 0;
        const now = Date.now();
        if (!force && now - lastSaveNowTs < 250) {
          // Avoid back-to-back saves when something else just ran.
          setTimeout(() => { void saveStateNow(options); }, 150);
          return;
        }
        if (typeof requestIdleCallback === 'function') {
          pendingIdleHandle = requestIdleCallback(
            () => { void saveStateNow(options); },
            { timeout: 1000 },
          );
        } else if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => { void saveStateNow(options); });
        } else {
          setTimeout(() => { void saveStateNow(options); }, 0);
        }
      };
      const newTimer = setTimeout(() => {
        setSaveTimer(0);
        run();
      }, delay);
      setSaveTimer(newTimer);
    };

    scheduleIdle();
  }

  const dropboxSyncController = createDropboxSyncController({
    storageKey,
    getLocalSnapshot: getDropboxLocalSnapshot,
    applyMergedSnapshot: applyDropboxMergedSnapshot,
    beforeSync: async () => {
      await saveStateNow({ skipDropboxNotify: true });
    },
    onNotice: (message, meta = {}) => {
      if (meta.level !== 'error') return;
      showStorageNotice(message, { level: 'error', durationMs: 9000 });
    },
  });

  function bindDocumentControls() {
    const bindDocMenuSet = (source) => {
      const { btn, popup, list, input } = getDocMenuTargets(source);
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleDocMenu(source);
        });
      }
      if (popup) popup.addEventListener('pointerdown', (e) => e.stopPropagation());
      if (list) {
        list.addEventListener('click', (e) => {
          const item = e.target.closest('.doc-list-item');
          if (!item) return;
          e.preventDefault();
          void handleDocumentSelection(item.dataset.id || '');
          closeDocMenu(source);
        });
      }
      if (input) {
        input.addEventListener('focus', () => { isEditingTitle = true; });
        input.addEventListener('blur', () => {
          isEditingTitle = false;
          commitDocumentTitle(input);
        });
        input.addEventListener('input', () => {
          handleDocumentTitleInput(input);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
          }
        });
      }
    };

    bindDocMenuSet('main');
    bindDocMenuSet('ink');
    if (app.deleteDocBtn) {
      app.deleteDocBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleDeleteDocument();
      });
    }
    if (app.inkFileDeleteDocBtn) {
      app.inkFileDeleteDocBtn.addEventListener('click', (e) => {
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
    if (app.inkFileNewDocBtn) {
      app.inkFileNewDocBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCreateDocument();
      });
    }
    if (app.exportBtn) {
      app.exportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        exportDialog.open();
      });
    }
    if (app.inkFileExportBtn) {
      app.inkFileExportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        exportDialog.open();
      });
    }
    exportDialog.bind();
    dropboxSyncController.bindUi({
      connectBtn: app.dropboxConnectBtn,
      disconnectBtn: app.dropboxDisconnectBtn,
      syncNowBtn: app.dropboxSyncNowBtn,
      autoSyncToggle: app.dropboxAutoSyncToggle,
      statusEl: app.dropboxStatus,
      folderPathEl: app.dropboxFolderPath,
      lastSyncEl: app.dropboxLastSync,
      errorEl: app.dropboxError,
    });
    dropboxSyncController.init();
    document.addEventListener('pointerdown', (e) => {
      if (!docMenuState.open) return;
      const inMain = app.docMenuPopup?.contains(e.target) || app.docMenuBtn?.contains(e.target);
      const inInk = app.inkFileDocMenuPopup?.contains(e.target) || app.inkFileDocMenuBtn?.contains(e.target);
      if (inMain || inInk) return;
      closeDocMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (exportDialog.isOpen()) {
          exportDialog.close();
          return;
        }
        closeDocMenu();
      }
    });
  }

  async function loadPersistedState() {
    let savedFont = null;
    let loaded = false;
    const { documents, activeId } = await loadDocumentIndexFromStorage(storageKey);
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
        await persistDocumentIndex();
      }
    }

    if (activeDoc) {
      await ensureDocumentData(activeDoc);
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
      await persistDocumentIndex();
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
