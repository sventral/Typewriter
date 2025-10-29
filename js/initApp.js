import { createDomRefs } from './utils/domElements.js';
import { computeBaseMetrics } from './config/metrics.js';
import { createMainState, createEphemeralState } from './state/state.js';
import { EDGE_BLEED, GRAIN_CFG, INK_TEXTURE } from './config/inkConfig.js';
import { clamp } from './utils/math.js';
import { sanitizeIntegerField } from './utils/forms.js';
import { detectSafariEnvironment, createStageLayoutController } from './layout/stageLayout.js';
import { createLayoutAndZoomController } from './layout/layoutAndZoomController.js';
import { createGlyphAtlas } from './rendering/glyphAtlas.js';
import { createPageRenderer } from './rendering/pageRendering.js';
import { getInkEffectFactor, isInkSectionEnabled, setupInkSettingsPanel } from './config/inkSettingsPanel.js';
import { createDocumentEditingController } from './document/documentEditing.js';
import { createPageLifecycleController } from './document/pageLifecycle.js';

export function initApp(){

const app = createDomRefs();

const metrics = computeBaseMetrics(app);
const { DPR, GRID_DIV, COLORS, STORAGE_KEY, A4_WIDTH_IN, PPI, LPI, LINE_H_RAW } = metrics;
let { GRID_H, ACTIVE_FONT_NAME, RENDER_SCALE, FONT_FAMILY, FONT_SIZE, ASC, DESC, CHAR_W, BASELINE_OFFSET_CELL } = metrics;

const state = createMainState(app, GRID_DIV);

const ephemeral = createEphemeralState();
let {
  lastDigitTs,
  lastDigitCaret,
  bsBurstCount,
  bsBurstTs,
  lastPasteTs,
  typedRun,
  drag,
  saveTimer,
  zoomDebounceTimer,
  zooming,
  freezeVirtual,
  batchDepth,
  typingBatchRAF,
  metricsRAF,
  pendingFullRebuild,
  virtRAF,
  fontLoadSeq,
} = ephemeral;
const touchedPages = ephemeral.touchedPages;
let layoutZoomFactorRef = () => 1;

let layoutAndZoomApi = createNoopLayoutAndZoomApi();

function createNoopLayoutAndZoomApi() {
  return {
    updateStageEnvironment: () => {},
    renderMargins: () => {},
    positionRulers: () => {},
    setPaperOffset: () => {},
    requestHammerNudge: () => {},
    handleWheelPan: () => {},
    handleHorizontalMarginDrag: () => {},
    handleVerticalMarginDrag: () => {},
    endMarginDrag: () => {},
    setMarginBoxesVisible: () => {},
    setZoomPercent: () => {},
    updateZoomUIFromState: () => {},
    onZoomPointerDown: () => {},
    onZoomPointerMove: () => {},
    onZoomPointerUp: () => {},
    sanitizeStageInput: () => null,
  };
}

function updateStageEnvironment(...args) {
  return layoutAndZoomApi.updateStageEnvironment(...args);
}

function renderMargins(...args) {
  return layoutAndZoomApi.renderMargins(...args);
}

function positionRulers(...args) {
  return layoutAndZoomApi.positionRulers(...args);
}

function setPaperOffset(...args) {
  return layoutAndZoomApi.setPaperOffset(...args);
}

function requestHammerNudge(...args) {
  return layoutAndZoomApi.requestHammerNudge(...args);
}

function handleWheelPan(...args) {
  return layoutAndZoomApi.handleWheelPan(...args);
}

function handleHorizontalMarginDrag(...args) {
  return layoutAndZoomApi.handleHorizontalMarginDrag(...args);
}

function handleVerticalMarginDrag(...args) {
  return layoutAndZoomApi.handleVerticalMarginDrag(...args);
}

function endMarginDrag(...args) {
  return layoutAndZoomApi.endMarginDrag(...args);
}

function setMarginBoxesVisible(...args) {
  return layoutAndZoomApi.setMarginBoxesVisible(...args);
}

function setZoomPercent(...args) {
  return layoutAndZoomApi.setZoomPercent(...args);
}

function updateZoomUIFromState(...args) {
  return layoutAndZoomApi.updateZoomUIFromState(...args);
}

function onZoomPointerDown(...args) {
  return layoutAndZoomApi.onZoomPointerDown(...args);
}

function onZoomPointerMove(...args) {
  return layoutAndZoomApi.onZoomPointerMove(...args);
}

function onZoomPointerUp(...args) {
  return layoutAndZoomApi.onZoomPointerUp(...args);
}

let lifecycleController = null;
let pendingVirtualization = false;

const touchPage = (...args) => lifecycleController?.touchPage(...args);
const prepareCanvas = (...args) => lifecycleController?.prepareCanvas(...args);
const configureCanvasContext = (...args) => lifecycleController?.configureCanvasContext(...args);
const makePageRecord = (...args) => lifecycleController?.makePageRecord(...args);
const addPage = (...args) => lifecycleController?.addPage(...args);
const bootstrapFirstPage = (...args) => lifecycleController?.bootstrapFirstPage(...args);
const resetPagesBlankPreserveSettings = (...args) => lifecycleController?.resetPagesBlankPreserveSettings(...args);
const requestVirtualization = (...args) => {
  if (!lifecycleController) {
    pendingVirtualization = true;
    return;
  }
  return lifecycleController.requestVirtualization(...args);
};

const rendererHooks = {};
let rebuildAllAtlasesFn = () => {};

const editingController = createDocumentEditingController({
  app,
  state,
  getGridDiv: () => GRID_DIV,
  getGridHeight: () => GRID_H,
  getCharWidth: () => CHAR_W,
  getAsc: () => ASC,
  getDesc: () => DESC,
  getBaselineOffsetCell: () => BASELINE_OFFSET_CELL,
  getActiveFontName: () => ACTIVE_FONT_NAME,
  setActiveFontName: (name) => { ACTIVE_FONT_NAME = name; FONT_FAMILY = `${name}`; },
  touchedPages,
  getFreezeVirtual: () => freezeVirtual,
  setFreezeVirtual: (value) => { freezeVirtual = value; },
  requestVirtualization,
  positionRulers,
  saveStateDebounced,
  saveStateNow,
  renderMargins,
  beginBatch,
  endBatch,
  addPage,
  makePageRecord,
  prepareCanvas,
  configureCanvasContext,
  recalcMetrics,
  rebuildAllAtlases: (...args) => rebuildAllAtlasesFn(...args),
  setPaperOffset,
  applyDefaultMargins,
  computeColsFromCpi,
  rendererHooks,
  layoutZoomFactor: () => layoutZoomFactorRef(),
  requestHammerNudge,
  isZooming: () => zooming,
  resetPagesBlankPreserveSettings,
});

const lifecycleContext = {
  app,
  state,
  layoutZoomFactor: () => layoutZoomFactorRef(),
  getRenderScale: () => RENDER_SCALE,
  getFontSize: () => FONT_SIZE,
  getActiveFontName: () => ACTIVE_FONT_NAME,
  exactFontString,
  getGridHeight: () => GRID_H,
  getCharWidth: () => CHAR_W,
  getFreezeVirtual: () => freezeVirtual,
  getVirtRAF: () => virtRAF,
  setVirtRAF: (value) => { virtRAF = value; },
  renderMargins,
  positionRulers,
  resetTypedRun,
};

lifecycleController = createPageLifecycleController(lifecycleContext, editingController);

if (pendingVirtualization) {
  pendingVirtualization = false;
  lifecycleController.requestVirtualization();
}

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

const { isSafari: IS_SAFARI, supersampleThreshold: SAFARI_SUPERSAMPLE_THRESHOLD } = detectSafariEnvironment();

const { rebuildAllAtlases, drawGlyph, applyGrainOverlayOnRegion } = createGlyphAtlas({
  app,
  state,
  colors: COLORS,
  getFontSize: () => FONT_SIZE,
  getActiveFontName: () => ACTIVE_FONT_NAME,
  getAsc: () => ASC,
  getDesc: () => DESC,
  getCharWidth: () => CHAR_W,
  getRenderScale: () => RENDER_SCALE,
  getStateZoom: () => state.zoom,
  isSafari: IS_SAFARI,
  safariSupersampleThreshold: SAFARI_SUPERSAMPLE_THRESHOLD,
  getInkEffectFactor,
  isInkSectionEnabled,
  inkTextureConfig: () => INK_TEXTURE,
  edgeBleedConfig: () => EDGE_BLEED,
  grainConfig: () => GRAIN_CFG,
});

rebuildAllAtlasesFn = rebuildAllAtlases;

const {
  layoutZoomFactor,
  cssScaleFactor,
  sanitizedStageWidthFactor,
  sanitizedStageHeightFactor,
  stageDimensions,
  toolbarHeightPx,
  sanitizeStageInput,
  updateZoomWrapTransform,
  syncSafariZoomLayout,
  setSafariZoomMode,
  isSafariSteadyZoom,
} = createStageLayoutController({
  app,
  state,
  isSafari: IS_SAFARI,
  renderMargins,
  updateStageEnvironment,
  updateCaretPosition,
});

const {
  refreshGlyphEffects,
  refreshGrainEffects,
  markRowAsDirty,
  schedulePaint,
} = createPageRenderer({
  app,
  state,
  getAsc: () => ASC,
  getDesc: () => DESC,
  getCharWidth: () => CHAR_W,
  getGridHeight: () => GRID_H,
  gridDiv: GRID_DIV,
  getRenderScale: () => RENDER_SCALE,
  rebuildAllAtlases,
  drawGlyph,
  applyGrainOverlayOnRegion,
  lifecycle: lifecycleController,
  getCurrentBounds,
  getBatchDepth: () => batchDepth,
});

Object.assign(rendererHooks, { markRowAsDirty, schedulePaint });

lifecycleController.registerRendererHooks({ schedulePaint });

layoutAndZoomApi = createLayoutAndZoomController(
  {
    app,
    state,
    DPR,
    getCharWidth: () => CHAR_W,
    getGridHeight: () => GRID_H,
    getAsc: () => ASC,
    getDesc: () => DESC,
    getLineStepMu: () => state.lineStepMu,
    layoutController: {
      layoutZoomFactor,
      cssScaleFactor,
      stageDimensions,
      toolbarHeightPx,
      updateZoomWrapTransform,
      sanitizeStageInput,
      setSafariZoomMode,
      isSafariSteadyZoom,
    },
    requestVirtualization,
    saveStateDebounced,
    setRenderScaleForZoom,
    prepareCanvas,
    configureCanvasContext,
    schedulePaint,
    rebuildAllAtlases,
    setFreezeVirtual: (value) => { freezeVirtual = value; },
    getZooming: () => zooming,
    setZooming: (value) => { zooming = value; },
    getZoomDebounceTimer: () => zoomDebounceTimer,
    setZoomDebounceTimer: (value) => { zoomDebounceTimer = value; },
    getDrag: () => drag,
    setDrag: (value) => { drag = value; },
    isSafari: IS_SAFARI,
    setSafariZoomMode,
    syncSafariZoomLayout,
  },
  lifecycleController,
  editingController,
);

layoutZoomFactorRef = layoutZoomFactor;

function computeColsFromCpi(cpi){
  const raw = A4_WIDTH_IN * cpi;
  const cols3 = Math.round(raw * 1000) / 1000;
  const cols2 = Math.round(cols3 * 100) / 100;
  return { cols3, cols2 };
}

function updateColsPreviewUI(){
  const cpi = parseFloat(app.cpiSelect?.value) || 10;
  const { cols2 } = computeColsFromCpi(cpi);
  if (app.colsPreviewSpan) {
    app.colsPreviewSpan.textContent = `Columns: ${cols2.toFixed(2)}`;
  }
}

function readStagedCpi(){
  return parseFloat(app.cpiSelect?.value) || 10;
}

function readStagedSize(){
  const fallback = Number.isFinite(state.inkWidthPct) ? clamp(Math.round(state.inkWidthPct), 1, 150) : 84;
  const val = sanitizeIntegerField(app.sizeInput, { min:1, max:150, allowEmpty:false, fallbackValue: fallback });
  return (typeof val === 'number' && Number.isFinite(val)) ? val : fallback;
}

function applySubmittedChanges(){
  const newCpi = readStagedCpi();
  const { cols2 } = computeColsFromCpi(newCpi);
  const newCols = cols2;
  const cpiChanged  = (typeof state.cpi === 'number' ? newCpi !== state.cpi : true);
  const stagedSize = readStagedSize();
  const inkChanged  = (typeof state.inkWidthPct === 'number' ? stagedSize !== state.inkWidthPct : true);
  if (!cpiChanged && !inkChanged){ focusStage(); return; }
  beginBatch();
  if (inkChanged) state.inkWidthPct = stagedSize;
  if (cpiChanged) state.cpi = newCpi;
  const colsChanged = (newCols !== state.colsAcross);
  if (colsChanged) state.colsAcross = newCols;
  scheduleMetricsUpdate(true);
  if (colsChanged){
    let tries = 0;
    const target = Math.round((app.PAGE_W / state.colsAcross) * DPR) / DPR;
    const waitForMetrics = () => {
      if (Math.abs(CHAR_W - target) < 0.01 || tries++ > 12){
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
    for (const p of state.pages){ p.dirtyAll = true; schedulePaint(p); }
    renderMargins();
    clampCaretToBounds();
    updateCaretPosition();
    positionRulers();
    requestVirtualization();
    saveStateDebounced();
    endBatch();
    focusStage();
  }
}

function setLineHeightFactor(f){
  const allowed = [1, 1.5, 2, 2.5, 3];
  const clamped = allowed.includes(f) ? f : 1;
  state.lineHeightFactor = clamped;
  state.lineStepMu = Math.round(GRID_DIV * clamped);
  clampCaretToBounds();
  updateCaretPosition();
  positionRulers();
  saveStateDebounced();
}

function readStagedLH(){
  const v = parseFloat(app.lhInput?.value)||1;
  const allowed = [1, 1.5, 2, 2.5, 3];
  let best = allowed[0], bd = Math.abs(v - allowed[0]);
  for (let i=1;i<allowed.length;i++){
    const d = Math.abs(v - allowed[i]);
    if (d < bd || (d === bd && allowed[i] < best)){ bd = d; best = allowed[i]; }
  }
  if (app.lhInput) app.lhInput.value = String(best);
  return best;
}

function applyLineHeight(){
  setLineHeightFactor(readStagedLH());
  focusStage();
}

function toggleFontsPanel() {
  const isOpen = app.fontsPanel.classList.toggle('is-open');
  if (isOpen) {
    for (const radio of app.fontRadios()) {
      radio.checked = radio.value === ACTIVE_FONT_NAME;
    }
    app.settingsPanel.classList.remove('is-open');
    if (app.inkSettingsPanel) app.inkSettingsPanel.classList.remove('is-open');
  }
}

function toggleSettingsPanel() {
  const isOpen = app.settingsPanel.classList.toggle('is-open');
  if (isOpen) {
    app.fontsPanel.classList.remove('is-open');
    if (app.inkSettingsPanel) app.inkSettingsPanel.classList.remove('is-open');
  }
}

function toggleInkSettingsPanel() {
  if (!app.inkSettingsPanel) return;
  const isOpen = app.inkSettingsPanel.classList.toggle('is-open');
  if (isOpen) {
    app.fontsPanel.classList.remove('is-open');
    app.settingsPanel.classList.remove('is-open');
  }
}

const TYPED_RUN_MAXLEN = 20;
const TYPED_RUN_TIMEOUT = 500;
const EXPAND_PASTE_WINDOW = 350;
const BS_WINDOW = 250;
const STRAY_V_WINDOW = 30;

function isEditableTarget(target) {
  if (!target) return false;
  if (isToolbarInput(target)) return false;
  const tag = (target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  const dlg = target.closest && (target.closest('dialog.settings-modal') || target.closest('aside.side-panel'));
  if (dlg && (dlg.open || dlg.classList.contains('is-open'))) return true;
  return false;
}

function resetTypedRun() {
  typedRun.active = false;
}

function noteTypedCharPreInsert() {
  const now = performance.now();
  const caret = state.caret;
  const contiguous =
    typedRun.active &&
    typedRun.page === caret.page &&
    typedRun.rowMu === caret.rowMu &&
    caret.col === typedRun.startCol + typedRun.length &&
    now - typedRun.lastTs <= TYPED_RUN_TIMEOUT &&
    typedRun.length < TYPED_RUN_MAXLEN;

  if (contiguous) {
    typedRun.length += 1;
    typedRun.lastTs = now;
  } else {
    typedRun.active = true;
    typedRun.page = caret.page;
    typedRun.rowMu = caret.rowMu;
    typedRun.startCol = caret.col;
    typedRun.length = 1;
    typedRun.lastTs = now;
  }
}

function consumeBackspaceBurstIfAny() {
  const now = performance.now();
  if (now - bsBurstTs < BS_WINDOW && bsBurstCount > 0) {
    const page = state.pages[state.caret.page] || addPage();
    eraseCharacters(page, state.caret.rowMu, state.caret.col, bsBurstCount);
    bsBurstCount = 0;
    bsBurstTs = 0;
    resetTypedRun();
    return true;
  }
  return false;
}

const NUM_INPUT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Backspace',
  'Delete',
  'Tab',
]);

function isDigitKey(key) {
  return key.length === 1 && /[0-9]/.test(key);
}

function handleKeyDown(e) {
  if (isEditableTarget(e.target)) return;

  if (e.target && isToolbarInput(e.target)) {
    const key = e.key;
    const allowDecimal = e.target.id === 'lhInput';
    if (key === 'Enter') {
      e.preventDefault();
      if (e.target.id === 'lhInput') applyLineHeight();
      else applySubmittedChanges();
      focusStage();
      return;
    }
    if (
      NUM_INPUT_KEYS.has(key) ||
      isDigitKey(key) ||
      (key === ',' && allowDecimal) ||
      (key === '.' && allowDecimal)
    ) {
      return;
    }
    try { e.target.blur(); } catch {}
    focusStage();
  }

  const key = e.key;
  const bounds = getCurrentBounds();

  if (e.metaKey || e.ctrlKey) {
    if (key.toLowerCase() === 'v' && performance.now() - lastDigitTs < 180 && lastDigitCaret) {
      state.caret = { ...lastDigitCaret };
      updateCaretPosition();
    }
    return;
  }

  if (key === 'Enter') {
    e.preventDefault();
    resetTypedRun();
    handleNewline();
    saveStateDebounced();
    return;
  }

  if (key === 'Backspace') {
    e.preventDefault();
    const now = performance.now();
    if (now - bsBurstTs < 200) bsBurstCount += 1; else bsBurstCount = 1;
    bsBurstTs = now;
    beginTypingFrameBatch();
    handleBackspace();
    resetTypedRun();
    saveStateDebounced();
    return;
  }

  if (key === 'ArrowLeft') {
    e.preventDefault();
    resetTypedRun();
    state.caret.col = clamp(state.caret.col - 1, bounds.L, bounds.R);
    updateCaretPosition();
    return;
  }

  if (key === 'ArrowRight') {
    e.preventDefault();
    resetTypedRun();
    state.caret.col = clamp(state.caret.col + 1, bounds.L, bounds.R);
    updateCaretPosition();
    return;
  }

  if (key === 'ArrowUp') {
    e.preventDefault();
    resetTypedRun();
    state.caret.rowMu = clamp(state.caret.rowMu - state.lineStepMu, bounds.Tmu, bounds.Bmu);
    updateCaretPosition();
    return;
  }

  if (key === 'ArrowDown') {
    e.preventDefault();
    resetTypedRun();
    state.caret.rowMu = clamp(state.caret.rowMu + state.lineStepMu, bounds.Tmu, bounds.Bmu);
    updateCaretPosition();
    return;
  }

  if (key === 'Tab') {
    e.preventDefault();
    resetTypedRun();
    for (let i = 0; i < 5; i += 1) advanceCaret();
    saveStateDebounced();
    return;
  }

  if (key.length === 1) {
    e.preventDefault();
    if (key === 'v' && performance.now() - lastPasteTs < STRAY_V_WINDOW) return;

    if (/[0-9]/.test(key)) {
      lastDigitTs = performance.now();
      lastDigitCaret = { ...state.caret };
    } else {
      lastDigitTs = 0;
      lastDigitCaret = null;
    }

    beginTypingFrameBatch();
    consumeBackspaceBurstIfAny();
    noteTypedCharPreInsert();
    const page = state.pages[state.caret.page] || addPage();
    overtypeCharacter(page, state.caret.rowMu, state.caret.col, key, state.ink);
    advanceCaret();
    saveStateDebounced();
  }
}

function handlePaste(e) {
  if (isEditableTarget(e.target)) return;

  const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
  if (!text) return;

  e.preventDefault();
  lastPasteTs = performance.now();

  beginBatch();

  if (!consumeBackspaceBurstIfAny()) {
    const fresh =
      typedRun.active &&
      typedRun.page === state.caret.page &&
      typedRun.rowMu === state.caret.rowMu &&
      lastPasteTs - typedRun.lastTs <= EXPAND_PASTE_WINDOW &&
      typedRun.length > 0 &&
      typedRun.length <= TYPED_RUN_MAXLEN;

    if (fresh) {
      state.caret.col = typedRun.startCol;
      updateCaretPosition();
      const page = state.pages[state.caret.page] || addPage();
      eraseCharacters(page, state.caret.rowMu, state.caret.col, typedRun.length);
      resetTypedRun();
    }
  }

  insertTextFast(text);

  resetTypedRun();
  endBatch();
}

function mmX(px){ return (px * 210) / app.PAGE_W; }
function mmY(px){ return (px * 297) / app.PAGE_H; }
function pxX(mm){ return (mm * app.PAGE_W) / 210; }
function pxY(mm){ return (mm * app.PAGE_H) / 297; }

function focusStage(){
  if (!app.stage) return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active !== app.stage) {
      try { active.blur(); } catch {}
    }
    try { app.stage.focus({ preventScroll: true }); }
    catch { try { app.stage.focus(); } catch {} }
  });
}

function isToolbarInput(el){
  if (!el) return false;
  const id = el.id || '';
  return (
    id === 'sizeInput' || id === 'lhInput' || id === 'cpiSelect' ||
    id === 'showMarginBoxCb' || id === 'wordWrapCb' ||
    id === 'mmLeft' || id === 'mmRight' || id === 'mmTop' || id === 'mmBottom' ||
    id === 'grainPct' || id === 'stageWidthPct' || id === 'stageHeightPct' ||
    id.includes('Slider')
  );
}

function beginBatch(){ batchDepth++; }
function endBatch(){
  if (batchDepth > 0) batchDepth--;
  if (batchDepth === 0){
    for (const page of touchedPages) schedulePaint(page);
    touchedPages.clear();
  }
}
function beginTypingFrameBatch(){
  if (batchDepth === 0) beginBatch();
  if (!typingBatchRAF){
    typingBatchRAF = requestAnimationFrame(()=>{ typingBatchRAF = 0; endBatch(); });
  }
}
function getTargetPitchPx(){ return app.PAGE_W / state.colsAcross; }
function targetPitchForCpi(cpi){
  const { cols2 } = computeColsFromCpi(cpi);
  return app.PAGE_W / cols2;
}
function exactFontString(sizePx, face){ return `400 ${sizePx}px "${face}"`; }

const FONT_CANDIDATES = [
  () => ACTIVE_FONT_NAME, () => 'TT2020Base', () => 'TT2020StyleB',
  () => 'TT2020StyleD', () => 'TT2020StyleE', () => 'TT2020StyleF',
  () => 'TT2020StyleG', () => 'Courier New', () => 'Courier',
  () => 'ui-monospace', () => 'Menlo', () => 'Monaco', () => 'Consolas',
  () => 'Liberation Mono', () => 'monospace'
];

function faceAvailable(face){
  if (face === 'monospace') return true;
  try { return document.fonts.check(`12px "${face}"`, 'MW@#123'); } catch { return false; }
}

async function resolveAvailableFace(preferredFace){
  try { await document.fonts.ready; } catch {}
  const tried = new Set();
  const ordered = [preferredFace, ...FONT_CANDIDATES.map(f=>f()).filter(Boolean)];
  for (const face of ordered){
    if (tried.has(face)) continue;
    tried.add(face);
    if (faceAvailable(face)) return face;
    try { await document.fonts.load(`400 1em "${face}"`, 'MWmw123'); } catch {}
    if (faceAvailable(face)) return face;
  }
  return 'monospace';
}

function baseCaretHeightPx(){
  return GRID_DIV * GRID_H;
}

function calibrateMonospaceFont(targetPitchPx, face, inkWidthPct){
  const pct = (typeof inkWidthPct === 'number' && isFinite(inkWidthPct)) ? inkWidthPct : 84;
  const targetInkPx = Math.max(0.25, targetPitchPx * (pct / 100));
  const BASE = 200;
  const TEST = 'MW@#%&()[]{}|/\\abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const c = document.createElement('canvas').getContext('2d');
  const wmax = size => { c.font = exactFontString(size, face); let m=0; for (const ch of TEST) m=Math.max(m, c.measureText(ch).width); return m + 0.25; };
  let size = Math.max(1, targetInkPx * BASE / wmax(BASE));
  for (let i=0;i<8;i++){ const r = targetInkPx / Math.max(0.25, wmax(size)); if (Math.abs(1-r) < 0.002) break; size = Math.max(1, size * r); }
  while (wmax(size) > targetInkPx) size = Math.max(1, size - 0.25);
  c.font = exactFontString(size, face);
  const m = c.measureText('Hg');
  return { size, asc: m.actualBoundingBoxAscent || size*0.8, desc: m.actualBoundingBoxDescent || size*0.2 };
}

const roundToDPR = (v) => {
  const q = Math.round(v * DPR);
  let r = q / DPR;
  if (r > v) r = (q - 1) / DPR;
  return Math.max(0.25, r);
};

function computeMaxRenderScale(){
  const cap = 8192;
  const limitW = cap / app.PAGE_W;
  const limitH = cap / app.PAGE_H;
  return Math.max(1, Math.min(limitW, limitH));
}
function setRenderScaleForZoom(){
  const buckets = [1, 1.5, 2, 3, 4];
  const zb = buckets.reduce((best, z)=> Math.abs(z - state.zoom) < Math.abs(best - state.zoom) ? z : best, buckets[0]);
  const desired = DPR * zb;
  RENDER_SCALE = Math.min(desired, computeMaxRenderScale());
}
function prewarmFontFace(face){
  const px = Math.max(12, Math.ceil(getTargetPitchPx()));
  const ghost = document.createElement('span');
  ghost.textContent = 'MWmw1234567890';
  ghost.style.cssText = `position:fixed;left:-9999px;top:-9999px;visibility:hidden;font:${exactFontString(px, face)};`;
  document.body.appendChild(ghost);
  return ghost;
}

async function loadFontAndApply(requestedFace){
  const seq = ++fontLoadSeq;
  const tryFace = requestedFace || ACTIVE_FONT_NAME;
  const ghost = prewarmFontFace(tryFace);
  try {
    const px = Math.max(12, Math.ceil(getTargetPitchPx()));
    await Promise.race([
      (async () => {
        await document.fonts.load(exactFontString(px, tryFace), 'MWmw123');
        await document.fonts.load(`400 1em "${tryFace}"`, 'MWmw123');
      })(),
      new Promise(res => setTimeout(res, 1200))
    ]);
  } catch {}
  ghost.remove();

  const resolvedFace = await resolveAvailableFace(tryFace);
  if (seq !== fontLoadSeq) return;

  ACTIVE_FONT_NAME = resolvedFace;
  FONT_FAMILY = `${ACTIVE_FONT_NAME}`;
  applyMetricsNow(true);
}


function recalcMetrics(face){
  const targetPitch = getTargetPitchPx();
  const m = calibrateMonospaceFont(targetPitch, face, state.inkWidthPct);
  FONT_SIZE = m.size;
  ASC = m.asc; DESC = m.desc;
  CHAR_W = roundToDPR(targetPitch);
  GRID_H = LINE_H_RAW / GRID_DIV;
  BASELINE_OFFSET_CELL = ASC;
  app.caretEl.style.height = baseCaretHeightPx() + 'px';
}
function scheduleMetricsUpdate(full=false){
  pendingFullRebuild = pendingFullRebuild || full;
  if (metricsRAF) return;
  metricsRAF = requestAnimationFrame(()=>{
    metricsRAF = 0;
    applyMetricsNow(pendingFullRebuild);
    pendingFullRebuild=false;
  });
}

function applyMetricsNow(full=false){
  beginBatch();
  recalcMetrics(ACTIVE_FONT_NAME);
  rebuildAllAtlases();
  for (const p of state.pages){
    p.grainCanvas = null;
    p.grainForSize = { w:0, h:0 };
    configureCanvasContext(p.ctx);
    configureCanvasContext(p.backCtx);
    p.dirtyAll = true;
    touchPage(p);
    if (p.active) schedulePaint(p);
  }
  renderMargins();
  updateStageEnvironment();
  clampCaretToBounds();
  updateCaretPosition();
  positionRulers();
  requestVirtualization();
  saveStateDebounced();
  endBatch();
}

function saveStateNow(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState())); }catch{} }
function saveStateDebounced(){ if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(saveStateNow, 400); }
function applyDefaultMargins() {
  const mmw = app.PAGE_W / 210, mmh = app.PAGE_H / 297, mW = 20 * mmw, mH = 20 * mmh;
  state.marginL = mW; state.marginR = app.PAGE_W - mW;
  state.marginTop = mH; state.marginBottom = mH;
}
function toggleRulers(){
  state.showRulers = !state.showRulers;
  document.body.classList.toggle('rulers-off', !state.showRulers);
  positionRulers();
  saveStateDebounced();
}

function exportToTextFile(){
  const out=[];
  for (let p=0;p<state.pages.length;p++){
    const page=state.pages[p];
    if (!page){ out.push(''); continue; }
    const rows = Array.from(page.grid.keys()).sort((a,b)=>a-b);
    if (!rows.length){ out.push(''); continue; }
    for (let i=0;i<rows.length;i++){
      const rmu = rows[i];
      const rowMap = page.grid.get(rmu);
      let minCol = Infinity, maxCol = -1;
      for (const c of rowMap.keys()){ if (c < minCol) minCol = c; if (c > maxCol) maxCol = c; }
      if (!isFinite(minCol) || maxCol < 0){ out.push(''); continue; }
      let line = '';
      for (let c=minCol;c<=maxCol;c++){
        const st=rowMap?.get(c);
        line += st && st.length ? st[st.length-1].char : ' ';
      }
      out.push(line.replace(/\s+$/,''));
    }
    if (p<state.pages.length-1) out.push('');
  }
  const txt = out.join('\n');
  const blob = new Blob([txt], {type:'text/plain;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='typewriter.txt';
  document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();
}

function bindEventListeners(){
  app.toggleMarginsBtn.onclick = toggleRulers;
  app.exportBtn.addEventListener('click', exportToTextFile);
  if (app.newDocBtn) app.newDocBtn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); createNewDocument(); });

  const onOpacitySliderInput = (key, sliderEl, valueEl) => {
    const v = parseInt(sliderEl.value, 10);
    valueEl.textContent = `${v}%`;
    state.inkOpacity[key] = v;
    saveStateDebounced();
    for (const p of state.pages){ if (p.active){ p.dirtyAll = true; schedulePaint(p); } }
  };
  app.inkOpacityBSlider.addEventListener('input', () => onOpacitySliderInput('b', app.inkOpacityBSlider, app.inkOpacityBValue));
  app.inkOpacityRSlider.addEventListener('input', () => onOpacitySliderInput('r', app.inkOpacityRSlider, app.inkOpacityRValue));
  app.inkOpacityWSlider.addEventListener('input', () => onOpacitySliderInput('w', app.inkOpacityWSlider, app.inkOpacityWValue));

  const LONG_PRESS_DURATION = 500;
  const setupInkButton = (btn, ink, popup) => {
    let pressTimer = null;
    let isLongPress = false;
    const startPress = () => {
      isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true;
        const allPopups = [app.inkBlackSliderPopup, app.inkRedSliderPopup, app.inkWhiteSliderPopup];
        allPopups.forEach(p => { if (p !== popup) p.classList.remove('active'); });
        popup.classList.add('active');
      }, LONG_PRESS_DURATION);
    };
    const endPress = () => {
      clearTimeout(pressTimer);
      if (!isLongPress) {
        setInk(ink);
        const allPopups = [app.inkBlackSliderPopup, app.inkRedSliderPopup, app.inkWhiteSliderPopup];
        allPopups.forEach(p => p.classList.remove('active'));
      }
    };
    btn.addEventListener('pointerdown', startPress);
    btn.addEventListener('pointerup', endPress);
    btn.addEventListener('pointerleave', () => clearTimeout(pressTimer));
    popup.addEventListener('pointerdown', e => e.stopPropagation());
  };
  setupInkButton(app.inkBlackBtn, 'b', app.inkBlackSliderPopup);
  setupInkButton(app.inkRedBtn, 'r', app.inkRedSliderPopup);
  setupInkButton(app.inkWhiteBtn, 'w', app.inkWhiteSliderPopup);
  document.body.addEventListener('pointerdown', () => {
    [app.inkBlackSliderPopup, app.inkRedSliderPopup, app.inkWhiteSliderPopup].forEach(p => p.classList.remove('active'));
  });

  app.grainInput.addEventListener('input', ()=>{
    const v = clamp(parseInt(app.grainInput.value || '0', 10), 0, 100);
    app.grainInput.value = String(v);
    state.grainPct = v;
    saveStateDebounced();
    for (const p of state.pages){ if (p.active){ p.dirtyAll = true; schedulePaint(p); } }
  });

  app.fontsBtn.onclick = toggleFontsPanel;
  app.settingsBtnNew.onclick = toggleSettingsPanel;
  if (app.inkSettingsBtn) app.inkSettingsBtn.onclick = toggleInkSettingsPanel;
  window.addEventListener('keydown', e=>{ if (e.key === 'Escape') {
    app.fontsPanel.classList.remove('is-open');
    app.settingsPanel.classList.remove('is-open');
    if (app.inkSettingsPanel) app.inkSettingsPanel.classList.remove('is-open');
  }});
  app.fontRadios().forEach(radio=>{ radio.addEventListener('change', async ()=>{ if (radio.checked){ await loadFontAndApply(radio.value); focusStage(); } }); });

  const applyMm = ()=>{
    state.marginL = pxX(Math.max(0, Number(app.mmLeft?.value)  || 0));
    state.marginR = app.PAGE_W - pxX(Math.max(0, Number(app.mmRight?.value) || 0));
    state.marginTop = pxY(Math.max(0, Number(app.mmTop?.value)   || 0));
    state.marginBottom = pxY(Math.max(0, Number(app.mmBottom?.value)|| 0));
    renderMargins(); clampCaretToBounds(); updateCaretPosition(); positionRulers(); saveStateDebounced();
  };
  [app.mmLeft, app.mmRight, app.mmTop, app.mmBottom].forEach(inp=>{
    if (!inp) return;
    inp.addEventListener('input', ()=>{
      sanitizeIntegerField(inp, { min:0, allowEmpty:true });
      applyMm();
    });
    inp.addEventListener('change', ()=>{
      sanitizeIntegerField(inp, { min:0, allowEmpty:false, fallbackValue:0 });
      applyMm();
      focusStage();
    });
  });

  const updateStageBounds = (allowEmpty)=>{
    const widthFactor = sanitizeStageInput(app.stageWidthPct, state.stageWidthFactor, allowEmpty, true);
    const heightFactor = sanitizeStageInput(app.stageHeightPct, state.stageHeightFactor, allowEmpty, false);
    if (widthFactor == null || heightFactor == null) return;
    const changed = (widthFactor !== state.stageWidthFactor) || (heightFactor !== state.stageHeightFactor);
    state.stageWidthFactor = widthFactor;
    state.stageHeightFactor = heightFactor;
    updateStageEnvironment();
    if (changed) saveStateDebounced();
  };
  [app.stageWidthPct, app.stageHeightPct].forEach(inp=>{
    if (!inp) return;
    inp.addEventListener('input', ()=> updateStageBounds(true));
    inp.addEventListener('change', ()=>{ updateStageBounds(false); focusStage(); });
  });

  if (app.sizeInput){
    app.sizeInput.addEventListener('input', ()=>{ sanitizeIntegerField(app.sizeInput, { min:1, max:150, allowEmpty:true }); });
    app.sizeInput.addEventListener('change', ()=>{
      sanitizeIntegerField(app.sizeInput, { min:1, max:150, allowEmpty:false, fallbackValue: state.inkWidthPct || 84 });
      focusStage();
    });
    const applyOnEnter = (e)=>{ if (e.key === 'Enter') { e.preventDefault(); applySubmittedChanges(); } };
    app.sizeInput.addEventListener('keydown', applyOnEnter);
  }

  if (app.applyBtn) app.applyBtn.addEventListener('click', applySubmittedChanges);
  if (app.applyLHBtn) app.applyLHBtn.addEventListener('click', applyLineHeight);
  if (app.lhInput) app.lhInput.addEventListener('input', ()=>{ app.lhInput.value = String(readStagedLH()); });
  if (app.showMarginBoxCb) app.showMarginBoxCb.addEventListener('change', ()=>{ state.showMarginBox = !!app.showMarginBoxCb.checked; renderMargins(); saveStateDebounced(); focusStage(); });

  if (app.cpiSelect) app.cpiSelect.addEventListener('change', ()=>{ updateColsPreviewUI(); focusStage(); });

  if (app.wordWrapCb){
    app.wordWrapCb.addEventListener('change', ()=>{
      state.wordWrap = !!app.wordWrapCb.checked;
      saveStateDebounced();
      focusStage();
    });
  }

  app.rulerH_stops_container.addEventListener('pointerdown', e=>{
    const tri = e.target.closest('.tri'); if (!tri) return;
    e.preventDefault();
    drag = { kind:'h', side: tri.classList.contains('left') ? 'left' : 'right', pointerId: e.pointerId };
    setMarginBoxesVisible(false);
    (tri.setPointerCapture && tri.setPointerCapture(e.pointerId));
    document.addEventListener('pointermove', handleHorizontalMarginDrag);
    document.addEventListener('pointerup', endMarginDrag, true);
    document.addEventListener('pointercancel', endMarginDrag, true);
  }, {passive:false});
  app.rulerV_stops_container.addEventListener('pointerdown', e=>{
    const tri = e.target.closest('.tri-v'); if (!tri) return;
    e.preventDefault();
    drag = { kind:'v', side: tri.classList.contains('top') ? 'top' : 'bottom', pointerId: e.pointerId };
    setMarginBoxesVisible(false);
    (tri.setPointerCapture && tri.setPointerCapture(e.pointerId));
    document.addEventListener('pointermove', handleVerticalMarginDrag);
    document.addEventListener('pointerup', endMarginDrag, true);
    document.addEventListener('pointercancel', endMarginDrag, true);
  }, {passive:false});

  app.zoomSlider.addEventListener('pointerdown', onZoomPointerDown, {passive:false});
  window.addEventListener('pointermove', onZoomPointerMove, {passive:true});
  window.addEventListener('pointerup', onZoomPointerUp, {passive:true});
  app.zoomIndicator.addEventListener('dblclick', ()=> setZoomPercent(100));

  window.addEventListener('keydown', handleKeyDown, { capture: true });
  window.addEventListener('paste', handlePaste, { capture: true });
  app.stage.addEventListener('wheel', handleWheelPan, { passive: false });
  window.addEventListener('resize', () => { positionRulers(); if (!zooming) requestHammerNudge(); requestVirtualization(); }, { passive: true });
  window.addEventListener('beforeunload', saveStateNow);
  window.addEventListener('click', () => window.focus(), { passive: true });
}

async function initialize() {
  bindEventListeners();
  setupInkSettingsPanel({
    refreshGlyphs: refreshGlyphEffects,
    refreshGrain: refreshGrainEffects
  });
  bootstrapFirstPage();
  let raw = null, loaded = false, savedFont = null;
  try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
  if (raw) savedFont = raw.fontName;
  try { loaded = deserializeState(raw); } catch {}

  app.inkOpacityBSlider.value = String(state.inkOpacity.b);
  app.inkOpacityRSlider.value = String(state.inkOpacity.r);
  app.inkOpacityWSlider.value = String(state.inkOpacity.w);
  app.inkOpacityBValue.textContent = `${state.inkOpacity.b}%`;
  app.inkOpacityRValue.textContent = `${state.inkOpacity.r}%`;
  app.inkOpacityWValue.textContent = `${state.inkOpacity.w}%`;

  app.grainInput.value  = String(state.grainPct);
  app.cpiSelect.value = String(state.cpi || 10);
  updateColsPreviewUI();
  app.sizeInput.value = String(clamp(Math.round(state.inkWidthPct ?? 84), 1, 150));
  app.lhInput.value = String(state.lineHeightFactor);
  app.showMarginBoxCb.checked = !!state.showMarginBox;
  if (app.wordWrapCb) app.wordWrapCb.checked = !!state.wordWrap;
  app.mmLeft.value   = Math.round(mmX(state.marginL));
  app.mmRight.value  = Math.round(mmX(app.PAGE_W - state.marginR));
  app.mmTop.value    = Math.round(mmY(state.marginTop));
  app.mmBottom.value = Math.round(mmY(state.marginBottom));
  if (app.stageWidthPct) app.stageWidthPct.value = String(Math.round(sanitizedStageWidthFactor() * 100));
  if (app.stageHeightPct) app.stageHeightPct.value = String(Math.round(sanitizedStageHeightFactor() * 100));

  if (!loaded){
    state.cpi = 10;
    state.colsAcross = computeColsFromCpi(10).cols2;
    state.inkWidthPct = 84;
    state.inkOpacity = { b:100, r:100, w:100 };
    state.grainPct = 0;
    state.grainSeed = ((Math.random()*0xFFFFFFFF)>>>0);
    state.altSeed = ((Math.random()*0xFFFFFFFF)>>>0);
    state.wordWrap = true;
    applyDefaultMargins();
  }

  updateStageEnvironment();
  setZoomPercent(Math.round(state.zoom*100) || 100);
  updateZoomUIFromState();
  setPaperOffset(0,0);
  await loadFontAndApply(savedFont || ACTIVE_FONT_NAME);
  setLineHeightFactor(state.lineHeightFactor);
  renderMargins();
  clampCaretToBounds();
  updateCaretPosition();
  document.body.classList.toggle('rulers-off', !state.showRulers);
  if (state.showRulers) positionRulers();
  setInk(state.ink || 'b');
  requestVirtualization();
}

initialize();
}
