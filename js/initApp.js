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
import { createDocumentEditingController } from './document/documentEditing.js';

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
let hammerNudgeRAF = 0;
let layoutZoomFactorRef = () => 1;

const rendererHooks = {};

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
  rebuildAllAtlases,
  setPaperOffset,
  applyDefaultMargins,
  computeColsFromCpi,
  rendererHooks,
  layoutZoomFactor: () => layoutZoomFactorRef(),
  requestHammerNudge,
  isZooming: () => zooming,
  handlePageClick,
});

const {
  touchPage,
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

layoutZoomFactorRef = layoutZoomFactor;

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

Object.assign(rendererHooks, { markRowAsDirty, schedulePaint });

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

function makePageRecord(idx, wrapEl, pageEl, canvas, marginBoxEl) {
  try { pageEl.style.cursor = 'text'; } catch {}
  prepareCanvas(canvas);
  const ctx = canvas.getContext('2d');
  configureCanvasContext(ctx);
  const backCanvas = document.createElement('canvas');
  prepareCanvas(backCanvas);
  const backCtx = backCanvas.getContext('2d');
  configureCanvasContext(backCtx);
  backCtx.save();
  backCtx.globalCompositeOperation = 'source-over';
  backCtx.globalAlpha = 1;
  backCtx.fillStyle = '#ffffff';
  backCtx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
  backCtx.restore();
  const page = {
    index: idx, wrapEl, pageEl, canvas, ctx, backCanvas, backCtx,
    grid: new Map(), raf: 0, dirtyAll: true, active: false,
    _dirtyRowMinMu: undefined, _dirtyRowMaxMu: undefined,
    marginBoxEl, grainCanvas: null, grainForSize: { w:0, h:0 }
  };
  pageEl.addEventListener('mousedown', (e) => handlePageClick(e, idx), { capture:false });
  canvas.addEventListener('mousedown', (e) => handlePageClick(e, idx), { capture:false });
  return page;
}

function addPage() {
  const idx = state.pages.length;
  const wrap = document.createElement('div'); wrap.className = 'page-wrap'; wrap.dataset.page = String(idx);
  const pageEl = document.createElement('div'); pageEl.className = 'page'; pageEl.style.height = app.PAGE_H + 'px';
  const canvas = document.createElement('canvas');
  const mb = document.createElement('div'); mb.className = 'margin-box';
  mb.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
  pageEl.appendChild(canvas); pageEl.appendChild(mb); wrap.appendChild(pageEl); app.stageInner.appendChild(wrap);
  const page = makePageRecord(idx, wrap, pageEl, canvas, mb);
  page.canvas.style.visibility = 'hidden';
  state.pages.push(page);
  renderMargins();
  requestVirtualization();
  return page;
}
function bootstrapFirstPage() {
  const pageEl = app.firstPage; pageEl.style.height = app.PAGE_H + 'px';
  const canvas = pageEl.querySelector('canvas');
  const page = makePageRecord(0, app.firstPageWrap, pageEl, canvas, app.marginBox);
  page.canvas.style.visibility = 'hidden';
  page.marginBoxEl.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
  state.pages.push(page);
}

const DEAD_X = 1.25, DEAD_Y = 3.0;
function caretViewportPos(){
  if (!app || !app.caretEl) return null;
  const rect = app.caretEl.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
}
function updateRulerHostDimensions(stageW, stageH){
  if (!app.rulerH_host || !app.rulerV_host) return;
  const scale = cssScaleFactor();
  const scaledW = stageW * scale;
  const scaledH = stageH * scale;
  app.rulerH_host.style.width = `${scaledW}px`;
  app.rulerV_host.style.height = `${scaledH}px`;
}

function documentHorizontalSpanPx(){
  if (!state.pages || !state.pages.length) return app.PAGE_W;
  const first = state.pages[0];
  if (!first || !first.wrapEl) return app.PAGE_W;
  const width = first.wrapEl.offsetWidth;
  return Number.isFinite(width) && width > 0 ? width : app.PAGE_W;
}

function documentVerticalSpanPx(){
  if (!state.pages || !state.pages.length) return app.PAGE_H;
  const first = state.pages[0];
  const last = state.pages[state.pages.length - 1];
  if (!first?.wrapEl || !last?.wrapEl) return app.PAGE_H;
  const top = first.wrapEl.offsetTop;
  const bottom = last.wrapEl.offsetTop + last.wrapEl.offsetHeight;
  const span = bottom - top;
  return Number.isFinite(span) && span > 0 ? span : app.PAGE_H;
}

function hammerAllowanceX(){
  const span = documentHorizontalSpanPx();
  return Number.isFinite(span) && span > 0 ? span / 2 : app.PAGE_W / 2;
}

function hammerAllowanceY(){
  const span = documentVerticalSpanPx();
  return Number.isFinite(span) && span > 0 ? span / 2 : app.PAGE_H / 2;
}

function clampPaperOffset(x, y){
  const { extraX, extraY } = stageDimensions();
  const hammerX = hammerAllowanceX();
  const hammerY = hammerAllowanceY();
  const minX = -(extraX + hammerX);
  const maxX = extraX + hammerX;
  const minY = -(extraY + hammerY);
  const maxY = extraY + hammerY;
  return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
}

function updateStageEnvironment(){
  const dims = stageDimensions();
  const rootStyle = document.documentElement.style;
  const layoutZoom = layoutZoomFactor();
  rootStyle.setProperty('--page-w', (app.PAGE_W * layoutZoom).toString());
  rootStyle.setProperty('--stage-width-mult', dims.widthFactor.toString());
  rootStyle.setProperty('--stage-height-mult', dims.heightFactor.toString());
  if (app.zoomWrap){
    app.zoomWrap.style.width = `${dims.width}px`;
    app.zoomWrap.style.minHeight = `${dims.height}px`;
    app.zoomWrap.style.height = '';
  }
  if (app.stageInner){
    app.stageInner.style.minWidth = `${dims.width}px`;
    app.stageInner.style.minHeight = `${dims.height}px`;
    app.stageInner.style.paddingLeft = `${dims.extraX}px`;
    app.stageInner.style.paddingRight = `${dims.extraX}px`;
    const padTop = dims.extraY;
    const padBottom = dims.extraY + toolbarHeightPx();
    app.stageInner.style.paddingTop = `${padTop}px`;
    app.stageInner.style.paddingBottom = `${padBottom}px`;
  }
  updateRulerHostDimensions(dims.width, dims.height);
  setPaperOffset(state.paperOffset.x, state.paperOffset.y);
}

function setPaperOffset(x,y){
  const clamped = clampPaperOffset(x, y);
  const scale = cssScaleFactor();
  const snap = (v)=> Math.round(v * DPR) / DPR;
  const snappedX = scale ? snap(clamped.x * scale) / scale : clamped.x;
  const snappedY = scale ? snap(clamped.y * scale) / scale : clamped.y;
  state.paperOffset.x = snappedX;
  state.paperOffset.y = snappedY;
  if (app.stageInner){
    const tx = Math.round(snappedX * 1000) / 1000;
    const ty = Math.round(snappedY * 1000) / 1000;
    app.stageInner.style.transform = `translate3d(${tx}px,${ty}px,0)`;
  }
  positionRulers();
  requestVirtualization();
}
function anchorPx(){
  return { ax: Math.round(window.innerWidth * state.caretAnchor.x), ay: Math.round(window.innerHeight * state.caretAnchor.y) };
}

function maybeApplyNativeScroll(dx, dy, threshold){
  if (!isSafariSteadyZoom()) return false;
  const stage = app.stage;
  if (!stage) return false;
  let used = false;
  const maxX = stage.scrollWidth - stage.clientWidth;
  const maxY = stage.scrollHeight - stage.clientHeight;
  if (Math.abs(dx) > threshold && maxX > 1){
    const target = clamp(stage.scrollLeft - dx, 0, Math.max(0, maxX));
    if (Math.abs(target - stage.scrollLeft) > threshold){
      stage.scrollLeft = target;
      used = true;
    }
  }
  if (Math.abs(dy) > threshold && maxY > 1){
    const target = clamp(stage.scrollTop - dy, 0, Math.max(0, maxY));
    if (Math.abs(target - stage.scrollTop) > threshold){
      stage.scrollTop = target;
      used = true;
    }
  }
  return used;
}

function nudgePaperToAnchor(){
  if (!state.hammerLock || zooming) return;
  const cv = caretViewportPos();
  if (!cv) return;
  const { ax, ay } = anchorPx();
  let dx = ax - cv.x, dy = ay - cv.y;
  const pxThreshold = 1 / DPR;
  if (Math.abs(dx) < pxThreshold && Math.abs(dy) < pxThreshold) return;
  const usedNative = maybeApplyNativeScroll(dx, dy, pxThreshold);
  if (usedNative){
    const updated = caretViewportPos();
    if (updated){
      dx = ax - updated.x;
      dy = ay - updated.y;
      if (Math.abs(dx) < pxThreshold && Math.abs(dy) < pxThreshold) return;
    }
  }
  if (Math.abs(dx) < DEAD_X && Math.abs(dy) < DEAD_Y) return;
  const scale = cssScaleFactor() || 1;
  const prevX = state.paperOffset.x;
  const prevY = state.paperOffset.y;
  setPaperOffset(prevX + dx / scale, prevY + dy / scale);
  const movedX = Math.abs(state.paperOffset.x - prevX) > 1e-6;
  const movedY = Math.abs(state.paperOffset.y - prevY) > 1e-6;
  if (!movedX && !movedY) return;
  const after = caretViewportPos();
  if (!after) return;
  const errX = ax - after.x;
  const errY = ay - after.y;
  if (Math.abs(errX) >= pxThreshold || Math.abs(errY) >= pxThreshold){
    requestHammerNudge();
  }
}
function requestHammerNudge(){
  if (zooming || !state.hammerLock) return;
  if (hammerNudgeRAF) return;
  const schedule = () => {
    hammerNudgeRAF = requestAnimationFrame(() => {
      hammerNudgeRAF = 0;
      nudgePaperToAnchor();
    });
  };
  if (IS_SAFARI){
    hammerNudgeRAF = requestAnimationFrame(() => {
      hammerNudgeRAF = 0;
      schedule();
    });
  } else {
    schedule();
  }
}


function computeSnappedVisualMargins(){
  const Lcol = Math.ceil(state.marginL / CHAR_W);
  const Rcol = Math.floor((state.marginR - 1) / CHAR_W);
  const leftPx  = Lcol * CHAR_W;
  const rightPx = (Rcol + 1) * CHAR_W;
  const topPx    = state.marginTop;
  const bottomPx = state.marginBottom;
  const Tmu = Math.ceil((state.marginTop + ASC) / GRID_H);
  const Bmu = Math.floor((app.PAGE_H - state.marginBottom - DESC) / GRID_H);
  return { leftPx, rightPx, topPx, bottomPx, Lcol, Rcol, Tmu, Bmu };
}

function renderMargins(){
  const snap = computeSnappedVisualMargins();
  const layoutScale = layoutZoomFactor();
  for (const p of state.pages){
    if (p?.pageEl) p.pageEl.style.height = (app.PAGE_H * layoutScale) + 'px';
    const leftPx = Math.round(snap.leftPx * layoutScale);
    const rightPx = Math.round((app.PAGE_W - snap.rightPx) * layoutScale);
    const topPx = Math.round(snap.topPx * layoutScale);
    const bottomPx = Math.round(snap.bottomPx * layoutScale);
    p.marginBoxEl.style.left   = leftPx + 'px';
    p.marginBoxEl.style.right  = rightPx + 'px';
    p.marginBoxEl.style.top    = topPx + 'px';
    p.marginBoxEl.style.bottom = bottomPx + 'px';
    p.marginBoxEl.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
  }
}

function getActivePageRect(){
  const p = state.pages[app.activePageIndex ?? state.caret.page] || state.pages[0];
  const r = p.wrapEl.getBoundingClientRect();
  return new DOMRect(r.left, r.top, r.width, app.PAGE_H * state.zoom);
}

function updateRulerTicks(activePageRect){
  const ticksH = app.rulerH_host.querySelector('.ruler-ticks');
  const ticksV = app.rulerV_host.querySelector('.ruler-v-ticks');
  ticksH.innerHTML = ''; ticksV.innerHTML = '';
  const ppiH = (activePageRect.width / 210) * 25.4;
  const originX = activePageRect.left;
  const hostWidth = app.rulerH_host.getBoundingClientRect().width || window.innerWidth;
  const startInchH = Math.floor(-originX / ppiH), endInchH = Math.ceil((hostWidth - originX) / ppiH);
  for (let i=startInchH;i<=endInchH;i++){
    for (let j=0;j<10;j++){
      const x = originX + (i + j/10) * ppiH;
      if (x < 0 || x > hostWidth) continue;
      const tick = document.createElement('div');
      tick.className = j===0 ? 'tick major' : j===5 ? 'tick medium' : 'tick minor';
      tick.style.left = x + 'px';
      ticksH.appendChild(tick);
      if (j===0){
        const lbl = document.createElement('div'); lbl.className='tick-num';
        lbl.textContent = i; lbl.style.left = (x + 4) + 'px';
        ticksH.appendChild(lbl);
      }
    }
  }
  const ppiV = (activePageRect.height / 297) * 25.4;
  const originY = activePageRect.top;
  const hostHeight = app.rulerV_host.getBoundingClientRect().height || window.innerHeight;
  const startInchV = Math.floor(-originY / ppiV), endInchV = Math.ceil((hostHeight - originY) / ppiV);
  for (let i=startInchV;i<=endInchV;i++){
    for (let j=0;j<10;j++){
      const y = originY + (i + j/10) * ppiV;
      if (y < 0 || y > hostHeight) continue;
      const tick = document.createElement('div');
      tick.className = j===0 ? 'tick-v major' : j===5 ? 'tick-v medium' : 'tick-v minor';
      tick.style.top = y + 'px';
      ticksV.appendChild(tick);
      if (j===0){
        const lbl = document.createElement('div'); lbl.className='tick-v-num';
        lbl.textContent = i; lbl.style.top = (y + 4) + 'px';
        ticksV.appendChild(lbl);
      }
    }
  }
}

function positionRulers(){
  if (!state.showRulers) return;
  app.rulerH_stops_container.innerHTML = '';
  app.rulerV_stops_container.innerHTML = '';
  const pageRect = getActivePageRect();
  const snap = computeSnappedVisualMargins();
  const mLeft = document.createElement('div');
  mLeft.className = 'tri left';
  mLeft.style.left = (pageRect.left + snap.leftPx * state.zoom) + 'px';
  app.rulerH_stops_container.appendChild(mLeft);
  const mRight = document.createElement('div');
  mRight.className = 'tri right';
  mRight.style.left = (pageRect.left + snap.rightPx * state.zoom) + 'px';
  app.rulerH_stops_container.appendChild(mRight);
  const mTop = document.createElement('div');
  mTop.className = 'tri-v top';
  mTop.style.top = (pageRect.top + snap.topPx * state.zoom) + 'px';
  app.rulerV_stops_container.appendChild(mTop);
  const mBottom = document.createElement('div');
  mBottom.className = 'tri-v bottom';
  mBottom.style.top = (pageRect.top + (app.PAGE_H - snap.bottomPx) * state.zoom) + 'px';
  app.rulerV_stops_container.appendChild(mBottom);
  updateRulerTicks(pageRect);
}

function setMarginBoxesVisible(show){
  for (const p of state.pages){
    if (p?.marginBoxEl) p.marginBoxEl.style.visibility = (show && state.showMarginBox) ? 'visible' : 'hidden';
  }
}
function snapXToGrid(x){ return Math.round(x / CHAR_W) * CHAR_W; }
function snapYToGrid(y){ return Math.round(y / GRID_H) * GRID_H; }

function handleHorizontalMarginDrag(ev){
  if (!drag || drag.kind !== 'h') return;
  const pr = getActivePageRect();
  let x = snapXToGrid(clamp((ev.clientX - pr.left) / state.zoom, 0, app.PAGE_W));
  if (drag.side === 'left'){
    state.marginL = Math.min(x, Math.max(0, state.marginR - CHAR_W));
  } else {
    state.marginR = Math.max(x, Math.min(app.PAGE_W, state.marginL + CHAR_W));
  }
  app.guideV.style.left = (pr.left + x * state.zoom) + 'px';
  app.guideV.style.display = 'block';
}

function handleVerticalMarginDrag(ev){
  if (!drag || drag.kind !== 'v') return;
  const pr = getActivePageRect();
  let y = snapYToGrid(clamp((ev.clientY - pr.top) / state.zoom, 0, app.PAGE_H));
  if (drag.side === 'top'){
    const maxTop = (app.PAGE_H - state.marginBottom) - (state.lineStepMu * GRID_H);
    state.marginTop = Math.min(y, snapYToGrid(maxTop));
    app.guideH.style.top = (pr.top + state.marginTop * state.zoom) + 'px';
  } else {
    const bottomEdge = Math.max(state.marginTop + (state.lineStepMu * GRID_H), y);
    const snappedBottomEdge = snapYToGrid(Math.min(bottomEdge, app.PAGE_H));
    state.marginBottom = app.PAGE_H - snappedBottomEdge;
    app.guideH.style.top = (pr.top + snappedBottomEdge * state.zoom) + 'px';
  }
  app.guideH.style.display = 'block';
}

function endMarginDrag(){
  if (!drag) return;
  document.removeEventListener('pointermove', handleHorizontalMarginDrag);
  document.removeEventListener('pointermove', handleVerticalMarginDrag);
  document.removeEventListener('pointerup', endMarginDrag, true);
  document.removeEventListener('pointercancel', endMarginDrag, true);
  renderMargins();
  positionRulers();
  clampCaretToBounds();
  saveStateDebounced();
  app.guideV.style.display = 'none';
  app.guideH.style.display = 'none';
  setMarginBoxesVisible(true);
  drag = null;
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
  const dims = stageDimensions();
  updateRulerHostDimensions(dims.width, dims.height);
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
function mmX(px){ return (px * 210) / app.PAGE_W; }
function mmY(px){ return (px * 297) / app.PAGE_H; }
function pxX(mm){ return (mm * app.PAGE_W) / 210; }
function pxY(mm){ return (mm * app.PAGE_H) / 297; }

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
  if (k === 'Enter'){ e.preventDefault(); resetTypedRun(); handleNewline(); saveStateDebounced(); return; }
  if (k === 'Backspace'){
    e.preventDefault();
    const now = performance.now();
    if (now - bsBurstTs < 200) bsBurstCount++; else bsBurstCount = 1;
    bsBurstTs = now;
    beginTypingFrameBatch();
    handleBackspace();
    resetTypedRun();
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

  insertTextFast(txt);

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

function saveStateNow(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState())); }catch{} }
function saveStateDebounced(){ if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(saveStateNow, 400); }
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
