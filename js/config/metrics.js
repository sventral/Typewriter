export function computeBaseMetrics(app) {
  const rootStyles = getComputedStyle(document.documentElement);
  const PAGE_W_CSS = parseInt(rootStyles.getPropertyValue('--page-w')) || 900;
  const PAGE_H_CSS = Math.round(PAGE_W_CSS * 297 / 210);
  const DPR = Math.max(1, Math.min(4, window.devicePixelRatio || 1));
  Object.assign(app, { PAGE_W: PAGE_W_CSS, PAGE_H: PAGE_H_CSS });

  const A4_WIDTH_IN = 210 / 25.4;
  const PPI = app.PAGE_W / (210 / 25.4);
  const LPI = 6;
  const LINE_H_RAW = PPI / LPI;
  const GRID_DIV = 8;
  const GRID_H = LINE_H_RAW / GRID_DIV;
  const ACTIVE_FONT_NAME = 'TT2020StyleE';
  const COLORS = { b:'#1f2024', r:'#b00000', w:'#f7f5ee' };
  const STORAGE_KEY = 'typewriter.minimal.v17';
  const RENDER_SCALE = DPR;
  const FONT_FAMILY = ACTIVE_FONT_NAME;
  const FONT_SIZE = 0;
  const ASC = 0;
  const DESC = 0;
  const CHAR_W = 0;
  const BASELINE_OFFSET_CELL = 0;

  return {
    PAGE_W_CSS,
    PAGE_H_CSS,
    DPR,
    GRID_DIV,
    GRID_H,
    ACTIVE_FONT_NAME,
    COLORS,
    STORAGE_KEY,
    RENDER_SCALE,
    FONT_FAMILY,
    FONT_SIZE,
    ASC,
    DESC,
    CHAR_W,
    BASELINE_OFFSET_CELL,
    A4_WIDTH_IN,
    PPI,
    LPI,
    LINE_H_RAW,
  };
}

export function exactFontString(sizePx, face) {
  return `400 ${sizePx}px "${face}"`;
}

export function calibrateMonospaceFont(targetPitchPx, face, inkWidthPct) {
  const pct = (typeof inkWidthPct === 'number' && isFinite(inkWidthPct)) ? inkWidthPct : 95;
  const targetInkPx = Math.max(0.25, targetPitchPx * (pct / 100));
  const BASE = 200;
  const TEST = 'MW@#%&()[]{}|/\\abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const c = document.createElement('canvas').getContext('2d');
  const wmax = (size) => {
    c.font = exactFontString(size, face);
    let m = 0;
    for (const ch of TEST) {
      m = Math.max(m, c.measureText(ch).width);
    }
    return m + 0.25;
  };
  let size = Math.max(1, targetInkPx * BASE / wmax(BASE));
  for (let i = 0; i < 8; i++) {
    const r = targetInkPx / Math.max(0.25, wmax(size));
    if (Math.abs(1 - r) < 0.002) break;
    size = Math.max(1, size * r);
  }
  while (wmax(size) > targetInkPx) size = Math.max(1, size - 0.25);
  c.font = exactFontString(size, face);
  const m = c.measureText('Hg');
  return {
    size,
    asc: m.actualBoundingBoxAscent || size * 0.8,
    desc: m.actualBoundingBoxDescent || size * 0.2,
  };
}

function roundToDevicePixelRatio(value, dpr) {
  if (!dpr || !isFinite(dpr)) return Math.max(0.25, value);
  const q = Math.round(value * dpr);
  let rounded = q / dpr;
  if (rounded > value) rounded = (q - 1) / dpr;
  return Math.max(0.25, rounded);
}

export function recalcMetrics(face, options) {
  if (!options) return;
  const {
    state,
    metricsStore,
    contextMetrics,
    app,
    lineHeightRaw,
    gridDiv,
    getTargetPitchPx,
    dpr,
    onCaretHeightChange,
  } = options;

  if (!metricsStore || typeof getTargetPitchPx !== 'function') return;

  const targetPitch = getTargetPitchPx();
  const calibration = calibrateMonospaceFont(targetPitch, face, state?.inkWidthPct);

  metricsStore.FONT_SIZE = calibration.size;
  metricsStore.ASC = calibration.asc;
  metricsStore.DESC = calibration.desc;
  metricsStore.CHAR_W = roundToDevicePixelRatio(targetPitch, dpr);
  metricsStore.GRID_H = lineHeightRaw / gridDiv;
  metricsStore.BASELINE_OFFSET_CELL = metricsStore.ASC;

  if (contextMetrics) {
    contextMetrics.FONT_SIZE = metricsStore.FONT_SIZE;
    contextMetrics.ASC = metricsStore.ASC;
    contextMetrics.DESC = metricsStore.DESC;
    contextMetrics.CHAR_W = metricsStore.CHAR_W;
    contextMetrics.BASELINE_OFFSET_CELL = metricsStore.BASELINE_OFFSET_CELL;
    contextMetrics.GRID_H = metricsStore.GRID_H;
  }

  const caretHeight = gridDiv * metricsStore.GRID_H;
  if (typeof onCaretHeightChange === 'function') {
    onCaretHeightChange(caretHeight);
  } else if (app?.caretEl?.style) {
    app.caretEl.style.height = caretHeight + 'px';
  }
}

export function scheduleMetricsUpdate(options, full = false) {
  if (!options) return;
  const {
    ephemeral,
    applyMetricsNow,
    requestAnimationFrameFn = requestAnimationFrame,
  } = options;

  if (!ephemeral || typeof applyMetricsNow !== 'function') {
    return;
  }

  ephemeral.pendingFullRebuild = ephemeral.pendingFullRebuild || full;
  if (ephemeral.metricsRAF) return;

  ephemeral.metricsRAF = requestAnimationFrameFn(() => {
    ephemeral.metricsRAF = 0;
    const doFull = ephemeral.pendingFullRebuild;
    ephemeral.pendingFullRebuild = false;
    applyMetricsNow(doFull);
  });
}
