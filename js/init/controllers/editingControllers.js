import { exactFontString } from '../../config/metrics.js';
import { markDocumentDirty } from '../../state/saveRevision.js';
import { clamp } from '../../utils/math.js';
import { sanitizeIntegerField } from '../../utils/forms.js';
import { createDocumentEditingController } from '../../document/documentEditing.js';
import { createDocumentViewAdapter } from '../../document/documentViewAdapter.js';
import { createInputController } from '../../document/inputHandlers.js';
import { createPageLifecycleController } from '../../document/pageLifecycle.js';

function ensureTypedRun(run) {
  if (run && typeof run === 'object') return run;
  return { active: false, page: 0, rowMu: 0, startCol: 0, length: 0, lastTs: 0 };
}

export function registerEditingControllers(options) {
  const {
    app,
    state,
    context,
    metrics,
    metricsStore,
    metricsOptions,
    rendererApi,
    gridDiv,
    layoutBridge,
    touchedPages,
    recalcMetrics,
    createMetricsScheduler,
    getTargetPitchPx,
    getEffectiveRenderZoom,
    saveHooks,
    ephemeral,
  } = options;

  const viewAdapter = createDocumentViewAdapter({ app });
  const rendererHooks = {};

  let {
    lastDigitTs = 0,
    lastDigitCaret = null,
    bsBurstCount = 0,
    bsBurstTs = 0,
    lastPasteTs = 0,
    typedRun,
    drag,
    saveTimer,
    zoomDebounceTimer,
    zooming,
    freezeVirtual = false,
    batchDepth = 0,
    typingBatchRAF = 0,
    virtRAF = 0,
    fontLoadSeq = 0,
  } = ephemeral;

  typedRun = ensureTypedRun(typedRun);

  let pendingVirtualization = false;

  function getLifecycleController() {
    return context.controllers.lifecycle;
  }

  const touchPage = (...args) => getLifecycleController()?.touchPage(...args);
  const prepareCanvas = (...args) => getLifecycleController()?.prepareCanvas(...args);
  const configureCanvasContext = (...args) => getLifecycleController()?.configureCanvasContext(...args);
  const makePageRecord = (...args) => getLifecycleController()?.makePageRecord(...args);
  const addPage = (...args) => getLifecycleController()?.addPage(...args);
  const bootstrapFirstPage = (...args) => getLifecycleController()?.bootstrapFirstPage(...args);
  const resetPagesBlankPreserveSettings = (...args) => getLifecycleController()?.resetPagesBlankPreserveSettings(...args);
  const requestVirtualization = (...args) => {
    const controller = getLifecycleController();
    if (!controller) {
      pendingVirtualization = true;
      return;
    }
    return controller.requestVirtualization(...args);
  };

  const editingController = createDocumentEditingController({
    app,
    state,
    getGridDiv: () => gridDiv,
    getGridHeight: () => metricsStore.GRID_H,
    getCharWidth: () => metricsStore.CHAR_W,
    getAsc: () => metricsStore.ASC,
    getDesc: () => metricsStore.DESC,
    getBaselineOffsetCell: () => metricsStore.BASELINE_OFFSET_CELL,
    getActiveFontName: () => metricsStore.ACTIVE_FONT_NAME,
    setActiveFontName: (name) => {
      metricsStore.ACTIVE_FONT_NAME = name;
      metricsStore.FONT_FAMILY = `${name}`;
    },
    touchedPages,
    getFreezeVirtual: () => freezeVirtual,
    setFreezeVirtual: (value) => {
      freezeVirtual = value;
      ephemeral.freezeVirtual = value;
    },
    requestVirtualization,
    positionRulers: layoutBridge.positionRulers,
    saveStateDebounced: (...args) => saveHooks.saveStateDebounced(...args),
    saveStateNow: (...args) => saveHooks.saveStateNow(...args),
    renderMargins: layoutBridge.renderMargins,
    beginBatch,
    endBatch,
    addPage,
    makePageRecord,
    prepareCanvas,
    configureCanvasContext,
    metricsOptions,
    setPaperOffset: layoutBridge.setPaperOffset,
    applyDefaultMargins,
    computeColsFromCpi,
    rendererHooks,
    layoutZoomFactor: () => layoutBridge.getLayoutZoomFactor(),
    requestHammerNudge: layoutBridge.requestHammerNudge,
    isZooming: () => zooming,
    resetPagesBlankPreserveSettings,
    rendererApi,
    viewAdapter,
  });

  const {
    getCurrentBounds,
    snapRowMuToStep,
    clampCaretToBounds,
    updateCaretPosition,
    advanceCaret,
    handleNewline,
    handleBackspace,
    insertTextFast,
    overtypeCharacter,
    eraseCharacters,
    rewrapDocumentToCurrentBounds,
    serializeState,
    deserializeState,
    setInk,
    createNewDocument,
  } = editingController;

  const inputController = createInputController({
    state,
    typedRun,
    getCurrentBounds,
    advanceCaret,
    handleNewline,
    handleBackspace,
    insertTextFast,
    overtypeCharacter,
    eraseCharacters,
    addPage,
    updateCaretPosition,
    beginBatch,
    endBatch,
    beginTypingFrameBatch,
    saveStateDebounced: (...args) => saveHooks.saveStateDebounced(...args),
    focusStage,
    applySubmittedChanges,
    applyLineHeight,
    clamp,
    counters: {
      getLastDigitTs: () => lastDigitTs,
      setLastDigitTs: (value) => {
        lastDigitTs = value;
        ephemeral.lastDigitTs = value;
      },
      getLastDigitCaret: () => lastDigitCaret,
      setLastDigitCaret: (value) => {
        lastDigitCaret = value;
        ephemeral.lastDigitCaret = value;
      },
      getBsBurstCount: () => bsBurstCount,
      setBsBurstCount: (value) => {
        bsBurstCount = value;
        ephemeral.bsBurstCount = value;
      },
      getBsBurstTs: () => bsBurstTs,
      setBsBurstTs: (value) => {
        bsBurstTs = value;
        ephemeral.bsBurstTs = value;
      },
      getLastPasteTs: () => lastPasteTs,
      setLastPasteTs: (value) => {
        lastPasteTs = value;
        ephemeral.lastPasteTs = value;
      },
    },
  });

  const { resetTypedRun } = inputController;
  context.controllers.input = inputController;

  const lifecycleContext = {
    app,
    state,
    layoutZoomFactor: () => layoutBridge.getLayoutZoomFactor(),
    getRenderScale: () => metricsStore.RENDER_SCALE,
    getEffectiveRenderZoom: options.getEffectiveRenderZoom,
    getFontSize: () => metricsStore.FONT_SIZE,
    getActiveFontName: () => metricsStore.ACTIVE_FONT_NAME,
    exactFontString,
    getGridHeight: () => metricsStore.GRID_H,
    getCharWidth: () => metricsStore.CHAR_W,
    getFreezeVirtual: () => freezeVirtual,
    getVirtRAF: () => virtRAF,
    setVirtRAF: (value) => {
      virtRAF = value;
      ephemeral.virtRAF = value;
    },
    renderMargins: layoutBridge.renderMargins,
    positionRulers: layoutBridge.positionRulers,
    resetTypedRun,
  };

  context.controllers.lifecycle = createPageLifecycleController(lifecycleContext, editingController);

  if (pendingVirtualization) {
    pendingVirtualization = false;
    context.controllers.lifecycle.requestVirtualization();
  }

  function focusStage() {
    if (!app.stage) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active !== app.stage) {
        try {
          active.blur();
        } catch {}
      }
      try {
        app.stage.focus({ preventScroll: true });
      } catch {
        try {
          app.stage.focus();
        } catch {}
      }
    });
  }

  function beginBatch() {
    batchDepth++;
    ephemeral.batchDepth = batchDepth;
  }

  function endBatch() {
    if (batchDepth > 0) batchDepth--;
    ephemeral.batchDepth = batchDepth;
    if (batchDepth === 0) {
      for (const page of touchedPages) rendererHooks.schedulePaint?.(page);
      touchedPages.clear();
    }
  }

  function beginTypingFrameBatch() {
    if (batchDepth === 0) beginBatch();
    if (!typingBatchRAF) {
      typingBatchRAF = requestAnimationFrame(() => {
        typingBatchRAF = 0;
        ephemeral.typingBatchRAF = 0;
        endBatch();
      });
      ephemeral.typingBatchRAF = typingBatchRAF;
    }
  }

  const FONT_CANDIDATES = [
    () => metricsStore.ACTIVE_FONT_NAME,
    () => 'TT2020Base',
    () => 'TT2020StyleB',
    () => 'TT2020StyleD',
    () => 'TT2020StyleE',
    () => 'TT2020StyleF',
    () => 'TT2020StyleG',
    () => 'Courier New',
    () => 'Courier',
    () => 'ui-monospace',
    () => 'Menlo',
    () => 'Monaco',
    () => 'Consolas',
    () => 'Liberation Mono',
    () => 'monospace',
  ];

  function faceAvailable(face) {
    if (face === 'monospace') return true;
    try {
      return document.fonts.check(`12px "${face}"`, 'MW@#123');
    } catch {
      return false;
    }
  }

  async function resolveAvailableFace(preferredFace) {
    try {
      await document.fonts.ready;
    } catch {}
    const tried = new Set();
    const ordered = [preferredFace, ...FONT_CANDIDATES.map((f) => f()).filter(Boolean)];
    for (const face of ordered) {
      if (tried.has(face)) continue;
      tried.add(face);
      if (faceAvailable(face)) return face;
      try {
        await document.fonts.load(`400 1em "${face}"`, 'MWmw123');
      } catch {}
      if (faceAvailable(face)) return face;
    }
    return 'monospace';
  }

  function prewarmFontFace(face) {
    const px = Math.max(12, Math.ceil(getTargetPitchPx()));
    const ghost = document.createElement('span');
    ghost.textContent = 'MWmw1234567890';
    ghost.style.cssText = `position:fixed;left:-9999px;top:-9999px;visibility:hidden;font:${exactFontString(px, face)};`;
    document.body.appendChild(ghost);
    return ghost;
  }

  async function loadFontAndApply(requestedFace) {
    const seq = ++fontLoadSeq;
    ephemeral.fontLoadSeq = fontLoadSeq;
    const tryFace = requestedFace || metricsStore.ACTIVE_FONT_NAME;
    const ghost = prewarmFontFace(tryFace);
    try {
      const px = Math.max(12, Math.ceil(getTargetPitchPx()));
      await Promise.race([
        (async () => {
          await document.fonts.load(exactFontString(px, tryFace), 'MWmw123');
          await document.fonts.load(`400 1em "${tryFace}"`, 'MWmw123');
        })(),
        new Promise((res) => setTimeout(res, 1200)),
      ]);
    } catch {}
    ghost.remove();

    const resolvedFace = await resolveAvailableFace(tryFace);
    if (seq !== fontLoadSeq) return;

    metricsStore.ACTIVE_FONT_NAME = resolvedFace;
    metricsStore.FONT_FAMILY = `${resolvedFace}`;
    syncFontRadiosWithActiveFont();
    applyMetricsNow(true);
  }

  function mmX(px) {
    return (px * 210) / app.PAGE_W;
  }
  function mmY(px) {
    return (px * 297) / app.PAGE_H;
  }
  function pxX(mm) {
    return (mm * app.PAGE_W) / 210;
  }
  function pxY(mm) {
    return (mm * app.PAGE_H) / 297;
  }

  function applyDefaultMargins() {
    const mmw = app.PAGE_W / 210;
    const mmh = app.PAGE_H / 297;
    const mW = 25 * mmw;
    const mH = 25 * mmh;
    state.marginL = mW;
    state.marginR = app.PAGE_W - mW;
    state.marginTop = mH;
    state.marginBottom = mH;
  }

  function toggleRulers() {
    state.showRulers = !state.showRulers;
    document.body.classList.toggle('rulers-off', !state.showRulers);
    layoutBridge.positionRulers();
    markDocumentDirty(state);
    saveHooks.saveStateDebounced();
  }

  function setLineHeightFactor(f) {
    const allowed = [1, 1.5, 2, 2.5, 3];
    const clamped = allowed.includes(f) ? f : 1;
    state.lineHeightFactor = clamped;
    state.lineStepMu = Math.round(gridDiv * clamped);
    clampCaretToBounds();
    updateCaretPosition();
    layoutBridge.positionRulers();
    markDocumentDirty(state);
    saveHooks.saveStateDebounced();
  }

  function readStagedLH() {
    const v = parseFloat(app.lhInput?.value) || 1;
    const allowed = [1, 1.5, 2, 2.5, 3];
    let best = allowed[0];
    let bd = Math.abs(v - allowed[0]);
    for (let i = 1; i < allowed.length; i++) {
      const d = Math.abs(v - allowed[i]);
      if (d < bd || (d === bd && allowed[i] < best)) {
        bd = d;
        best = allowed[i];
      }
    }
    if (app.lhInput) app.lhInput.value = String(best);
    return best;
  }

  function applyLineHeight() {
    setLineHeightFactor(readStagedLH());
    focusStage();
  }

  function syncFontRadiosWithActiveFont() {
    if (!app.fontRadios) return;
    const activeFont = metricsStore.ACTIVE_FONT_NAME;
    for (const radio of app.fontRadios()) {
      radio.checked = radio.value === activeFont;
    }
  }

  function toggleInkSettingsPanel() {
    if (!app.inkSettingsPanel) return;
    const isOpen = app.inkSettingsPanel.classList.toggle('is-open');
    if (isOpen) syncFontRadiosWithActiveFont();
  }

  function computeColsFromCpi(cpi) {
    const raw = metrics.A4_WIDTH_IN * cpi;
    const cols3 = Math.round(raw * 1000) / 1000;
    const cols2 = Math.round(cols3 * 100) / 100;
    return { cols3, cols2 };
  }

  function readStagedCpi() {
    return parseFloat(app.cpiSelect?.value) || 10;
  }

  function readStagedSize() {
    const fallback = Number.isFinite(state.inkWidthPct)
      ? clamp(Math.round(state.inkWidthPct), 1, 150)
      : 95;
    const val = sanitizeIntegerField(app.sizeInput, {
      min: 1,
      max: 150,
      allowEmpty: false,
      fallbackValue: fallback,
    });
    return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
  }

  function applySubmittedChanges() {
    const newCpi = readStagedCpi();
    const { cols2 } = computeColsFromCpi(newCpi);
    const newCols = cols2;
    const cpiChanged = typeof state.cpi === 'number' ? newCpi !== state.cpi : true;
    const stagedSize = readStagedSize();
    const inkChanged = typeof state.inkWidthPct === 'number' ? stagedSize !== state.inkWidthPct : true;
    if (!cpiChanged && !inkChanged) {
      focusStage();
      return;
    }
    beginBatch();
    if (inkChanged) state.inkWidthPct = stagedSize;
    if (cpiChanged) state.cpi = newCpi;
    const colsChanged = newCols !== state.colsAcross;
    if (colsChanged) state.colsAcross = newCols;
    scheduleMetricsUpdate(true);
    if (colsChanged) {
      let tries = 0;
      const target = Math.round((app.PAGE_W / state.colsAcross) * metrics.DPR) / metrics.DPR;
      const waitForMetrics = () => {
        if (Math.abs(metricsStore.CHAR_W - target) < 0.01 || tries++ > 12) {
          rewrapDocumentToCurrentBounds();
          endBatch();
          focusStage();
          return;
        }
        requestAnimationFrame(waitForMetrics);
      };
      focusStage();
      requestAnimationFrame(waitForMetrics);
    } else {
      for (const p of state.pages) {
        if (!p) continue;
        p.dirtyAll = true;
        rendererHooks.schedulePaint?.(p);
      }
      layoutBridge.renderMargins();
      clampCaretToBounds();
      updateCaretPosition();
      layoutBridge.positionRulers();
      requestVirtualization();
      markDocumentDirty(state);
      saveHooks.saveStateDebounced();
      endBatch();
      focusStage();
    }
  }

  function setPaperOffset(x, y) {
    layoutBridge.setPaperOffset(x, y);
  }

  function shiftDocumentRows(deltaMu) {
    if (!deltaMu) return;
    for (const page of state.pages) {
      if (!page || !page.grid) continue;
      const newGrid = new Map();
      for (const [rowMu, rowMap] of page.grid) {
        newGrid.set(rowMu + deltaMu, rowMap);
      }
      page.grid = newGrid;
      if (page._dirtyRowMinMu !== undefined) page._dirtyRowMinMu += deltaMu;
      if (page._dirtyRowMaxMu !== undefined) page._dirtyRowMaxMu += deltaMu;
    }
    state.caret.rowMu += deltaMu;
    if (typedRun?.active) typedRun.rowMu += deltaMu;
    if (lastDigitCaret) {
      lastDigitCaret = { ...lastDigitCaret, rowMu: lastDigitCaret.rowMu + deltaMu };
      ephemeral.lastDigitCaret = lastDigitCaret;
    }
  }

  function applyMetricsNow(full = false) {
    beginBatch();
    const oldBounds = typeof getCurrentBounds === 'function' ? getCurrentBounds() : null;
    recalcMetrics(metricsStore.ACTIVE_FONT_NAME);
    const newBounds = typeof getCurrentBounds === 'function' ? getCurrentBounds() : null;
    let deltaTopMu = 0;
    if (oldBounds && newBounds) {
      deltaTopMu = newBounds.Tmu - oldBounds.Tmu;
    }
    if (ephemeral.primedMetricsAreFallback) {
      deltaTopMu = 0;
      ephemeral.primedMetricsAreFallback = false;
    }
    if (deltaTopMu) shiftDocumentRows(deltaTopMu);
    if (typeof rendererApi.rebuildAllAtlases === 'function') {
      rendererApi.rebuildAllAtlases();
    }
    for (const p of state.pages) {
      if (!p) continue;
      configureCanvasContext(p.ctx);
      configureCanvasContext(p.backCtx);
      p.dirtyAll = true;
      touchPage(p);
      if (p.active) rendererHooks.schedulePaint?.(p);
    }
    layoutBridge.renderMargins();
    layoutBridge.updateStageEnvironment();
    clampCaretToBounds();
    updateCaretPosition();
    layoutBridge.positionRulers();
    requestVirtualization();
    markDocumentDirty(state);
    saveHooks.saveStateDebounced();
    endBatch();
  }

  const scheduleMetricsUpdate = createMetricsScheduler(applyMetricsNow);

  return {
    rendererHooks,
    editingController,
    inputController,
    lifecycleController: context.controllers.lifecycle,
    requestVirtualization,
    bootstrapFirstPage,
    saveStateNow: (...args) => saveHooks.saveStateNow(...args),
    saveStateDebounced: (...args) => saveHooks.saveStateDebounced(...args),
    focusStage,
    beginBatch,
    endBatch,
    beginTypingFrameBatch,
    getBatchDepth: () => batchDepth,
    clampCaretToBounds,
    updateCaretPosition,
    positionRulers: layoutBridge.positionRulers,
    setInk,
    createNewDocument,
    serializeState,
    deserializeState,
    applyDefaultMargins,
    computeColsFromCpi,
    applySubmittedChanges,
    applyLineHeight,
    readStagedLH,
    setLineHeightFactor,
    toggleRulers,
    loadFontAndApply,
    toggleInkSettingsPanel,
    mmX,
    mmY,
    pxX,
    pxY,
    scheduleMetricsUpdate,
    setPaperOffset,
    layoutState: {
      getZooming: () => zooming,
      setZooming: (value) => {
        zooming = value;
        ephemeral.zooming = value;
      },
      getZoomDebounceTimer: () => zoomDebounceTimer,
      setZoomDebounceTimer: (value) => {
        zoomDebounceTimer = value;
        ephemeral.zoomDebounceTimer = value;
      },
      getDrag: () => drag,
      setDrag: (value) => {
        drag = value;
        ephemeral.drag = value;
      },
      getSaveTimer: () => saveTimer,
      setSaveTimer: (value) => {
        saveTimer = value;
        ephemeral.saveTimer = value;
      },
      getFreezeVirtual: () => freezeVirtual,
      setFreezeVirtual: (value) => {
        freezeVirtual = value;
        ephemeral.freezeVirtual = value;
      },
      getVirtRAF: () => virtRAF,
      setVirtRAF: (value) => {
        virtRAF = value;
        ephemeral.virtRAF = value;
      },
    },
    touchPage,
  };
}
