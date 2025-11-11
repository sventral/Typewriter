import { exactFontString } from '../config/metrics.js';
import { markDocumentDirty } from '../state/saveRevision.js';
import { EDGE_BLEED, EDGE_FUZZ, GRAIN_CFG, INK_TEXTURE } from '../config/inkConfig.js';
import { clamp } from '../utils/math.js';
import { sanitizeIntegerField } from '../utils/forms.js';
import { detectSafariEnvironment, createStageLayoutController } from '../layout/stageLayout.js';
import { createLayoutAndZoomController } from '../layout/layoutAndZoomController.js';
import { createGlyphAtlas } from '../rendering/glyphAtlas.js';
import { createPageRenderer } from '../rendering/pageRendering.js';
import {
  getCenterThickenFactor,
  getEdgeThinFactor,
  getInkEffectFactor,
  getInkSectionStrength,
  getInkSectionOrder,
  getExperimentalEffectsConfig,
  getExperimentalQualitySettings,
  isInkSectionEnabled,
} from '../config/inkSettingsPanel.js';
import { createDocumentEditingController } from '../document/documentEditing.js';
import { createDocumentViewAdapter } from '../document/documentViewAdapter.js';
import { createInputController } from '../document/inputHandlers.js';
import { createPageLifecycleController } from '../document/pageLifecycle.js';
import { setupUIBindings } from './uiBindings.js';
import { createThemeController } from '../config/themeController.js';

export function registerControllers({
  app,
  metrics,
  state,
  context,
  metricsStore,
  metricsOptions,
  recalcMetrics,
  setRenderScaleForZoom,
  getEffectiveRenderZoom,
  getTargetPitchPx,
  primeInitialMetrics,
  createMetricsScheduler,
  ephemeral,
}) {
  const { callbacks: contextCallbacks } = context;
  const { DPR, GRID_DIV, COLORS, STORAGE_KEY, A4_WIDTH_IN, PPI, LPI } = metrics;

  primeInitialMetrics();
  let scheduleMetricsUpdate = () => {};
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
  virtRAF,
  fontLoadSeq,
} = ephemeral;
const touchedPages = context.touchedPages;
let layoutZoomFactorRef = () => 1;
const viewAdapter = createDocumentViewAdapter({ app });

const saveHooks = {
  saveStateNow: () => {},
  saveStateDebounced: () => {},
};

function saveStateNow(...args) {
  return saveHooks.saveStateNow(...args);
}

function saveStateDebounced(...args) {
  return saveHooks.saveStateDebounced(...args);
}

context.controllers.layoutAndZoom = createNoopLayoutAndZoomApi();

function getLayoutAndZoomApi() {
  return context.controllers.layoutAndZoom || createNoopLayoutAndZoomApi();
}

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
  return getLayoutAndZoomApi().updateStageEnvironment(...args);
}

function renderMargins(...args) {
  return getLayoutAndZoomApi().renderMargins(...args);
}

function positionRulers(...args) {
  return getLayoutAndZoomApi().positionRulers(...args);
}

function setPaperOffset(...args) {
  return getLayoutAndZoomApi().setPaperOffset(...args);
}

function requestHammerNudge(...args) {
  return getLayoutAndZoomApi().requestHammerNudge(...args);
}

function handleWheelPan(...args) {
  return getLayoutAndZoomApi().handleWheelPan(...args);
}

function handleHorizontalMarginDrag(...args) {
  return getLayoutAndZoomApi().handleHorizontalMarginDrag(...args);
}

function handleVerticalMarginDrag(...args) {
  return getLayoutAndZoomApi().handleVerticalMarginDrag(...args);
}

function endMarginDrag(...args) {
  return getLayoutAndZoomApi().endMarginDrag(...args);
}

function setMarginBoxesVisible(...args) {
  return getLayoutAndZoomApi().setMarginBoxesVisible(...args);
}

function setZoomPercent(...args) {
  return getLayoutAndZoomApi().setZoomPercent(...args);
}

function updateZoomUIFromState(...args) {
  return getLayoutAndZoomApi().updateZoomUIFromState(...args);
}

function onZoomPointerDown(...args) {
  return getLayoutAndZoomApi().onZoomPointerDown(...args);
}

function onZoomPointerMove(...args) {
  return getLayoutAndZoomApi().onZoomPointerMove(...args);
}

function onZoomPointerUp(...args) {
  return getLayoutAndZoomApi().onZoomPointerUp(...args);
}

context.setCallback('updateStageEnvironment', updateStageEnvironment);
context.setCallback('renderMargins', renderMargins);
context.setCallback('positionRulers', positionRulers);
context.setCallback('setPaperOffset', setPaperOffset);
context.setCallback('requestHammerNudge', requestHammerNudge);
context.setCallback('handleWheelPan', handleWheelPan);
context.setCallback('handleHorizontalMarginDrag', handleHorizontalMarginDrag);
context.setCallback('handleVerticalMarginDrag', handleVerticalMarginDrag);
context.setCallback('endMarginDrag', endMarginDrag);
context.setCallback('setMarginBoxesVisible', setMarginBoxesVisible);
context.setCallback('setZoomPercent', setZoomPercent);
context.setCallback('updateZoomUIFromState', updateZoomUIFromState);
context.setCallback('onZoomPointerDown', onZoomPointerDown);
context.setCallback('onZoomPointerMove', onZoomPointerMove);
context.setCallback('onZoomPointerUp', onZoomPointerUp);

function setDragValue(value) {
  drag = value;
}

function getSaveTimerValue() {
  return saveTimer;
}

function setSaveTimerValue(value) {
  saveTimer = value;
}

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

const rendererHooks = {};

const editingController = createDocumentEditingController({
  app,
  state,
  getGridDiv: () => GRID_DIV,
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
  metricsOptions,
  rebuildAllAtlases: (...args) => contextCallbacks.rebuildAllAtlases(...args),
  setPaperOffset,
  applyDefaultMargins,
  computeColsFromCpi,
  rendererHooks,
  layoutZoomFactor: () => layoutZoomFactorRef(),
  requestHammerNudge,
  isZooming: () => zooming,
  resetPagesBlankPreserveSettings,
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
  saveStateDebounced,
  focusStage,
  applySubmittedChanges,
  applyLineHeight,
  clamp,
  counters: {
    getLastDigitTs: () => lastDigitTs,
    setLastDigitTs: (value) => { lastDigitTs = value; },
    getLastDigitCaret: () => lastDigitCaret,
    setLastDigitCaret: (value) => { lastDigitCaret = value; },
    getBsBurstCount: () => bsBurstCount,
    setBsBurstCount: (value) => { bsBurstCount = value; },
    getBsBurstTs: () => bsBurstTs,
    setBsBurstTs: (value) => { bsBurstTs = value; },
    getLastPasteTs: () => lastPasteTs,
    setLastPasteTs: (value) => { lastPasteTs = value; },
  },
});

const { resetTypedRun } = inputController;

context.controllers.input = inputController;

const lifecycleContext = {
  app,
  state,
  layoutZoomFactor: () => layoutZoomFactorRef(),
  getRenderScale: () => metricsStore.RENDER_SCALE,
  getEffectiveRenderZoom,
  getFontSize: () => metricsStore.FONT_SIZE,
  getActiveFontName: () => metricsStore.ACTIVE_FONT_NAME,
  exactFontString,
  getGridHeight: () => metricsStore.GRID_H,
  getCharWidth: () => metricsStore.CHAR_W,
  getFreezeVirtual: () => freezeVirtual,
  getVirtRAF: () => virtRAF,
  setVirtRAF: (value) => { virtRAF = value; },
  renderMargins,
  positionRulers,
  resetTypedRun,
};

context.controllers.lifecycle = createPageLifecycleController(lifecycleContext, editingController);

if (pendingVirtualization) {
  pendingVirtualization = false;
  context.controllers.lifecycle.requestVirtualization();
}

const { isSafari: IS_SAFARI, supersampleThreshold: SAFARI_SUPERSAMPLE_THRESHOLD } = detectSafariEnvironment();

const { rebuildAllAtlases, drawGlyph, applyGrainOverlayOnRegion, invalidateGrainCache } = createGlyphAtlas({
  context,
  app,
  state,
  colors: COLORS,
  getFontSize: () => metricsStore.FONT_SIZE,
  getActiveFontName: () => metricsStore.ACTIVE_FONT_NAME,
  getAsc: () => metricsStore.ASC,
  getDesc: () => metricsStore.DESC,
  getCharWidth: () => metricsStore.CHAR_W,
  getRenderScale: () => metricsStore.RENDER_SCALE,
  getStateZoom: () => state.zoom,
  isSafari: IS_SAFARI,
  safariSupersampleThreshold: SAFARI_SUPERSAMPLE_THRESHOLD,
  getCenterThickenFactor,
  getEdgeThinFactor,
  getInkEffectFactor,
  getInkSectionStrength,
  getInkSectionOrder,
  getExperimentalEffectsConfig,
  getExperimentalQualitySettings,
  isInkSectionEnabled,
  inkTextureConfig: () => INK_TEXTURE,
  edgeFuzzConfig: () => EDGE_FUZZ,
  edgeBleedConfig: () => EDGE_BLEED,
  grainConfig: () => GRAIN_CFG,
});

context.setCallback('rebuildAllAtlases', rebuildAllAtlases);

const stageLayoutApi = createStageLayoutController({
  context,
  app,
  state,
  isSafari: IS_SAFARI,
  renderMargins,
  updateStageEnvironment,
  updateCaretPosition,
});

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
} = stageLayoutApi;

const {
  refreshGlyphEffects,
  refreshGrainEffects,
  markRowAsDirty,
  schedulePaint,
} = createPageRenderer({
  context,
  app,
  state,
  getAsc: () => metricsStore.ASC,
  getDesc: () => metricsStore.DESC,
  getCharWidth: () => metricsStore.CHAR_W,
  getGridHeight: () => metricsStore.GRID_H,
  gridDiv: GRID_DIV,
  getRenderScale: () => metricsStore.RENDER_SCALE,
  rebuildAllAtlases,
  drawGlyph,
  applyGrainOverlayOnRegion,
  invalidateGrainCache,
  lifecycle: context.controllers.lifecycle,
  getCurrentBounds,
  getBatchDepth: () => batchDepth,
  getInkSectionOrder,
});

Object.assign(rendererHooks, { markRowAsDirty, schedulePaint });

const prefersDarkMedia = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

const themeController = createThemeController({
  app,
  state,
  colors: COLORS,
  edgeBleed: EDGE_BLEED,
  prefersDarkMedia,
  rebuildAllAtlases,
  touchPage,
  schedulePaint,
  refreshGlyphEffects,
  beginBatch,
  endBatch,
  setInk,
  focusStage,
  saveStateDebounced,
});

const { applyAppearance } = themeController;

context.controllers.lifecycle.registerRendererHooks({ schedulePaint });

context.controllers.layoutAndZoom = createLayoutAndZoomController(
  {
    app,
    state,
    DPR,
    getCharWidth: () => metricsStore.CHAR_W,
    getGridHeight: () => metricsStore.GRID_H,
    getAsc: () => metricsStore.ASC,
    getDesc: () => metricsStore.DESC,
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
    getEffectiveRenderZoom,
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
  context.controllers.lifecycle,
  editingController,
);

layoutZoomFactorRef = layoutZoomFactor;

const uiBindings = setupUIBindings(
  {
    app,
    state,
    storageKey: STORAGE_KEY,
    focusStage,
    pxX,
    pxY,
    mmX,
    mmY,
    sanitizeStageInput,
    sanitizedStageWidthFactor,
    sanitizedStageHeightFactor,
    updateStageEnvironment,
    renderMargins,
    clampCaretToBounds,
    updateCaretPosition,
    positionRulers,
    requestVirtualization,
    schedulePaint,
    setRenderScaleForZoom,
    setZoomPercent,
    applyDefaultMargins,
    computeColsFromCpi,
    gridDiv: GRID_DIV,
    applySubmittedChanges,
    applyLineHeight,
    readStagedLH,
    toggleRulers,
    toggleInkSettingsPanel,
    loadFontAndApply,
    requestHammerNudge,
    isZooming: () => zooming,
    setDrag: setDragValue,
    getSaveTimer: getSaveTimerValue,
    setSaveTimer: setSaveTimerValue,
  },
  {
    editing: {
      setInk,
      createNewDocument,
      serializeState,
      deserializeState,
    },
    layout: {
      handleWheelPan,
      handleHorizontalMarginDrag,
      handleVerticalMarginDrag,
      endMarginDrag,
      onZoomPointerDown,
      onZoomPointerMove,
      onZoomPointerUp,
      setMarginBoxesVisible,
      scheduleZoomCrispRedraw: () => getLayoutAndZoomApi().scheduleZoomCrispRedraw?.(),
    },
    input: inputController,
    theme: themeController,
  },
);

saveHooks.saveStateNow = uiBindings.saveStateNow;
saveHooks.saveStateDebounced = uiBindings.saveStateDebounced;

const { loadPersistedState, populateInitialUI } = uiBindings;

function computeColsFromCpi(cpi){
  const raw = A4_WIDTH_IN * cpi;
  const cols3 = Math.round(raw * 1000) / 1000;
  const cols2 = Math.round(cols3 * 100) / 100;
  return { cols3, cols2 };
}

function readStagedCpi(){
  return parseFloat(app.cpiSelect?.value) || 10;
}

function readStagedSize(){
  const fallback = Number.isFinite(state.inkWidthPct) ? clamp(Math.round(state.inkWidthPct), 1, 150) : 95;
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
      if (Math.abs(metricsStore.CHAR_W - target) < 0.01 || tries++ > 12){
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
    markDocumentDirty(state);
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
  markDocumentDirty(state);
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
const FONT_CANDIDATES = [
  () => metricsStore.ACTIVE_FONT_NAME, () => 'TT2020Base', () => 'TT2020StyleB',
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
  const tryFace = requestedFace || metricsStore.ACTIVE_FONT_NAME;
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

  metricsStore.ACTIVE_FONT_NAME = resolvedFace;
  metricsStore.FONT_FAMILY = `${resolvedFace}`;
  syncFontRadiosWithActiveFont();
  applyMetricsNow(true);
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

function applyMetricsNow(full=false){
  beginBatch();
  const oldBounds = (typeof getCurrentBounds === 'function') ? getCurrentBounds() : null;
  recalcMetrics(metricsStore.ACTIVE_FONT_NAME);
  const newBounds = (typeof getCurrentBounds === 'function') ? getCurrentBounds() : null;
  let deltaTopMu = 0;
  if (oldBounds && newBounds) {
    deltaTopMu = newBounds.Tmu - oldBounds.Tmu;
  }
  if (ephemeral.primedMetricsAreFallback) {
    deltaTopMu = 0;
    ephemeral.primedMetricsAreFallback = false;
  }
  if (deltaTopMu) shiftDocumentRows(deltaTopMu);
  contextCallbacks.rebuildAllAtlases();
  for (const p of state.pages){
    p.grainCanvas = null;
    p.grainForSize = { w:0, h:0, key: null };
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
  markDocumentDirty(state);
  saveStateDebounced();
  endBatch();
}

scheduleMetricsUpdate = createMetricsScheduler(applyMetricsNow);

function applyDefaultMargins() {
  const mmw = app.PAGE_W / 210, mmh = app.PAGE_H / 297, mW = 25 * mmw, mH = 25 * mmh;
  state.marginL = mW; state.marginR = app.PAGE_W - mW;
  state.marginTop = mH; state.marginBottom = mH;
}
function toggleRulers(){
  state.showRulers = !state.showRulers;
  document.body.classList.toggle('rulers-off', !state.showRulers);
  positionRulers();
  markDocumentDirty(state);
  saveStateDebounced();
}

return {
  saveStateNow,
  saveStateDebounced,
  refreshGlyphEffects,
  refreshGrainEffects,
  bootstrapFirstPage,
  loadPersistedState,
  populateInitialUI,
  applyAppearance,
  updateStageEnvironment,
  setZoomPercent,
  updateZoomUIFromState,
  setPaperOffset,
  loadFontAndApply,
  setLineHeightFactor,
  renderMargins,
  clampCaretToBounds,
  updateCaretPosition,
  positionRulers,
  setInk,
  requestVirtualization,
  scheduleMetricsUpdate,
  uiBindings,
  themeController,
  layoutAndZoomApi: () => context.controllers.layoutAndZoom,
};
}
