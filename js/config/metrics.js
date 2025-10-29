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
  const COLORS = { b:'#000000', r:'#b00000', w:'#ffffff' };
  const STORAGE_KEY = 'typewriter.minimal.v16';
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
