import { exactFontString } from '../../config/metrics.js';
import { createPaperMetrics, DEFAULT_PAPER_SIZE, getPaperSize, normalizePaperSizeId } from '../../config/paperSizes.js';
import { markDocumentDirty } from '../../state/saveRevision.js';
import { clamp } from '../../utils/math.js';
import { sanitizeIntegerField } from '../../utils/forms.js';
import { createDocumentEditingController } from '../../document/documentEditing.js';
import { createDocumentViewAdapter } from '../../document/documentViewAdapter.js';
import { createInputController } from '../../document/inputHandlers.js';
import { createPageLifecycleController } from '../../document/pageLifecycle.js';
import { syncRulerToggleButton } from '../ui/rulerToggle.js';

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

  const rootStyle = typeof document !== 'undefined' ? document.documentElement?.style : null;

  function setInkPanelShiftVar(valuePx) {
    if (!rootStyle) return;
    const safeValue = Number.isFinite(valuePx) ? Math.max(0, valuePx) : 0;
    rootStyle.setProperty('--ink-panel-shift', `${safeValue}px`);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('zoom-contrast-update'));
      // Dispatch again on the next frame so contrast recalculates after layout shifts.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => window.dispatchEvent(new Event('zoom-contrast-update')));
      }
    }
  }

  function syncZoomControlsPanelOffset() {
    if (!app?.inkSettingsPanel) {
      setInkPanelShiftVar(0);
      return;
    }
    const shouldShift = app.inkSettingsPanel.classList.contains('is-open');
    const panelWidth = shouldShift ? app.inkSettingsPanel.getBoundingClientRect().width : 0;
    setInkPanelShiftVar(panelWidth);
  }

  function observeInkPanelState() {
    if (typeof MutationObserver === 'function' && app?.inkSettingsPanel) {
      const observer = new MutationObserver((mutations) => {
        if (!mutations?.length) return;
        syncZoomControlsPanelOffset();
      });
      observer.observe(app.inkSettingsPanel, { attributes: true, attributeFilter: ['class'] });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        if (!app?.inkSettingsPanel?.classList.contains('is-open')) return;
        syncZoomControlsPanelOffset();
      }, { passive: true });
    }
    syncZoomControlsPanelOffset();
  }

  observeInkPanelState();

  let scheduleMetricsUpdateRef = null;

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
    applyPaperSizeSelection,
    scheduleMetricsUpdate: (...args) => scheduleMetricsUpdateRef?.(...args),
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
    moveCaretByLines,
    insertTextFast,
    overtypeCharacter,
    eraseCharacters,
    shiftRow,
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
    moveCaretByLines,
    insertTextFast,
    overtypeCharacter,
    eraseCharacters,
    shiftRow,
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

  const FONT_CANDIDATE_NAMES = [
    'TT2020Base',
    'TT2020Base Italic',
    'TT2020StyleB',
    'TT2020StyleB Italic',
    'TT2020StyleD',
    'TT2020StyleD Italic',
    'TT2020StyleE',
    'TT2020StyleE Italic',
    'TT2020StyleF',
    'TT2020StyleG',
    'Canon TypeStar 210',
    'Courier',
    'Courier New',
    'Courier Prime',
    'Cutive Mono',
    'Elite Math',
    'IBM Selectric Light Regular',
    'IBM Selectric Light Italic',
    'Letter Gothic',
    'Pica',
    'Prestige Elite Std',
    'Prestige Elite Std Bold',
    'SCM Galaxie XII',
    'Selectric Pica Regular',
    'Selectric Script Regular',
    'Special Elite',
    'ui-monospace',
    'Menlo',
    'Monaco',
    'Consolas',
    'Liberation Mono',
    'monospace',
  ];

  const FONT_CANDIDATES = [
    () => metricsStore.ACTIVE_FONT_NAME,
    ...FONT_CANDIDATE_NAMES.map((face) => () => face),
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

  function resolvePaperMetrics() {
    if (metrics?.PAPER?.widthMm > 0) return metrics.PAPER;
    const fallbackId = normalizePaperSizeId(state.paperSize || metrics?.PAPER_SIZE_ID || DEFAULT_PAPER_SIZE);
    const fallback = getPaperSize(fallbackId);
    const widthMm = fallback?.widthMm || 210;
    const pxPerMm = Number.isFinite(metrics?.PX_PER_MM) && metrics.PX_PER_MM > 0
      ? metrics.PX_PER_MM
      : (app.PAGE_W || 900) / widthMm;
    const computed = createPaperMetrics(fallbackId, pxPerMm);
    metrics.PAPER = computed;
    return computed;
  }

  function mmX(px) {
    const paper = resolvePaperMetrics();
    if (!paper?.widthMm || !app.PAGE_W) return 0;
    return (px * paper.widthMm) / app.PAGE_W;
  }
  function mmY(px) {
    const paper = resolvePaperMetrics();
    if (!paper?.heightMm || !app.PAGE_H) return 0;
    return (px * paper.heightMm) / app.PAGE_H;
  }
  function pxX(mm) {
    const paper = resolvePaperMetrics();
    if (!paper?.widthMm) return 0;
    return (mm * app.PAGE_W) / paper.widthMm;
  }
  function pxY(mm) {
    const paper = resolvePaperMetrics();
    if (!paper?.heightMm) return 0;
    return (mm * app.PAGE_H) / paper.heightMm;
  }

  function applyDefaultMargins() {
    const defaultMarginMm = 25;
    const marginXpx = pxX(defaultMarginMm);
    const marginYpx = pxY(defaultMarginMm);
    state.marginL = marginXpx;
    state.marginR = app.PAGE_W - marginXpx;
    state.marginTop = marginYpx;
    state.marginBottom = marginYpx;
  }

  function getPxPerMmRatio() {
    if (Number.isFinite(metrics?.PX_PER_MM) && metrics.PX_PER_MM > 0) {
      return metrics.PX_PER_MM;
    }
    const paper = resolvePaperMetrics();
    if (paper?.widthMm > 0) {
      const widthMm = paper.widthMm;
      const widthPx = paper.widthPx || app.PAGE_W;
      return widthPx / widthMm;
    }
    const fallback = getPaperSize(DEFAULT_PAPER_SIZE);
    return (app.PAGE_W || 900) / (fallback?.widthMm || 210);
  }

  function setRootPaperStyles(paper) {
    if (!rootStyle || !paper) return;
    const widthValue = Number.isFinite(paper.widthPx) ? paper.widthPx.toFixed(2) : '900';
    const aspectValue = Number.isFinite(paper.aspectRatio) ? paper.aspectRatio.toFixed(6) : (297 / 210).toFixed(6);
    rootStyle.setProperty('--page-w', widthValue);
    rootStyle.setProperty('--page-aspect', aspectValue);
  }

  function updatePaperMetricCache(paper) {
    if (!paper) return;
    metrics.PAPER = paper;
    metrics.PAPER_SIZE_ID = paper.id;
    metrics.PAPER_WIDTH_MM = paper.widthMm;
    metrics.PAPER_HEIGHT_MM = paper.heightMm;
    metrics.PAPER_WIDTH_IN = paper.widthIn;
    metrics.PAPER_HEIGHT_IN = paper.heightIn;
    metrics.PAGE_ASPECT = paper.aspectRatio;
    metrics.PAGE_W_CSS = paper.widthPx;
    metrics.PAGE_H_CSS = paper.heightPx;
    metrics.A4_WIDTH_IN = paper.widthIn;
    metrics.PX_PER_MM = paper.pxPerMm;
    app.PAGE_W = paper.widthPx;
    app.PAGE_H = paper.heightPx;
  }

  function applyPaperSizeSelection(targetId, options = {}) {
    const silent = options.silent === true;
    const normalizedId = normalizePaperSizeId(
      targetId || state.paperSize || metrics?.PAPER_SIZE_ID || DEFAULT_PAPER_SIZE,
    );
    const currentId = normalizePaperSizeId(state.paperSize || metrics?.PAPER_SIZE_ID || DEFAULT_PAPER_SIZE);
    const shouldForce = options.force === true;
    if (!shouldForce && normalizedId === currentId && metrics?.PAPER) {
      state.paperSize = normalizedId;
      return false;
    }

    const pxPerMm = getPxPerMmRatio();
    const nextPaper = createPaperMetrics(normalizedId, pxPerMm);
    if (!nextPaper) return false;

    const preserveMargins = options.preserveMargins ?? !silent;
    const updateColumns = options.updateColumns ?? !silent;
    const triggerLayout = options.triggerLayout ?? !silent;
    const scheduleMetricUpdate = options.scheduleMetrics ?? !silent;
    const triggerRewrap = options.triggerRewrap ?? !silent;
    const markDirtyNow = options.markDirty ?? !silent;
    const saveStateNow = options.save ?? !silent;
    const focusNow = options.focus ?? !silent;
    let leftMarginMm;
    let rightMarginMm;
    let topMarginMm;
    let bottomMarginMm;
    if (preserveMargins) {
      leftMarginMm = mmX(state.marginL || 0);
      rightMarginMm = mmX(Math.max(0, (app.PAGE_W || 0) - (state.marginR || 0)));
      topMarginMm = mmY(state.marginTop || 0);
      bottomMarginMm = mmY(Math.max(0, (app.PAGE_H || 0) - (state.marginBottom || 0)));
    }

    setRootPaperStyles(nextPaper);
    updatePaperMetricCache(nextPaper);
    state.paperSize = nextPaper.id;

    if (preserveMargins) {
      state.marginL = pxX(leftMarginMm || 0);
      state.marginR = app.PAGE_W - pxX(rightMarginMm || 0);
      state.marginTop = pxY(topMarginMm || 0);
      state.marginBottom = app.PAGE_H - pxY(bottomMarginMm || 0);
    }

    if (updateColumns) {
      const { cols2 } = computeColsFromCpi(state.cpi || 10);
      state.colsAcross = cols2;
    }

    if (triggerLayout) {
      layoutBridge.updateStageEnvironment();
      layoutBridge.renderMargins();
      layoutBridge.positionRulers();
    }

    if (scheduleMetricUpdate) {
      scheduleMetricsUpdate(true);
    }

    if (triggerRewrap) {
      rewrapDocumentToCurrentBounds();
    }

    if (markDirtyNow) {
      markDocumentDirty(state);
    }

    if (saveStateNow) {
      saveHooks.saveStateDebounced();
    }

    if (focusNow) {
      focusStage();
    }

    return true;
  }

  function toggleRulers() {
    state.showRulers = !state.showRulers;
    document.body.classList.toggle('rulers-off', !state.showRulers);
    syncRulerToggleButton(app.toggleMarginsBtn, state.showRulers);
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
    syncZoomControlsPanelOffset();
  }

  function computeColsFromCpi(cpi) {
    const paper = resolvePaperMetrics();
    const widthIn = paper?.widthIn || getPaperSize(DEFAULT_PAPER_SIZE)?.widthIn || (210 / 25.4);
    const raw = widthIn * cpi;
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
      if (page._dirtyRows?.size) {
        const shifted = new Set();
        for (const row of page._dirtyRows) {
          shifted.add(row + deltaMu);
        }
        page._dirtyRows = shifted;
      }
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
  scheduleMetricsUpdateRef = scheduleMetricsUpdate;

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
    applyPaperSizeSelection,
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
