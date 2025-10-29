import { createDomRefs } from './utils/domElements.js';
import { computeBaseMetrics } from './config/metrics.js';
import { createMainState, createEphemeralState } from './state/state.js';
import { EDGE_BLEED, GRAIN_CFG, INK_TEXTURE } from './config/inkConfig.js';
import { clamp } from './utils/math.js';
import { sanitizeIntegerField } from './utils/forms.js';
import { detectSafariEnvironment, createStageLayoutController } from './layout/stageLayout.js';
import { createGlyphAtlas } from './rendering/glyphAtlas.js';
import { createPageRenderer } from './rendering/pageRendering.js';
import { getInkEffectFactor, isInkSectionEnabled, setupInkSettingsPanel } from './config/inkSettingsPanel.js';
import { createDocumentModel } from './document/model.js';
import { createPersistenceController } from './state/persistence.js';

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
let hammerNudgeRAF = 0;

let ensureRowExists;
let writeRunToRow;
let overtypeCharacter;
let eraseCharacters;
let makePageRecord;
let addPage;
let bootstrapFirstPage;
let resetPagesBlankPreserveSettings;
let flattenGridToStreamWithCaret;
let typeStreamIntoGrid;
let rewrapDocumentToCurrentBounds;
let getCurrentBounds = () => ({ L: 0, R: 0, Tmu: 0, Bmu: 0 });
let snapRowMuToStep;
let clampCaretToBounds;
let exportToTextFile;
let documentModelSetPersistenceHooks = () => {};

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
  updateStageEnvironment,
  setPaperOffset,
  caretViewportPos,
  anchorPx,
  maybeApplyNativeScroll,
  nudgePaperToAnchor,
  requestHammerNudge,
  computeSnappedVisualMargins,
  renderMargins,
  updateRulerTicks,
  positionRulers,
  setMarginBoxesVisible,
  snapXToGrid,
  snapYToGrid,
  handleHorizontalMarginDrag,
  handleVerticalMarginDrag,
  beginMarginDrag,
  endMarginDrag,
  mmX,
  mmY,
  pxX,
  pxY,
  setDocumentModelHooks,
  setPersistenceHooks,
} = createStageLayoutController({
  app,
  state,
  isSafari: IS_SAFARI,
  DPR,
  requestVirtualization,
  getZooming: () => zooming,
  getCharWidth: () => CHAR_W,
  getGridHeight: () => GRID_H,
  getAsc: () => ASC,
  getDesc: () => DESC,
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
  touchPage,
  getCurrentBounds,
  getBatchDepth: () => batchDepth,
});

({
  ensureRowExists,
  writeRunToRow,
  overtypeCharacter,
  eraseCharacters,
  makePageRecord,
  addPage,
  bootstrapFirstPage,
  resetPagesBlankPreserveSettings,
  flattenGridToStreamWithCaret,
  typeStreamIntoGrid,
  rewrapDocumentToCurrentBounds,
  getCurrentBounds: docGetCurrentBounds,
  snapRowMuToStep,
  clampCaretToBounds: docClampCaretToBounds,
  exportToTextFile,
  setPersistenceHooks: docSetPersistenceHooks,
} = createDocumentModel({
  app,
  state,
  getCharWidth: () => CHAR_W,
  getGridHeight: () => GRID_H,
  getAsc: () => ASC,
  getDesc: () => DESC,
  markRowAsDirty,
  prepareCanvas,
  configureCanvasContext,
  handlePageClick,
  requestVirtualization,
  renderMargins,
  positionRulers,
  updateCaretPosition,
  beginBatch,
  endBatch,
  attemptWordWrapAtOverflow,
}));

getCurrentBounds = docGetCurrentBounds;
clampCaretToBounds = docClampCaretToBounds;
documentModelSetPersistenceHooks = docSetPersistenceHooks;

setDocumentModelHooks({
  getCurrentBounds,
  clampCaret: clampCaretToBounds,
});

const getSaveTimer = () => saveTimer;
const setSaveTimerValue = (timer) => { saveTimer = timer; };
const getActiveFontName = () => ACTIVE_FONT_NAME;
const applyActiveFontName = (name) => {
  if (!name) return;
  ACTIVE_FONT_NAME = name;
  FONT_FAMILY = `${ACTIVE_FONT_NAME}`;
};

const {
  serializeState,
  deserializeState,
  saveStateNow,
  saveStateDebounced,
} = createPersistenceController({
  state,
  app,
  storageKey: STORAGE_KEY,
  gridDiv: GRID_DIV,
  getActiveFontName,
  setActiveFontName: applyActiveFontName,
  makePageRecord,
  prepareCanvas,
  handlePageClick,
  computeColsFromCpi,
  getSaveTimer,
  setSaveTimer: setSaveTimerValue,
});

documentModelSetPersistenceHooks({ saveStateDebounced });
setPersistenceHooks({ saveStateDebounced });

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
function touchPage(page){ touchedPages.add(page); }
function beginTypingFrameBatch(){
  if (batchDepth === 0) beginBatch();
  if (!typingBatchRAF){
    typingBatchRAF = requestAnimationFrame(()=>{ typingBatchRAF = 0; endBatch(); });
  }
}

function baseCaretHeightPx(){ return GRID_DIV * GRID_H; }
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
function prepareCanvas(canvas) {
  canvas.width  = Math.floor(app.PAGE_W * RENDER_SCALE);
  canvas.height = Math.floor(app.PAGE_H * RENDER_SCALE);
  const displayZoom = layoutZoomFactor();
  canvas.style.width  = (app.PAGE_W * displayZoom) + 'px';
  canvas.style.height = (app.PAGE_H * displayZoom) + 'px';
}
function configureCanvasContext(ctx) {
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  ctx.font = exactFontString(FONT_SIZE, ACTIVE_FONT_NAME);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.imageSmoothingEnabled = false;
  try { ctx.filter = 'none'; } catch {}
  ctx.globalCompositeOperation = 'source-over';
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

function insertStringFast(s){
  const text = (s || '').replace(/\r\n?/g, '\n');
  const b = getCurrentBounds();

  let pageIndex = state.caret.page;
  let page = state.pages[pageIndex] || addPage();
  let rowMu = state.caret.rowMu;
  let startCol = state.caret.col;
  const ink = state.ink;

  const prevFreeze = freezeVirtual;
  freezeVirtual = true;

  const newline = () => {
    startCol = b.L;
    rowMu += state.lineStepMu;
    if (rowMu > b.Bmu){
      pageIndex++;
      page = state.pages[pageIndex] || addPage();
      rowMu = b.Tmu;
    }
  };

  let buf = '';
  let lastSpacePos = -1;

  const flush = () => {
    if (buf.length){
      writeRunToRow(page, rowMu, startCol, buf, ink);
      startCol += buf.length;
      buf = '';
      lastSpacePos = -1;
    }
  };

  for (let i = 0; i < text.length; i++){
    const ch = text[i];

    if (ch === '\n'){
      flush();
      newline();
      continue;
    }

    buf += ch;
    if (/\s/.test(ch)) lastSpacePos = buf.length - 1;

    const colForCh = startCol + buf.length - 1;

    if (colForCh > b.R){
      if (state.wordWrap && lastSpacePos >= 0){
        const head = buf.slice(0, lastSpacePos);
        const tail = buf.slice(lastSpacePos + 1);
        if (head.length) writeRunToRow(page, rowMu, startCol, head, ink);
        newline();
        startCol = b.L;
        buf = tail;
        lastSpacePos = -1;
      } else {
        const head = buf.slice(0, buf.length - 1);
        if (head.length) writeRunToRow(page, rowMu, startCol, head, ink);
        newline();
        startCol = b.L;
        buf = ch;
        lastSpacePos = /\s/.test(ch) ? 0 : -1;
      }
    }
  }
  flush();

  state.caret = { page: pageIndex, rowMu, col: startCol };

  freezeVirtual = prevFreeze;
  updateCaretPosition();
  positionRulers();
  requestVirtualization();
  saveStateDebounced();
}

function attemptWordWrapAtOverflow(prevRowMu, pageIndex, b, mutateCaret = true){
  if (!state.wordWrap) return false;
  const page = state.pages[pageIndex] || addPage();
  const rowMap = page.grid.get(prevRowMu);
  if (!rowMap) return false;

  let minCol = Infinity, maxCol = -1;
  for (const c of rowMap.keys()){ if (c < minCol) minCol = c; if (c > maxCol) maxCol = c; }
  if (!isFinite(minCol) || maxCol < b.L) return false;

  let splitAt = -1;
  for (let c = Math.min(maxCol, b.R); c >= b.L; c--){
    const st = rowMap.get(c);
    if (!st || !st.length) continue;
    const ch = st[st.length - 1].char;
    if (/\s/.test(ch)) { splitAt = c; break; }
  }
  if (splitAt < b.L) return false;

  const start = splitAt + 1;
  if (start > maxCol) return false;

  let destPageIndex = pageIndex;
  let destRowMu = prevRowMu + state.lineStepMu;
  if (destRowMu > b.Bmu){
    destPageIndex++;
    const np = state.pages[destPageIndex] || addPage();
    app.activePageIndex = np.index;
    requestVirtualization();
    destRowMu = b.Tmu;
    positionRulers();
  }
  const destPage = state.pages[destPageIndex] || addPage();
  const destRowMap = ensureRowExists(destPage, destRowMu);

  let destCol = b.L;
  for (let c = start; c <= maxCol; c++){
    const stack = rowMap.get(c);
    if (!stack || !stack.length) continue;
    let dstack = destRowMap.get(destCol);
    if (!dstack){ dstack = []; destRowMap.set(destCol, dstack); }
    for (const s of stack){ dstack.push({ char: s.char, ink: s.ink || 'b' }); }
    rowMap.delete(c);
    destCol++;
  }

  markRowAsDirty(page, prevRowMu);
  markRowAsDirty(destPage, destRowMu);

  const nextPos = { pageIndex: destPageIndex, rowMu: destRowMu, col: destCol };
  if (mutateCaret){
    state.caret.page  = nextPos.pageIndex;
    state.caret.rowMu = nextPos.rowMu;
    state.caret.col   = nextPos.col;
  }
  return nextPos;
}

function updateCaretPosition(){
  const p = state.pages[state.caret.page];
  if (!p) return;
  const layoutScale = layoutZoomFactor();
  const caretLeft = (state.caret.col * CHAR_W) * layoutScale;
  const caretTop = (state.caret.rowMu * GRID_H - BASELINE_OFFSET_CELL) * layoutScale;
  const caretHeight = baseCaretHeightPx() * layoutScale;
  app.caretEl.style.left = caretLeft + 'px';
  app.caretEl.style.top  = caretTop + 'px';
  app.caretEl.style.height = caretHeight + 'px';
  const caretWidth = Math.max(1, Math.round(2 * layoutScale));
  app.caretEl.style.width = caretWidth + 'px';
  if (app.caretEl.parentNode !== p.pageEl){
    app.caretEl.remove();
    p.pageEl.appendChild(app.caretEl);
  }
  if (!zooming) requestHammerNudge();
  requestVirtualization();
}

function computeColsFromCpi(cpi){
  const raw = A4_WIDTH_IN * cpi;
  const cols3 = Math.round(raw * 1000) / 1000;
  const cols2 = Math.round(cols3 * 100) / 100;
  return { cols3, cols2 };
}
function updateColsPreviewUI(){
  const cpi = parseFloat(app.cpiSelect.value) || 10;
  const { cols2 } = computeColsFromCpi(cpi);
  app.colsPreviewSpan.textContent = `Columns: ${cols2.toFixed(2)}`;
}
function readStagedCpi(){ return parseFloat(app.cpiSelect?.value) || 10; }
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
    renderMargins(); clampCaretToBounds(); updateCaretPosition(); positionRulers(); requestVirtualization(); saveStateDebounced();
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
  app.lhInput.value = String(best);
  return best;
}
function applyLineHeight(){
  setLineHeightFactor(readStagedLH());
  focusStage();
}
function applyZoomCSS(){
  updateZoomWrapTransform();
  updateStageEnvironment();
  positionRulers();
  requestVirtualization();
}

function scheduleZoomCrispRedraw(){
  if (zoomDebounceTimer) clearTimeout(zoomDebounceTimer);
  zoomDebounceTimer = setTimeout(()=>{
    zoomDebounceTimer = null;
    zooming = false;
    freezeVirtual = false;
    setRenderScaleForZoom();
    if (IS_SAFARI) setSafariZoomMode('steady', { force: true });
    for (const p of state.pages){
      prepareCanvas(p.canvas);
      prepareCanvas(p.backCanvas);
      configureCanvasContext(p.ctx);
      configureCanvasContext(p.backCtx);
      p.dirtyAll = true;
    }
    rebuildAllAtlases();
    for (const p of state.pages){ if (p.active) schedulePaint(p); }
    requestHammerNudge();
  }, 160);
}

const Z_MIN = 50, Z_KNEE = 100, Z_MAX = 400, N_KNEE = 1/3, LOG2 = Math.log(2), LOG4 = Math.log(4);
function zFromNorm(n){
  n = Math.max(0, Math.min(1, n));
  if (n <= N_KNEE) return 50 * Math.pow(2, n / N_KNEE);
  return 100 * Math.pow(4, (n - N_KNEE) / (1 - N_KNEE));
}
function normFromZ(pct){
  let p = Math.max(Z_MIN, Math.min(Z_MAX, pct));
  if (p <= Z_KNEE) return (Math.log(p/50) / LOG2) * N_KNEE;
  return N_KNEE + (Math.log(p/100) / LOG4) * (1 - N_KNEE);
}
function detent(p){ return (Math.abs(p - 100) <= 6) ? 100 : p; }

function setZoomPercent(p){
  const z = detent(Math.round(Math.max(Z_MIN, Math.min(Z_MAX, p))));
  state.zoom = z / 100;
  if (IS_SAFARI && !zooming) setSafariZoomMode('steady', { force: true });
  applyZoomCSS();
  scheduleZoomCrispRedraw();
  updateZoomUIFromState();
  saveStateDebounced();
}

let zoomIndicatorTimer = null;
function showZoomIndicator(){
  app.zoomIndicator.textContent = Math.round(state.zoom * 100) + '%';
  app.zoomIndicator.classList.add('show');
  if (zoomIndicatorTimer) clearTimeout(zoomIndicatorTimer);
  zoomIndicatorTimer = setTimeout(()=> app.zoomIndicator.classList.remove('show'), 700);
}
function updateZoomUIFromState(){
  const trackRect = app.zoomTrack.getBoundingClientRect();
  const th = app.zoomThumb.getBoundingClientRect().height || 13;
  const H = trackRect.height;
  const n = normFromZ(state.zoom * 100);
  const fillH = n * H;
  app.zoomFill.style.height = `${fillH}px`;
  const y = (H - fillH) - th/2;
  app.zoomThumb.style.top = `${Math.max(-th/2, Math.min(H - th/2, y))}px`;
  showZoomIndicator();
}
function percentFromPointer(clientY){
  const r = app.zoomTrack.getBoundingClientRect();
  const y = clamp(clientY - r.top, 0, r.height);
  return zFromNorm(1 - (y / r.height));
}
let zoomDrag = null;
function onZoomPointerDown(e){
  e.preventDefault();
  zooming = true; freezeVirtual = true;
  if (IS_SAFARI) setSafariZoomMode('transient', { force: true });
  if (e.target === app.zoomThumb){
    zoomDrag = { from:'thumb', id:e.pointerId };
    app.zoomThumb.setPointerCapture && app.zoomThumb.setPointerCapture(e.pointerId);
  } else {
    zoomDrag = { from:'track', id:e.pointerId };
  }
  setZoomPercent(percentFromPointer(e.clientY));
}
function onZoomPointerMove(e){
  if (!zoomDrag) return;
  setZoomPercent(percentFromPointer(e.clientY));
}
function onZoomPointerUp(e){
  if (!zoomDrag) return;
  zoomDrag = null;
  scheduleZoomCrispRedraw();
}
function toggleFontsPanel() {
  const isOpen = app.fontsPanel.classList.toggle('is-open');
  if (isOpen) {
    for (const r of app.fontRadios()){ r.checked = (r.value === ACTIVE_FONT_NAME); }
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

function advanceCaret(){
  const b = getCurrentBounds();
  state.caret.col++;
  if (state.caret.col > b.R){
    const moved = attemptWordWrapAtOverflow(state.caret.rowMu, state.caret.page, b, true);
    if (!moved){
      state.caret.col = b.L;
      state.caret.rowMu += state.lineStepMu;
      if (state.caret.rowMu > b.Bmu){
        state.caret.page++;
        const np = state.pages[state.caret.page] || addPage();
        app.activePageIndex = np.index;
        requestVirtualization();
        state.caret.rowMu = b.Tmu;
        state.caret.col = b.L;
        positionRulers();
      }
    }
  }
  updateCaretPosition();
}

function handleNewline(){
  const b = getCurrentBounds();
  typedRun.active=false;
  state.caret.col = b.L;
  state.caret.rowMu += state.lineStepMu;
  if (state.caret.rowMu > b.Bmu){
    state.caret.page++;
    const np = state.pages[state.caret.page] || addPage();
    app.activePageIndex = np.index;
    requestVirtualization();
    state.caret.rowMu = b.Tmu; state.caret.col = b.L;
    positionRulers();
  }
  updateCaretPosition();
}
function handleBackspace(){
  const b = getCurrentBounds();
  typedRun.active=false;
  if (state.caret.col > b.L) { state.caret.col--; }
  else if (state.caret.rowMu > b.Tmu) { state.caret.rowMu -= state.lineStepMu; state.caret.col = b.R; }
  else if (state.caret.page > 0) { state.caret.page--; app.activePageIndex = state.caret.page; state.caret.rowMu = b.Bmu; state.caret.col = b.R; positionRulers(); }
  updateCaretPosition();
}

function insertString(s){
  beginBatch();
  const text = (s || '').replace(/\r\n?/g, '\n');
  for (const ch of text){
    if (ch === '\n'){ handleNewline(); }
    else {
      const page = state.pages[state.caret.page] || addPage();
      overtypeCharacter(page, state.caret.rowMu, state.caret.col, ch, state.ink);
      advanceCaret();
    }
  }
  saveStateDebounced();
  endBatch();
}

const TYPED_RUN_MAXLEN = 20, TYPED_RUN_TIMEOUT = 500, EXPAND_PASTE_WINDOW = 350, BS_WINDOW = 250, STRAY_V_WINDOW = 30;
function isEditableTarget(t){
  if (!t) return false;
  if (isToolbarInput(t)) return false;
  const tag = (t.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (t.isContentEditable) return true;
  const dlg = t.closest && (t.closest('dialog.settings-modal') || t.closest('aside.side-panel'));
  if (dlg && (dlg.open || dlg.classList.contains('is-open'))) return true;
  return false;
}
function resetTypedRun(){ typedRun.active=false; }
function noteTypedCharPreInsert(){
  const now = performance.now();
  const c = state.caret;
  const contiguous = typedRun.active && typedRun.page === c.page && typedRun.rowMu === c.rowMu && c.col === (typedRun.startCol + typedRun.length) && (now - typedRun.lastTs) <= TYPED_RUN_TIMEOUT && typedRun.length < TYPED_RUN_MAXLEN;
  if (contiguous){
    typedRun.length++;
    typedRun.lastTs = now;
  } else {
    typedRun = { active:true, page:c.page, rowMu:c.rowMu, startCol:c.col, length:1, lastTs:now };
  }
}
function consumeBackspaceBurstIfAny(){
  const now = performance.now();
  if (now - bsBurstTs < BS_WINDOW && bsBurstCount > 0){
    const page = state.pages[state.caret.page] || addPage();
    eraseCharacters(page, state.caret.rowMu, state.caret.col, bsBurstCount);
    bsBurstCount = 0;
    bsBurstTs = 0;
    resetTypedRun();
    return true;
  }
  return false;
}

const NUM_INPUT_KEYS = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Backspace','Delete','Tab']);
function isDigitKey(k){ return k.length === 1 && /[0-9]/.test(k); }

function handleKeyDown(e){
  if (isEditableTarget(e.target)) return;
  if (e.target && isToolbarInput(e.target)){
    const k = e.key;
    const allowDecimal = e.target.id === 'lhInput';
    if (k === 'Enter'){
      e.preventDefault();
      if (e.target.id === 'lhInput') applyLineHeight();
      else applySubmittedChanges();
      focusStage();
      return;
    }
    if (NUM_INPUT_KEYS.has(k) || isDigitKey(k) || (k === ',' && allowDecimal) || (k === '.' && allowDecimal)) return;
    try { e.target.blur(); } catch {}
    focusStage();
  }
  const k = e.key;
  const b = getCurrentBounds();
  if (e.metaKey || e.ctrlKey){
    if (k.toLowerCase() === 'v' && performance.now() - lastDigitTs < 180 && lastDigitCaret){
      state.caret = { ...lastDigitCaret };
      updateCaretPosition();
    }
    return;
  }
  if (k === 'Enter'){ e.preventDefault(); handleNewline(); saveStateDebounced(); return; }
  if (k === 'Backspace'){
    e.preventDefault();
    const now = performance.now();
    if (now - bsBurstTs < 200) bsBurstCount++; else bsBurstCount = 1;
    bsBurstTs = now;
    beginTypingFrameBatch();
    handleBackspace();
    saveStateDebounced();
    return;
  }
  if (k === 'ArrowLeft'){ e.preventDefault(); resetTypedRun(); state.caret.col = clamp(state.caret.col-1, b.L, b.R); updateCaretPosition(); return; }
  if (k === 'ArrowRight'){ e.preventDefault(); resetTypedRun(); state.caret.col = clamp(state.caret.col+1, b.L, b.R); updateCaretPosition(); return; }
  if (k === 'ArrowUp'){ e.preventDefault(); resetTypedRun(); state.caret.rowMu = clamp(state.caret.rowMu - state.lineStepMu, b.Tmu, b.Bmu); updateCaretPosition(); return; }
  if (k === 'ArrowDown'){ e.preventDefault(); resetTypedRun(); state.caret.rowMu = clamp(state.caret.rowMu + state.lineStepMu, b.Tmu, b.Bmu); updateCaretPosition(); return; }
  if (k === 'Tab'){ e.preventDefault(); resetTypedRun(); for (let i=0;i<5;i++) advanceCaret(); saveStateDebounced(); return; }
  if (k.length === 1){
    e.preventDefault();
    if (k === 'v' && (performance.now() - lastPasteTs) < STRAY_V_WINDOW) return;
    if (/[0-9]/.test(k)){
      lastDigitTs = performance.now();
      lastDigitCaret = { ...state.caret };
    } else {
      lastDigitTs = 0; lastDigitCaret = null;
    }
    beginTypingFrameBatch();
    consumeBackspaceBurstIfAny();
    noteTypedCharPreInsert();
    const page = state.pages[state.caret.page] || addPage();
    overtypeCharacter(page, state.caret.rowMu, state.caret.col, k, state.ink);
    advanceCaret();
    saveStateDebounced();
  }
}

function handlePaste(e){
  if (isEditableTarget(e.target)) return;
  const txt = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
  if (!txt) return;

  e.preventDefault();
  lastPasteTs = performance.now();

  beginBatch();

  if (!consumeBackspaceBurstIfAny()){
    const fresh = typedRun.active &&
                  typedRun.page === state.caret.page &&
                  typedRun.rowMu === state.caret.rowMu &&
                  (lastPasteTs - typedRun.lastTs) <= EXPAND_PASTE_WINDOW &&
                  typedRun.length > 0 &&
                  typedRun.length <= TYPED_RUN_MAXLEN;

    if (fresh){
      state.caret.col = typedRun.startCol;
      updateCaretPosition();
      const page = state.pages[state.caret.page] || addPage();
      eraseCharacters(page, state.caret.rowMu, state.caret.col, typedRun.length);
      resetTypedRun();
    }
  }

  insertStringFast(txt);

  resetTypedRun();
  endBatch();
}

function handleWheelPan(e){
  e.preventDefault();
  const dx = e.deltaX, dy = e.deltaY;
  if (dx || dy) setPaperOffset(state.paperOffset.x - dx / state.zoom, state.paperOffset.y - dy / state.zoom);
}
function handlePageClick(e, pageIndex){
  e.preventDefault();
  e.stopPropagation();
  const ae = document.activeElement;
  if (ae && ae !== document.body) { try { ae.blur(); } catch {} }
  const pageEl = (e.currentTarget.classList?.contains('page')) ? e.currentTarget : e.currentTarget.closest('.page');
  if (!pageEl) return;
  const r = pageEl.getBoundingClientRect();
  const b = getCurrentBounds();
  let rawRowMu = Math.round(((e.clientY - r.top) / state.zoom) / GRID_H);
  let rowMu = snapRowMuToStep(clamp(rawRowMu, b.Tmu, b.Bmu), b);
  let col = clamp(Math.floor(((e.clientX - r.left) / state.zoom) / CHAR_W), b.L, b.R);
  state.caret = { page: pageIndex, rowMu, col };
  app.activePageIndex = pageIndex;
  resetTypedRun();
  updateCaretPosition();
  positionRulers();
}

function effectiveVirtualPad(){ return state.zoom >= 3 ? 0 : 1; }
function setPageActive(page, active) {
  if (!page || page.active === active) return;
  page.active = active;
  if (active) {
    page.canvas.style.visibility = 'visible';
    page.dirtyAll = true;
    schedulePaint(page);
  } else {
    page.canvas.style.visibility = 'hidden';
  }
}

function visibleWindowIndices() {
  const sp = app.stage.getBoundingClientRect();
  const scrollCenterY = (sp.top + sp.bottom) / 2;
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < state.pages.length; i++) {
    const r = state.pages[i].wrapEl.getBoundingClientRect();
    const d = Math.abs(((r.top + r.bottom) / 2) - scrollCenterY);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  const PAD = effectiveVirtualPad();
  let i0 = Math.max(0, bestIdx - PAD);
  let i1 = Math.min(state.pages.length - 1, bestIdx + PAD);
  const cp = state.caret.page;
  i0 = Math.min(i0, cp);
  i1 = Math.max(i1, cp);
  return [i0, i1];
}

function updateVirtualization() {
  if (freezeVirtual) {
    for (let i=0;i<state.pages.length;i++) setPageActive(state.pages[i], true);
    return;
  }
  if (state.pages.length === 0) return;
  const [i0, i1] = visibleWindowIndices();
  for (let i = 0; i < state.pages.length; i++) {
    setPageActive(state.pages[i], i >= i0 && i <= i1);
  }
}
function requestVirtualization() {
  if (virtRAF) return;
  virtRAF = requestAnimationFrame(() => { virtRAF = 0; updateVirtualization(); });
}
function applyDefaultMargins() {
  const mmw = app.PAGE_W / 210, mmh = app.PAGE_H / 297, mW = 20 * mmw, mH = 20 * mmh;
  state.marginL = mW; state.marginR = app.PAGE_W - mW;
  state.marginTop = mH; state.marginBottom = mH;
}
function setInk(ink){
  state.ink = ink;
  app.inkBlackBtn.dataset.active = String(ink === 'b');
  app.inkRedBtn.dataset.active   = String(ink === 'r');
  app.inkWhiteBtn.dataset.active = String(ink === 'w');
  saveStateDebounced();
}
function toggleRulers(){
  state.showRulers = !state.showRulers;
  document.body.classList.toggle('rulers-off', !state.showRulers);
  positionRulers();
  saveStateDebounced();
}

function createNewDocument(){
  beginBatch();
  lastDigitTs = 0; lastDigitCaret = null;
  bsBurstCount = 0; bsBurstTs = 0;
  typedRun = { active:false, page:0, rowMu:0, startCol:0, length:0, lastTs:0 };
  state.paperOffset = { x:0, y:0 };
  setPaperOffset(0,0);
  state.pages = [];
  state.caret = { page:0, rowMu:0, col:0 };
  state.ink   = 'b';
  state.grainSeed = ((Math.random()*0xFFFFFFFF)>>>0);
  state.altSeed = ((Math.random()*0xFFFFFFFF)>>>0);
  app.stageInner.innerHTML = '';
  const wrap=document.createElement('div'); wrap.className='page-wrap'; wrap.dataset.page='0';
  const pageEl=document.createElement('div'); pageEl.className='page'; pageEl.style.height=app.PAGE_H+'px';
  const cv=document.createElement('canvas'); prepareCanvas(cv);
  const mb=document.createElement('div'); mb.className='margin-box';
  mb.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
  pageEl.appendChild(cv); pageEl.appendChild(mb); wrap.appendChild(pageEl); app.stageInner.appendChild(wrap);
  app.firstPageWrap=wrap; app.firstPage=pageEl; app.marginBox=mb;
  const page = makePageRecord(0, wrap, pageEl, cv, mb);
  page.canvas.style.visibility = 'hidden';
  state.pages.push(page);
  applyDefaultMargins();
  recalcMetrics(ACTIVE_FONT_NAME);
  rebuildAllAtlases();
  for (const p of state.pages){
    p.grainCanvas = null; p.grainForSize = { w:0, h:0 };
    configureCanvasContext(p.ctx); configureCanvasContext(p.backCtx);
    p.dirtyAll = true; schedulePaint(p);
  }
  renderMargins();
  clampCaretToBounds();
  updateCaretPosition();
  document.body.classList.toggle('rulers-off', !state.showRulers);
  positionRulers();
  requestVirtualization();
  saveStateNow();
  endBatch();
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
    beginMarginDrag('h', tri.classList.contains('left') ? 'left' : 'right', e.pointerId);
    (tri.setPointerCapture && tri.setPointerCapture(e.pointerId));
    document.addEventListener('pointermove', handleHorizontalMarginDrag);
    document.addEventListener('pointerup', endMarginDrag, true);
    document.addEventListener('pointercancel', endMarginDrag, true);
  }, {passive:false});
  app.rulerV_stops_container.addEventListener('pointerdown', e=>{
    const tri = e.target.closest('.tri-v'); if (!tri) return;
    e.preventDefault();
    beginMarginDrag('v', tri.classList.contains('top') ? 'top' : 'bottom', e.pointerId);
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
