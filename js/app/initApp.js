import { createDomRefs } from './domElements.js';
import { computeBaseMetrics } from './metrics.js';
import { createMainState, createEphemeralState } from './state.js';
import { GRAIN_CFG } from './grainConfig.js';

export function initApp(){

// MARKER-START: DOM_ELEMENT_REFERENCES
const app = createDomRefs();
// EOM

// MARKER-START: CONSTANTS_AND_METRICS
const metrics = computeBaseMetrics(app);
const { DPR, GRID_DIV, COLORS, STORAGE_KEY, A4_WIDTH_IN, PPI, LPI, LINE_H_RAW } = metrics;
let { GRID_H, ACTIVE_FONT_NAME, RENDER_SCALE, FONT_FAMILY, FONT_SIZE, ASC, DESC, CHAR_W, BASELINE_OFFSET_CELL } = metrics;
// EOM

// MARKER-START: APPLICATION_STATE_MAIN
const state = createMainState(app, GRID_DIV);
// EOM

// MARKER-START: APPLICATION_STATE_EPHEMERAL
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
// EOM

const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));

let stageRect = null;

function pageWrapGapPx(){
  const ref = state.pages[0]?.wrapEl || app.firstPageWrap;
  if (!ref) return 0;
  const styles = window.getComputedStyle(ref);
  const mb = parseFloat(styles.marginBottom || '0');
  return Number.isFinite(mb) ? mb : 0;
}

function recomputeStageRect(){
  const pageCount = state.pages.length;
  const stageWidth = app.PAGE_W * 2;
  const topGutter = app.PAGE_H * 1.2;
  const gap = pageCount > 0 ? pageWrapGapPx() : 0;
  const contentHeight = pageCount > 0 ? (pageCount * app.PAGE_H) + (pageCount * gap) : 0;
  const bottomGutter = Math.ceil(window.innerHeight / state.zoom);
  const stageHeight = topGutter + contentHeight + bottomGutter;
  const viewportW = window.innerWidth / state.zoom;
  const viewportH = window.innerHeight / state.zoom;
  const minX = Math.min(0, viewportW - stageWidth);
  const maxX = 0;
  const minY = Math.min(0, viewportH - stageHeight);
  const maxY = 0;
  stageRect = { width: stageWidth, height: stageHeight, topGutter, bottomGutter, minX, maxX, minY, maxY };
  if (app.stageInner){
    app.stageInner.style.width = `${stageWidth}px`;
    app.stageInner.style.paddingTop = `${topGutter}px`;
    app.stageInner.style.paddingBottom = `${bottomGutter}px`;
    app.stageInner.style.minHeight = `${stageHeight}px`;
  }
  const clampedX = clamp(state.paperOffset.x, minX, maxX);
  const clampedY = clamp(state.paperOffset.y, minY, maxY);
  if (clampedX !== state.paperOffset.x || clampedY !== state.paperOffset.y){
    setPaperOffset(clampedX, clampedY);
  }
}

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

function sanitizeIntegerField(el, options = {}){
  if (!el) return null;
  const {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    allowEmpty = true,
    fallbackValue = null,
  } = options;
  const raw = el.value ?? '';
  const digits = raw.replace(/\D+/g, '');
  if (!digits){
    if (!allowEmpty){
      let fallback = Number.isFinite(fallbackValue) ? fallbackValue : (Number.isFinite(min) ? min : 0);
      if (Number.isFinite(min)) fallback = Math.max(min, fallback);
      if (Number.isFinite(max)) fallback = Math.min(max, fallback);
      el.value = String(fallback);
      return fallback;
    }
    el.value = '';
    return null;
  }
  let n = parseInt(digits, 10);
  if (Number.isFinite(min)) n = Math.max(min, n);
  if (Number.isFinite(max)) n = Math.min(max, n);
  el.value = String(n);
  return n;
}

// MARKER-START: isToolbarInput
function isToolbarInput(el){
  if (!el) return false;
  const id = el.id || '';
  return (
    id === 'sizeInput' || id === 'lhInput' || id === 'cpiSelect' ||
    id === 'showMarginBoxCb' || id === 'wordWrapCb' ||
    id === 'mmLeft' || id === 'mmRight' || id === 'mmTop' || id === 'mmBottom' ||
    id === 'grainPct' || id.includes('Slider')
  );
}
// EOM

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

// MARKER-START: resolveAvailableFace
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
// EOM

// MARKER-START: calibrateMonospaceFont
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
// EOM

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
  canvas.style.width  = app.PAGE_W + 'px';
  canvas.style.height = app.PAGE_H + 'px';
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

// MARKER-START: loadFontAndApply
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
// EOM

window.atlasStats = { builds: 0, draws: 0, perInk: { b: 0, r: 0, w: 0 } };
const _atlases = new Map();
const ASCII_START = 32, ASCII_END = 126, ATLAS_COLS = 32;

function rebuildAllAtlases(){
  _atlases.clear();
  window.atlasStats = { builds:0, draws:0, perInk:{ b:0, r:0, w:0 } };
}

// MARKER-START: ensureAtlas
function ensureAtlas(ink, variantIdx = 0){
  const key = `${ink}|v${variantIdx|0}`;
  let atlas = _atlases.get(key);
  if (atlas) return atlas;

  const ascS = ASC, descS = DESC;
  const X_PAD = 0;
  const GLYPH_BLEED  = Math.ceil((ascS + descS) * 0.5);
  const ORIGIN_Y_CSS = ascS + GLYPH_BLEED;
  const CELL_W_CSS = CHAR_W;
  const CELL_H_CSS = Math.ceil(ascS + descS + 2 * GLYPH_BLEED);
  const GUTTER_DP = 1, GUTTER_CSS = GUTTER_DP / RENDER_SCALE;
  const cellW_draw_dp = Math.round(CELL_W_CSS * RENDER_SCALE);
  const cellH_draw_dp = Math.ceil(CELL_H_CSS * RENDER_SCALE);
  const cellW_pack_dp = cellW_draw_dp + 2 * GUTTER_DP;
  const cellH_pack_dp = cellH_draw_dp + 2 * GUTTER_DP;
  const ATLAS_ROWS = Math.ceil((ASCII_END - ASCII_START + 1) / ATLAS_COLS);
  const width_dp  = Math.max(1, ATLAS_COLS * cellW_pack_dp);
  const height_dp = Math.max(1, ATLAS_ROWS * cellH_pack_dp);

  const canvas = document.createElement('canvas');
  canvas.width = width_dp; canvas.height = height_dp;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width_dp / RENDER_SCALE, height_dp / RENDER_SCALE);
  ctx.fillStyle = COLORS[ink] || '#000';
  ctx.font = exactFontString(FONT_SIZE, ACTIVE_FONT_NAME);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.globalCompositeOperation = 'source-over';

  const rectDpByCode = [];
  const advCache = new Float32Array(ASCII_END + 1);
  const SHIFT_EPS = 0.5;

  let code = ASCII_START;
  for (let row = 0; row < ATLAS_ROWS; row++){
    for (let col = 0; col < ATLAS_COLS; col++){
      if (code > ASCII_END) break;
      const packX_css = (col * cellW_pack_dp) / RENDER_SCALE;
      const packY_css = (row * cellH_pack_dp) / RENDER_SCALE;
      const ch = String.fromCharCode(code);
      const n  = (variantIdx|0) + 1;
      const adv = advCache[code] || (advCache[code] = Math.max(0.01, ctx.measureText(ch).width));
      ctx.save();
      ctx.beginPath();
      ctx.rect(packX_css + GUTTER_CSS, packY_css + GUTTER_CSS, CELL_W_CSS, CELL_H_CSS);
      ctx.clip();
      const x0 = packX_css + GUTTER_CSS + X_PAD - (n - 1) * adv - SHIFT_EPS;
      const y0 = packY_css + GUTTER_CSS + ORIGIN_Y_CSS;
      ctx.fillText(variantIdx ? ch.repeat(n) : ch, x0, y0);
      ctx.restore();
      rectDpByCode[code] = {
        sx_dp: col * cellW_pack_dp + GUTTER_DP, sy_dp: row * cellH_pack_dp + GUTTER_DP,
        sw_dp: cellW_draw_dp, sh_dp: cellH_draw_dp
      };
      code++;
    }
  }
  atlas = { canvas, cellW_css: CELL_W_CSS, cellH_css: CELL_H_CSS, cellW_draw_dp, cellH_draw_dp, originY_css: ORIGIN_Y_CSS, rectDpByCode };
  _atlases.set(key, atlas);
  window.atlasStats.builds++;
  return atlas;
}
// EOM

// MARKER-START: drawGlyph
function drawGlyph(ctx, ch, ink, x_css, baselineY_css, layerIndex, totalLayers, pageIndex, rowMu, col){
  const code = ch.charCodeAt(0);
  const variant = variantIndexForCell(pageIndex|0, rowMu|0, col|0);
  const atlas = ensureAtlas(ink, variant);
  const fallback = atlas.rectDpByCode['?'.charCodeAt(0)];
  const rect = atlas.rectDpByCode[code] || fallback;
  if (!rect) return;

  const dx_css = Math.round(x_css * RENDER_SCALE) / RENDER_SCALE;
  const dy_css = Math.round((baselineY_css - atlas.originY_css) * RENDER_SCALE) / RENDER_SCALE;
  const baseOpacity = clamp(((state.inkOpacity && typeof state.inkOpacity[ink] === 'number') ? state.inkOpacity[ink] : 100) / 100, 0, 1);
  const layerFalloff = Math.max(0.1, Math.min(1, 0.92 * Math.pow(0.92, totalLayers - 1 - layerIndex)));
  const finalAlpha = (ink === 'w') ? baseOpacity : baseOpacity * layerFalloff;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = finalAlpha;
  ctx.drawImage(atlas.canvas, rect.sx_dp, rect.sy_dp, rect.sw_dp, rect.sh_dp, dx_css, dy_css, atlas.cellW_css, atlas.cellH_css);
  window.atlasStats.draws++;
  window.atlasStats.perInk[ink] = (window.atlasStats.perInk[ink] || 0) + 1;
}
// EOM

function hash2(ix, iy, seed){
  let h = seed | 0;
  h ^= Math.imul(ix | 0, 0x9E3779B1);
  h ^= Math.imul((iy | 0) ^ 0x85EBCA77, 0xC2B2AE3D);
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 4294967296);
}
function smoothstep(t){ return t*t*(3-2*t); }
function valueNoise2D(x, y, scale, seed){
  const gx = x / scale, gy = y / scale;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = x0 + 1, y1 = y0 + 1;
  const sx = smoothstep(gx - x0), sy = smoothstep(gy - y0);
  const n00 = hash2(x0, y0, seed), n10 = hash2(x1, y0, seed), n01 = hash2(x0, y1, seed), n11 = hash2(x1, y1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - n00) * sy;
}

// MARKER-START: ensureGrain
function ensureGrain(page){
  const W = app.PAGE_W|0, H = app.PAGE_H|0;
  if (page.grainCanvas && page.grainForSize.w === W && page.grainForSize.h === H) return;
  const seed = (state.grainSeed ^ ((page.index + 1) * 0x9E3779B1)) >>> 0;
  const cnv = document.createElement('canvas');
  cnv.width = W; cnv.height = H;
  const ctx = cnv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const sBase = Math.max(1, CHAR_W * (GRAIN_CFG.base_scale_from_char_w || 0.05));
  const rels = GRAIN_CFG.octave_rel_scales || [0.8, 1.2, 0.5];
  const wgts = GRAIN_CFG.octave_weights || [0.42, 0.33, 0.15];
  const octSeeds = (GRAIN_CFG.seeds && GRAIN_CFG.seeds.octave) || [0xA5A5A5A5, 0x5EEDFACE, 0x13579BDF];
  const sArr = rels.map(r => Math.max(1, sBase * r));
  const wArr = wgts.slice(0, sArr.length);
  const wHash = GRAIN_CFG.pixel_hash_weight ?? 0.10;
  const postGamma = GRAIN_CFG.post_gamma || 1.0;
  const hashSeed = (GRAIN_CFG.seeds && GRAIN_CFG.seeds.hash) || 0x5F356495;
  let p = 0;
  for (let y = 0; y < H; y++){
    for (let x = 0; x < W; x++){
      let v = 0;
      for (let i = 0; i < sArr.length; i++){
        v += (wArr[i] || 0) * valueNoise2D(x, y, sArr[i], seed ^ (octSeeds[i] || 0));
      }
      v += wHash * hash2(x, y, seed ^ hashSeed);
      v = Math.min(1, Math.max(0, v));
      if (postGamma !== 1) v = Math.pow(v, postGamma);
      data[p+3] = (v * 255) | 0;
      p += 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  page.grainCanvas = cnv;
  page.grainForSize = { w: W, h: H };
}
// EOM

function grainAlpha(){
  const s = clamp((state.grainPct || 0) / 100, 0, 1);
  if (s <= 0) return 0;
  const mixPow = clamp(GRAIN_CFG.alpha?.mix_pow ?? 0.45, 0, 1);
  const lowPow = Math.max(0.01, GRAIN_CFG.alpha?.low_pow ?? 0.55);
  const eased = mixPow * Math.pow(s, lowPow) + (1 - mixPow) * s;
  const aMin = clamp(GRAIN_CFG.alpha?.min ?? 0, 0, 1);
  const aMax = clamp(GRAIN_CFG.alpha?.max ?? 0.4, 0, 1);
  return clamp(aMin + eased * (aMax - aMin), 0, 1);
}

// MARKER-START: applyGrainOverlayOnRegion
function applyGrainOverlayOnRegion(page, y_css, h_css){
  const a = grainAlpha();
  if (a <= 0 || h_css <= 0) return;
  ensureGrain(page);
  const { ctx } = page;
  const sy = Math.max(0, Math.floor(y_css));
  const sh = Math.max(0, Math.min(app.PAGE_H - sy, Math.ceil(h_css)));
  if (sh <= 0) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = a;
  ctx.drawImage(page.grainCanvas, 0, sy, app.PAGE_W, sh, 0, sy, app.PAGE_W, sh);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, sy, app.PAGE_W, sh);
  ctx.restore();
}
// EOM

function markRowAsDirty(page, rowMu) {
  if (page._dirtyRowMinMu === undefined) {
    page._dirtyRowMinMu = rowMu;
    page._dirtyRowMaxMu = rowMu;
  } else {
    if (rowMu < page._dirtyRowMinMu) page._dirtyRowMinMu = rowMu;
    if (rowMu > page._dirtyRowMaxMu) page._dirtyRowMaxMu = rowMu;
  }
  touchPage(page);
  if (!page.active) return;
  if (batchDepth === 0) schedulePaint(page);
}
function schedulePaint(page) {
  if (!page.active) return;
  if (page.raf) return;
  page.raf = requestAnimationFrame(() => { page.raf = 0; paintPage(page); });
}

// MARKER-START: paintWholePageToBackBuffer
function paintWholePageToBackBuffer(page) {
  const { backCtx } = page;
  backCtx.save();
  backCtx.globalCompositeOperation = 'source-over';
  backCtx.globalAlpha = 1;
  backCtx.fillStyle = '#ffffff';
  backCtx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
  backCtx.restore();
  for (const [rowMu, rowMap] of page.grid) {
    if (!rowMap) continue;
    const baseline = rowMu * GRID_H;
    for (const [col, stack] of rowMap) {
      const x = col * CHAR_W;
      for (let k = 0; k < stack.length; k++) {
        const s = stack[k];
        drawGlyph(backCtx, s.char, s.ink || 'b', x, baseline, k, stack.length, page.index, rowMu, col);
      }
    }
  }
  page.ctx.drawImage(page.backCanvas, 0, 0, page.backCanvas.width, page.backCanvas.height, 0, 0, app.PAGE_W, app.PAGE_H);
  if (state.grainPct > 0) {
    applyGrainOverlayOnRegion(page, 0, app.PAGE_H);
  }
}
// EOM

// MARKER-START: paintDirtyRowsBand
function paintDirtyRowsBand(page, dirtyRowMinMu, dirtyRowMaxMu) {
  const { backCtx, ctx } = page;
  const BLEED_TOP_CSS    = Math.ceil(ASC + 2);
  const BLEED_BOTTOM_CSS = Math.ceil(DESC + 2);

  const bandTop_css = Math.max(0, dirtyRowMinMu * GRID_H - BLEED_TOP_CSS);
  const bandBot_css = Math.min(app.PAGE_H, dirtyRowMaxMu * GRID_H + BLEED_BOTTOM_CSS);
  const bandH_css   = Math.max(0, bandBot_css - bandTop_css);
  if (bandH_css <= 0) return;

  backCtx.save();
  backCtx.globalCompositeOperation = 'source-over';
  backCtx.globalAlpha = 1;
  backCtx.fillStyle = '#ffffff';
  backCtx.fillRect(0, bandTop_css, app.PAGE_W, bandH_css);
  backCtx.restore();

  const b = getCurrentBounds();
  const step = Math.max(1, state.lineStepMu || GRID_DIV);
  const startMu = b.Tmu + Math.ceil((dirtyRowMinMu - b.Tmu) / step) * step;
  const endMu   = b.Tmu + Math.floor((dirtyRowMaxMu - b.Tmu) / step) * step;

  for (let rowMu = startMu; rowMu <= endMu; rowMu += step) {
    const rowMap = page.grid.get(rowMu);
    if (!rowMap) continue;

    const baseline = rowMu * GRID_H;
    const rowTop_css = baseline - BLEED_TOP_CSS;
    const rowBot_css = baseline + BLEED_BOTTOM_CSS;
    if (rowBot_css <= bandTop_css || rowTop_css >= bandBot_css) continue;

    for (const [col, stack] of rowMap) {
      const x = col * CHAR_W;
      for (let k = 0; k < stack.length; k++) {
        const s = stack[k];
        drawGlyph(backCtx, s.char, s.ink || 'b', x, baseline, k, stack.length, page.index, rowMu, col);
      }
    }
  }

  const sx = 0, sy = Math.round(bandTop_css * RENDER_SCALE);
  const sw = page.backCanvas.width, sh = Math.round(bandH_css * RENDER_SCALE);
  const dx = 0, dy = bandTop_css, dw = app.PAGE_W, dh = bandH_css;
  ctx.drawImage(page.backCanvas, sx, sy, sw, sh, dx, dy, dw, dh);

  if (state.grainPct > 0) applyGrainOverlayOnRegion(page, bandTop_css, bandH_css);
}
// EOM

function paintPage(page) {
  if (!page.active) return;
  if (page.dirtyAll) {
    page.dirtyAll = false;
    paintWholePageToBackBuffer(page);
    page._dirtyRowMinMu = page._dirtyRowMaxMu = undefined;
    return;
  }
  const hasDirtyRows = page._dirtyRowMinMu !== undefined || page._dirtyRowMaxMu !== undefined;
  if (hasDirtyRows) {
    paintDirtyRowsBand(page, page._dirtyRowMinMu, page._dirtyRowMaxMu);
    page._dirtyRowMinMu = page._dirtyRowMaxMu = undefined;
  }
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

// MARKER-START: applyMetricsNow
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
  clampCaretToBounds();
  updateCaretPosition();
  positionRulers();
  requestVirtualization();
  saveStateDebounced();
  endBatch();
}
// EOM

function ensureRowExists(page, rowMu){
  let r = page.grid.get(rowMu);
  if (!r){ r = new Map(); page.grid.set(rowMu, r); }
  return r;
}

// MARKER-START: writeRunToRow
function writeRunToRow(page, rowMu, startCol, text, ink){
  if (!text || !text.length) return;
  const rowMap = ensureRowExists(page, rowMu);
  for (let i = 0; i < text.length; i++){
    const col = startCol + i;
    let stack = rowMap.get(col);
    if (!stack){ stack = []; rowMap.set(col, stack); }
    stack.push({ char: text[i], ink: ink || 'b' });
  }
  markRowAsDirty(page, rowMu);
}
// EOM

// MARKER-START: insertStringFast
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
// EOM

function overtypeCharacter(page, rowMu, col, ch, ink){
  const rowMap = ensureRowExists(page, rowMu);
  let stack = rowMap.get(col);
  if (!stack){ stack = []; rowMap.set(col, stack); }
  stack.push({ char: ch, ink });
  markRowAsDirty(page, rowMu);
}
function eraseCharacters(page, rowMu, startCol, count){
  let changed = false;
  const rowMap = page.grid.get(rowMu);
  if (!rowMap) return;
  for (let i=0;i<count;i++){
    const col = startCol + i;
    const stack = rowMap.get(col);
    if (stack && stack.length){
      stack.pop();
      changed = true;
      if (!stack.length) rowMap.delete(col);
    }
  }
  if (changed) markRowAsDirty(page, rowMu);
}

// MARKER-START: makePageRecord
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
// EOM

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
  recomputeStageRect();
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
  recomputeStageRect();
}

// MARKER-START: resetPagesBlankPreserveSettings
function resetPagesBlankPreserveSettings(){
  state.pages = [];
  app.stageInner.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'page-wrap'; wrap.dataset.page = '0';
  const pageEl = document.createElement('div'); pageEl.className = 'page'; pageEl.style.height = app.PAGE_H+'px';
  const cv = document.createElement('canvas');
  const mb = document.createElement('div'); mb.className = 'margin-box';
  mb.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
  pageEl.appendChild(cv); pageEl.appendChild(mb);
  wrap.appendChild(pageEl);
  app.stageInner.appendChild(wrap);
  app.firstPageWrap = wrap;
  app.firstPage = pageEl;
  app.marginBox = mb;
  const page = makePageRecord(0, wrap, pageEl, cv, mb);
  page.canvas.style.visibility = 'hidden';
  state.pages.push(page);
  recomputeStageRect();
  renderMargins();
  requestVirtualization();
}
// EOM

const ALT_VARIANTS = 9;
function variantIndexForCell(pageIndex, rowMu, col){
  if (ALT_VARIANTS <= 1) return 0;
  let h = (state.altSeed >>> 0);
  h ^= Math.imul((pageIndex + 1) | 0, 0x9E3779B1);
  h ^= Math.imul((rowMu + 0x10001) | 0, 0x85EBCA77);
  h ^= Math.imul((col + 0x4001) | 0, 0xC2B2AE3D);
  h ^= (h >>> 16);
  return (h >>> 0) % ALT_VARIANTS;
}

// MARKER-START: flattenGridToStreamWithCaret
function flattenGridToStreamWithCaret(){
  const tokens = [];
  let linear = 0;
  let caretIndex = null;
  function maybeSetCaret2(pageIdx, rowMu, colStart, emittedBefore){
    if (caretIndex != null) return;
    if (state.caret.page !== pageIdx || state.caret.rowMu !== rowMu) return;
    const offset = Math.max(0, state.caret.col - colStart);
    caretIndex = linear + emittedBefore + offset;
  }
  for (let p = 0; p < state.pages.length; p++){
    const page = state.pages[p];
    if (!page || page.grid.size === 0) continue;
    const rows = Array.from(page.grid.keys()).sort((a,b)=>a-b);
    for (let ri = 0; ri < rows.length; ri++){
      const rmu = rows[ri];
      const rowMap = page.grid.get(rmu);
      if (!rowMap || rowMap.size === 0){
        if (p === state.caret.page && rmu === state.caret.rowMu && caretIndex == null) caretIndex = linear;
        tokens.push({ ch:'\n' });
        continue;
      }
      let minCol = Infinity, maxCol = -1;
      for (const c of rowMap.keys()){ if (c < minCol) minCol = c; if (c > maxCol) maxCol = c; }
      if (!isFinite(minCol) || maxCol < 0){ tokens.push({ ch:'\n' }); continue; }
      maybeSetCaret2(p, rmu, minCol, 0);
      for (let c = minCol; c <= maxCol; c++){
        const stack = rowMap.get(c);
        if (!stack || stack.length === 0){ tokens.push({ ch:' ' }); linear++; continue; }
        tokens.push({ layers: stack.map(s => ({ ch:s.char, ink:s.ink || 'b' })) });
        linear++;
      }
      tokens.push({ ch:'\n' });
    }
  }
  if (caretIndex == null) caretIndex = linear;
  const out = [];
  for (let i = 0; i < tokens.length; i++){
    const t = tokens[i];
    if (t.ch === '\n' || t.layers || t.ch === ' '){ out.push(t); }
  }
  while (out.length && out[out.length - 1].ch === '\n') out.pop();
  return { tokens: out, caretIndex };
}
// EOM

// MARKER-START: attemptWordWrapAtOverflow
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
// EOM

// MARKER-START: typeStreamIntoGrid
function typeStreamIntoGrid(tokens, caretIndex){
  const b = getCurrentBounds();
  let pageIndex = 0, rowMu = b.Tmu, col = b.L;
  let page = state.pages[0] || addPage();
  let pos = 0, caretSet = false;

  const newline = () => {
    col = b.L; rowMu += state.lineStepMu;
    if (rowMu > b.Bmu){
      pageIndex++;
      page = state.pages[pageIndex] || addPage();
      app.activePageIndex = page.index;
      requestVirtualization();
      rowMu = b.Tmu; col = b.L;
      positionRulers();
    }
  };
  const advance = () => {
    col++;
    if (col > b.R){
      const moved = attemptWordWrapAtOverflow(rowMu, pageIndex, b, false);
      if (moved){
        pageIndex = moved.pageIndex; rowMu = moved.rowMu; col = moved.col;
        page = state.pages[pageIndex] || addPage();
      } else {
        newline();
      }
    }
  };
  const maybeSetCaret = () => { if (!caretSet && pos === caretIndex){ state.caret = { page: pageIndex, rowMu, col }; caretSet = true; } };

  for (const t of tokens){
    if (t.ch === '\n'){ newline(); continue; }
    if (col > b.R){
      const moved = attemptWordWrapAtOverflow(rowMu, pageIndex, b, false);
      if (moved){
        pageIndex = moved.pageIndex; rowMu = moved.rowMu; col = moved.col;
        page = state.pages[pageIndex] || addPage();
      } else {
        newline();
      }
    }
    maybeSetCaret();
    if (t.layers){
      for (const L of t.layers){ overtypeCharacter(page, rowMu, col, L.ch, L.ink || 'b'); }
    } else if (t.ch !== ' '){
      overtypeCharacter(page, rowMu, col, t.ch, t.ink || 'b');
    }
    advance(); pos++;
  }
  if (!caretSet){ state.caret = { page: pageIndex, rowMu, col }; }
}
// EOM

// MARKER-START: rewrapDocumentToCurrentBounds
function rewrapDocumentToCurrentBounds(){
  beginBatch();
  const { tokens, caretIndex } = flattenGridToStreamWithCaret();
  resetPagesBlankPreserveSettings();
  typeStreamIntoGrid(tokens, caretIndex);
  for (const p of state.pages){ p.dirtyAll = true; }
  renderMargins();
  clampCaretToBounds();
  updateCaretPosition();
  positionRulers();
  requestVirtualization();
  saveStateDebounced();
  endBatch();
}
// EOM

const DEAD_X = 1.25, DEAD_Y = 3.0;
function caretViewportPos(){
  const p = state.pages[state.caret.page] || state.pages[0];
  if (!p) return null;
  const r = p.pageEl.getBoundingClientRect();
  const x = r.left + (state.caret.col * CHAR_W) * state.zoom;
  const y = r.top  + (state.caret.rowMu * GRID_H - BASELINE_OFFSET_CELL) * state.zoom;
  return { x, y };
}
function setPaperOffset(x,y){
  if (stageRect){
    x = clamp(x, stageRect.minX, stageRect.maxX);
    y = clamp(y, stageRect.minY, stageRect.maxY);
  }
  state.paperOffset.x = x; state.paperOffset.y = y;
  app.stageInner.style.transform = `translate3d(${x.toFixed(3)}px,${y.toFixed(3)}px,0)`;
  positionRulers();
  requestVirtualization();
}
function anchorPx(){
  return { ax: Math.round(window.innerWidth * state.caretAnchor.x), ay: Math.round(window.innerHeight * state.caretAnchor.y) };
}

// MARKER-START: nudgePaperToAnchor
function nudgePaperToAnchor(){
  if (!state.hammerLock) return;
  const cv = caretViewportPos();
  if (!cv) return;
  const { ax, ay } = anchorPx();
  const dx = ax - cv.x, dy = ay - cv.y;
  if (Math.abs(dx) < DEAD_X && Math.abs(dy) < DEAD_Y) return;
  setPaperOffset(state.paperOffset.x + dx / state.zoom, state.paperOffset.y + dy / state.zoom);
}
// EOM

// MARKER-START: updateCaretPosition
function updateCaretPosition(){
  const p = state.pages[state.caret.page];
  if (!p) return;
  app.caretEl.style.left = (state.caret.col * CHAR_W) + 'px';
  app.caretEl.style.top  = (state.caret.rowMu * GRID_H - BASELINE_OFFSET_CELL) + 'px';
  app.caretEl.style.height = baseCaretHeightPx() + 'px';
  if (app.caretEl.parentNode !== p.pageEl){
    app.caretEl.remove();
    p.pageEl.appendChild(app.caretEl);
  }
  if (!zooming) nudgePaperToAnchor();
  requestVirtualization();
}
// EOM

// MARKER-START: computeSnappedVisualMargins
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
// EOM

// MARKER-START: renderMargins
function renderMargins(){
  const snap = computeSnappedVisualMargins();
  for (const p of state.pages){
    p.pageEl.style.height = app.PAGE_H + 'px';
    p.marginBoxEl.style.left   = Math.round(snap.leftPx) + 'px';
    p.marginBoxEl.style.right  = Math.round(app.PAGE_W - snap.rightPx) + 'px';
    p.marginBoxEl.style.top    = Math.round(snap.topPx) + 'px';
    p.marginBoxEl.style.bottom = Math.round(snap.bottomPx) + 'px';
    p.marginBoxEl.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
  }
}
// EOM

// MARKER-START: getCurrentBounds
function getCurrentBounds(){
  const L = Math.ceil(state.marginL / CHAR_W);
  const Rstrict = Math.floor((state.marginR - 1) / CHAR_W);
  const pageMaxStart = Math.ceil(app.PAGE_W / CHAR_W) - 1;
  const Tmu = Math.ceil((state.marginTop + ASC) / GRID_H);
  const Bmu = Math.floor((app.PAGE_H - state.marginBottom - DESC) / GRID_H);
  const clamp2 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const allowEdgeOverflow = (state.marginR >= app.PAGE_W - 0.5);
  const Lc = clamp2(L, 0, pageMaxStart);
  const RcStrict = clamp2(Rstrict, 0, pageMaxStart);
  const Rc = allowEdgeOverflow ? pageMaxStart : RcStrict;
  return { L: Math.min(Lc, Rc), R: Math.max(Lc, Rc), Tmu, Bmu };
}
// EOM

function snapRowMuToStep(rowMu, b){
  const step = state.lineStepMu;
  const k = Math.round((rowMu - b.Tmu) / step);
  return clamp(b.Tmu + k * step, b.Tmu, b.Bmu);
}
function clampCaretToBounds(){
  const b = getCurrentBounds();
  state.caret.col  = clamp(state.caret.col,  b.L,  b.R);
  state.caret.rowMu = snapRowMuToStep(clamp(state.caret.rowMu, b.Tmu, b.Bmu), b);
  updateCaretPosition();
}
function getActivePageRect(){
  const p = state.pages[app.activePageIndex ?? state.caret.page] || state.pages[0];
  const r = p.wrapEl.getBoundingClientRect();
  return new DOMRect(r.left, r.top, r.width, app.PAGE_H * state.zoom);
}

// MARKER-START: updateRulerTicks
function updateRulerTicks(activePageRect){
  const ticksH = app.rulerH_host.querySelector('.ruler-ticks');
  const ticksV = app.rulerV_host.querySelector('.ruler-v-ticks');
  ticksH.innerHTML = ''; ticksV.innerHTML = '';
  const ppiH = (activePageRect.width / 210) * 25.4;
  const originX = activePageRect.left;
  const stageBounds = app.stageInner.getBoundingClientRect();
  const stageLeft = stageBounds.left;
  const stageRight = stageBounds.right;
  ticksH.style.width = `${Math.round(stageBounds.width)}px`;
  ticksH.style.left = '0px';
  const startInchH = Math.floor((stageLeft - originX) / ppiH), endInchH = Math.ceil((stageRight - originX) / ppiH);
  for (let i=startInchH;i<=endInchH;i++){
    for (let j=0;j<10;j++){
      const x = originX + (i + j/10) * ppiH;
      if (x < stageLeft || x > stageRight) continue;
      const tick = document.createElement('div');
      tick.className = j===0 ? 'tick major' : j===5 ? 'tick medium' : 'tick minor';
      tick.style.left = (x - stageLeft) + 'px';
      ticksH.appendChild(tick);
      if (j===0){
        const lbl = document.createElement('div'); lbl.className='tick-num';
        lbl.textContent = i; lbl.style.left = (x - stageLeft + 4) + 'px';
        ticksH.appendChild(lbl);
      }
    }
  }
  const ppiV = (activePageRect.height / 297) * 25.4;
  const originY = activePageRect.top;
  const stageTop = stageBounds.top;
  const stageBottom = stageBounds.bottom;
  ticksV.style.height = `${Math.round(stageBounds.height)}px`;
  ticksV.style.top = '0px';
  const startInchV = Math.floor((stageTop - originY) / ppiV), endInchV = Math.ceil((stageBottom - originY) / ppiV);
  for (let i=startInchV;i<=endInchV;i++){
    for (let j=0;j<10;j++){
      const y = originY + (i + j/10) * ppiV;
      if (y < stageTop || y > stageBottom) continue;
      const tick = document.createElement('div');
      tick.className = j===0 ? 'tick-v major' : j===5 ? 'tick-v medium' : 'tick-v minor';
      tick.style.top = (y - stageTop) + 'px';
      ticksV.appendChild(tick);
      if (j===0){
        const lbl = document.createElement('div'); lbl.className='tick-v-num';
        lbl.textContent = i; lbl.style.top = (y - stageTop + 4) + 'px';
        ticksV.appendChild(lbl);
      }
    }
  }
}
// EOM

// MARKER-START: positionRulers
function positionRulers(){
  if (!state.showRulers) return;
  app.rulerH_stops_container.innerHTML = '';
  app.rulerV_stops_container.innerHTML = '';
  const stageBounds = app.stageInner.getBoundingClientRect();
  const stageLeft = Math.round(stageBounds.left);
  const stageTop = Math.round(stageBounds.top);
  const stageWidth = Math.round(stageBounds.width);
  const stageHeight = Math.round(stageBounds.height);
  app.rulerH_host.style.left = stageLeft + 'px';
  app.rulerH_host.style.right = 'auto';
  app.rulerH_host.style.width = stageWidth + 'px';
  app.rulerH_stops_container.style.width = stageWidth + 'px';
  app.rulerH_stops_container.style.left = '0px';
  app.rulerH_stops_container.style.top = '0px';
  app.rulerV_host.style.left = stageLeft + 'px';
  app.rulerV_host.style.top = stageTop + 'px';
  app.rulerV_host.style.bottom = 'auto';
  app.rulerV_host.style.height = stageHeight + 'px';
  app.rulerV_stops_container.style.height = stageHeight + 'px';
  app.rulerV_stops_container.style.top = '0px';
  app.rulerV_stops_container.style.left = '0px';
  const pageRect = getActivePageRect();
  const snap = computeSnappedVisualMargins();
  const mLeft = document.createElement('div');
  mLeft.className = 'tri left';
  mLeft.style.left = (pageRect.left - stageBounds.left + snap.leftPx * state.zoom) + 'px';
  app.rulerH_stops_container.appendChild(mLeft);
  const mRight = document.createElement('div');
  mRight.className = 'tri right';
  mRight.style.left = (pageRect.left - stageBounds.left + snap.rightPx * state.zoom) + 'px';
  app.rulerH_stops_container.appendChild(mRight);
  const mTop = document.createElement('div');
  mTop.className = 'tri-v top';
  mTop.style.top = (pageRect.top - stageBounds.top + snap.topPx * state.zoom) + 'px';
  app.rulerV_stops_container.appendChild(mTop);
  const mBottom = document.createElement('div');
  mBottom.className = 'tri-v bottom';
  mBottom.style.top = (pageRect.top - stageBounds.top + (app.PAGE_H - snap.bottomPx) * state.zoom) + 'px';
  app.rulerV_stops_container.appendChild(mBottom);
  updateRulerTicks(pageRect);
}
// EOM

function setMarginBoxesVisible(show){
  for (const p of state.pages){
    if (p?.marginBoxEl) p.marginBoxEl.style.visibility = (show && state.showMarginBox) ? 'visible' : 'hidden';
  }
}
function snapXToGrid(x){ return Math.round(x / CHAR_W) * CHAR_W; }
function snapYToGrid(y){ return Math.round(y / GRID_H) * GRID_H; }

// MARKER-START: handleHorizontalMarginDrag
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
// EOM

// MARKER-START: handleVerticalMarginDrag
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
// EOM

// MARKER-START: endMarginDrag
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
// EOM

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

// MARKER-START: applySubmittedChanges
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
// EOM

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
  app.zoomWrap.style.transform = `scale(${state.zoom})`;
  positionRulers();
  requestVirtualization();
}

// MARKER-START: scheduleZoomCrispRedraw
function scheduleZoomCrispRedraw(){
  if (zoomDebounceTimer) clearTimeout(zoomDebounceTimer);
  zoomDebounceTimer = setTimeout(()=>{
    zoomDebounceTimer = null;
    zooming = false;
    freezeVirtual = false;
    setRenderScaleForZoom();
    for (const p of state.pages){
      prepareCanvas(p.canvas);
      prepareCanvas(p.backCanvas);
      configureCanvasContext(p.ctx);
      configureCanvasContext(p.backCtx);
      p.dirtyAll = true;
    }
    rebuildAllAtlases();
    for (const p of state.pages){ if (p.active) schedulePaint(p); }
    nudgePaperToAnchor();
  }, 160);
}
// EOM

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

// MARKER-START: setZoomPercent
function setZoomPercent(p){
  const z = detent(Math.round(Math.max(Z_MIN, Math.min(Z_MAX, p))));
  state.zoom = z / 100;
  applyZoomCSS();
  recomputeStageRect();
  scheduleZoomCrispRedraw();
  updateZoomUIFromState();
  saveStateDebounced();
}
// EOM

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

// New/modified panel functions
function toggleFontsPanel() {
  const isOpen = app.fontsPanel.classList.toggle('is-open');
  if (isOpen) {
    for (const r of app.fontRadios()){ r.checked = (r.value === ACTIVE_FONT_NAME); }
    app.settingsPanel.classList.remove('is-open');
  }
}
function toggleSettingsPanel() {
  const isOpen = app.settingsPanel.classList.toggle('is-open');
  if (isOpen) {
    app.fontsPanel.classList.remove('is-open');
  }
}

// MARKER-START: advanceCaret
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
// EOM

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

// MARKER-START: insertString
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
// EOM

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

// MARKER-START: handleKeyDown
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
// EOM

// MARKER-START: handlePaste
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
// EOM

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

// MARKER-START: serializeState
function serializeState(){
  const pages = state.pages.map(p=>{
    const rows=[]; for (const [rmu,rowMap] of p.grid){
      const cols=[]; for (const [c,stack] of rowMap){
        cols.push([c, stack.map(s=>({ ch:s.char, ink:s.ink||'b' }))]);
      }
      rows.push([rmu, cols]);
    }
    return { rows };
  });
  return {
    v:21, fontName: ACTIVE_FONT_NAME,
    margins:{ L:state.marginL, R:state.marginR, T:state.marginTop, B:state.marginBottom },
    caret: state.caret, ink: state.ink, showRulers: state.showRulers, showMarginBox: state.showMarginBox,
    cpi: state.cpi, colsAcross: state.colsAcross, inkWidthPct: state.inkWidthPct,
    inkOpacity: state.inkOpacity, lineHeightFactor: state.lineHeightFactor, zoom: state.zoom,
    grainPct: state.grainPct, grainSeed: state.grainSeed >>> 0, altSeed: state.altSeed >>> 0,
    wordWrap: state.wordWrap,
    pages
  };
}
// EOM

// MARKER-START: deserializeState
function deserializeState(data){
  if (!data || (data.v<2 || data.v>21)) return false;
  state.pages=[]; app.stageInner.innerHTML='';
  const pgArr = data.pages || [];
  pgArr.forEach((pg, idx)=>{
    const wrap=document.createElement('div'); wrap.className='page-wrap'; wrap.dataset.page=String(idx);
    const pageEl=document.createElement('div'); pageEl.className='page'; pageEl.style.height=app.PAGE_H+'px';
    const cv=document.createElement('canvas'); prepareCanvas(cv);
    const mb=document.createElement('div'); mb.className='margin-box';
    pageEl.appendChild(cv); pageEl.appendChild(mb); wrap.appendChild(pageEl); app.stageInner.appendChild(wrap);
    const page = makePageRecord(idx, wrap, pageEl, cv, mb);
    pageEl.addEventListener('mousedown', e => handlePageClick(e, idx));
    state.pages.push(page);
    if (Array.isArray(pg.rows)){
      for (const [rmu, cols] of pg.rows){
        const rowMap = new Map();
        for (const [c, stackArr] of cols){
          rowMap.set(c, stackArr.map(s => ({ char:s.ch, ink:s.ink || 'b' })));
        }
        page.grid.set(rmu, rowMap);
      }
    }
  });
  let inferredCols = data.colsAcross, cpiVal = data.cpi ?? null;
  if (cpiVal) inferredCols = computeColsFromCpi(cpiVal).cols2;
  const inkOpacity = (data.inkOpacity && typeof data.inkOpacity === 'object')
    ? { b: clamp(Number(data.inkOpacity.b ?? 100),0,100), r: clamp(Number(data.inkOpacity.r ?? 100),0,100), w: clamp(Number(data.inkOpacity.w ?? 100),0,100) }
    : { b:100, r:100, w:100 };
  const storedInkWidth = Number(data.inkWidthPct);
  const sanitizedInkWidth = Number.isFinite(storedInkWidth)
    ? clamp(Math.round(storedInkWidth), 1, 150)
    : 84;
  Object.assign(state, {
    marginL: data.margins?.L ?? state.marginL, marginR: data.margins?.R ?? state.marginR,
    marginTop: data.margins?.T ?? state.marginTop, marginBottom: data.margins?.B ?? state.marginBottom,
    caret: data.caret ? { page:data.caret.page||0, rowMu:data.caret.rowMu||0, col:data.caret.col||0 } : state.caret,
    ink: ['b','r','w'].includes(data.ink) ? data.ink : 'b',
    showRulers: data.showRulers !== false, showMarginBox: !!data.showMarginBox,
    cpi: cpiVal || 10, colsAcross: inferredCols ?? state.colsAcross,
    inkWidthPct: sanitizedInkWidth, inkOpacity,
    lineHeightFactor: ([1,1.5,2,2.5,3].includes(data.lineHeightFactor)) ? data.lineHeightFactor : 1,
    zoom: (typeof data.zoom === 'number' && data.zoom >= 0.5 && data.zoom <= 4) ? data.zoom : 1.0,
    grainPct: clamp(Number(data.grainPct ?? 0), 0, 100),
    grainSeed: (data.grainSeed >>> 0) || ((Math.random()*0xFFFFFFFF)>>>0),
    altSeed: (data.altSeed >>> 0) || (((data.grainSeed>>>0) ^ 0xA5A5A5A5) >>> 0) || ((Math.random()*0xFFFFFFFF)>>>0),
    wordWrap: (data.wordWrap !== false)
  });
  state.lineStepMu = Math.round(GRID_DIV * state.lineHeightFactor);
  if (data.fontName) ACTIVE_FONT_NAME = data.fontName;
  FONT_FAMILY = `${ACTIVE_FONT_NAME}`;
  for (const p of state.pages){ p.dirtyAll = true; }
  document.body.classList.toggle('rulers-off', !state.showRulers);
  recomputeStageRect();
  return true;
}
// EOM

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

// MARKER-START: visibleWindowIndices
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
// EOM

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

// MARKER-START: exportToTextFile
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
// EOM

// MARKER-START: createNewDocument
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
  recomputeStageRect();
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
// EOM

// MARKER-START: bindEventListeners
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
  window.addEventListener('keydown', e=>{ if (e.key === 'Escape') {
    app.fontsPanel.classList.remove('is-open');
    app.settingsPanel.classList.remove('is-open');
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
  window.addEventListener('resize', () => { recomputeStageRect(); positionRulers(); if (!zooming) nudgePaperToAnchor(); requestVirtualization(); }, { passive: true });
  window.addEventListener('beforeunload', saveStateNow);
  window.addEventListener('click', () => window.focus(), { passive: true });
}
// EOM

// MARKER-START: initialize
async function initialize() {
  bindEventListeners();
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
// EOM

initialize();
}
