import { clamp } from '../utils/math.js';

export const STATE_VERSION = 21;
export const MIN_STATE_VERSION = 2;

export function createPersistenceController({
  state,
  app,
  storageKey,
  gridDiv,
  getActiveFontName,
  setActiveFontName,
  makePageRecord,
  prepareCanvas,
  handlePageClick,
  computeColsFromCpi,
  getSaveTimer,
  setSaveTimer,
}) {
  function serializeState() {
    const pages = state.pages.map((p) => {
      const rows = [];
      for (const [rmu, rowMap] of p.grid) {
        const cols = [];
        for (const [c, stack] of rowMap) {
          cols.push([c, stack.map((s) => ({ ch: s.char, ink: s.ink || 'b' }))]);
        }
        rows.push([rmu, cols]);
      }
      return { rows };
    });
    return {
      v: STATE_VERSION,
      fontName: getActiveFontName(),
      margins: {
        L: state.marginL,
        R: state.marginR,
        T: state.marginTop,
        B: state.marginBottom,
      },
      caret: state.caret,
      ink: state.ink,
      showRulers: state.showRulers,
      showMarginBox: state.showMarginBox,
      cpi: state.cpi,
      colsAcross: state.colsAcross,
      inkWidthPct: state.inkWidthPct,
      inkOpacity: state.inkOpacity,
      lineHeightFactor: state.lineHeightFactor,
      zoom: state.zoom,
      grainPct: state.grainPct,
      grainSeed: state.grainSeed >>> 0,
      altSeed: state.altSeed >>> 0,
      wordWrap: state.wordWrap,
      stageWidthFactor: state.stageWidthFactor,
      stageHeightFactor: state.stageHeightFactor,
      pages,
    };
  }

  function deserializeState(data) {
    if (!data || data.v < MIN_STATE_VERSION || data.v > STATE_VERSION) return false;
    state.pages = [];
    app.stageInner.innerHTML = '';
    const pgArr = data.pages || [];
    pgArr.forEach((pg, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'page-wrap';
      wrap.dataset.page = String(idx);
      const pageEl = document.createElement('div');
      pageEl.className = 'page';
      pageEl.style.height = app.PAGE_H + 'px';
      const cv = document.createElement('canvas');
      prepareCanvas(cv);
      const mb = document.createElement('div');
      mb.className = 'margin-box';
      pageEl.appendChild(cv);
      pageEl.appendChild(mb);
      wrap.appendChild(pageEl);
      app.stageInner.appendChild(wrap);
      const page = makePageRecord(idx, wrap, pageEl, cv, mb);
      pageEl.addEventListener('mousedown', (e) => handlePageClick(e, idx));
      state.pages.push(page);
      if (Array.isArray(pg.rows)) {
        for (const [rmu, cols] of pg.rows) {
          const rowMap = new Map();
          for (const [c, stackArr] of cols) {
            rowMap.set(c, stackArr.map((s) => ({ char: s.ch, ink: s.ink || 'b' })));
          }
          page.grid.set(rmu, rowMap);
        }
      }
    });
    let inferredCols = data.colsAcross;
    const cpiVal = data.cpi ?? null;
    if (cpiVal) inferredCols = computeColsFromCpi(cpiVal).cols2;
    const inkOpacity =
      data.inkOpacity && typeof data.inkOpacity === 'object'
        ? {
            b: clamp(Number(data.inkOpacity.b ?? 100), 0, 100),
            r: clamp(Number(data.inkOpacity.r ?? 100), 0, 100),
            w: clamp(Number(data.inkOpacity.w ?? 100), 0, 100),
          }
        : { b: 100, r: 100, w: 100 };
    const storedInkWidth = Number(data.inkWidthPct);
    const sanitizedInkWidth = Number.isFinite(storedInkWidth)
      ? clamp(Math.round(storedInkWidth), 1, 150)
      : 84;
    const storedStageWidth = Number(data.stageWidthFactor);
    const storedStageHeight = Number(data.stageHeightFactor);
    const sanitizedStageWidth = Number.isFinite(storedStageWidth)
      ? clamp(storedStageWidth, 1, 5)
      : state.stageWidthFactor;
    const sanitizedStageHeight = Number.isFinite(storedStageHeight)
      ? clamp(storedStageHeight, 1, 5)
      : state.stageHeightFactor;
    Object.assign(state, {
      marginL: data.margins?.L ?? state.marginL,
      marginR: data.margins?.R ?? state.marginR,
      marginTop: data.margins?.T ?? state.marginTop,
      marginBottom: data.margins?.B ?? state.marginBottom,
      caret: data.caret
        ? { page: data.caret.page || 0, rowMu: data.caret.rowMu || 0, col: data.caret.col || 0 }
        : state.caret,
      ink: ['b', 'r', 'w'].includes(data.ink) ? data.ink : 'b',
      showRulers: data.showRulers !== false,
      showMarginBox: !!data.showMarginBox,
      cpi: cpiVal || 10,
      colsAcross: inferredCols ?? state.colsAcross,
      inkWidthPct: sanitizedInkWidth,
      inkOpacity,
      lineHeightFactor: [1, 1.5, 2, 2.5, 3].includes(data.lineHeightFactor) ? data.lineHeightFactor : 1,
      zoom: typeof data.zoom === 'number' && data.zoom >= 0.5 && data.zoom <= 4 ? data.zoom : 1.0,
      grainPct: clamp(Number(data.grainPct ?? 0), 0, 100),
      grainSeed: (data.grainSeed >>> 0) || ((Math.random() * 0xffffffff) >>> 0),
      altSeed:
        (data.altSeed >>> 0) || (((data.grainSeed >>> 0) ^ 0xa5a5a5a5) >>> 0) || ((Math.random() * 0xffffffff) >>> 0),
      wordWrap: data.wordWrap !== false,
      stageWidthFactor: sanitizedStageWidth,
      stageHeightFactor: sanitizedStageHeight,
    });
    state.lineStepMu = Math.round(gridDiv * state.lineHeightFactor);
    if (data.fontName) setActiveFontName(data.fontName);
    for (const p of state.pages) {
      p.dirtyAll = true;
    }
    document.body.classList.toggle('rulers-off', !state.showRulers);
    return true;
  }

  function saveStateNow() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(serializeState()));
    } catch {}
  }

  function saveStateDebounced() {
    const currentTimer = getSaveTimer();
    if (currentTimer) clearTimeout(currentTimer);
    const timer = setTimeout(saveStateNow, 400);
    setSaveTimer(timer);
  }

  return {
    serializeState,
    deserializeState,
    saveStateNow,
    saveStateDebounced,
  };
}
