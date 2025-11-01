import { clamp } from '../utils/math.js';

export function createPageLifecycleController(context, editingController) {
  const {
    app,
    state,
    layoutZoomFactor,
    getRenderScale,
    getFontSize,
    getActiveFontName,
    exactFontString,
    getGridHeight,
    getCharWidth,
    getFreezeVirtual,
    getVirtRAF,
    setVirtRAF,
    renderMargins,
    positionRulers,
    resetTypedRun,
  } = context;

  const {
    touchPage,
    getCurrentBounds,
    snapRowMuToStep,
    clampCaretToBounds,
    updateCaretPosition,
  } = editingController;

  let schedulePaint = () => {};

  function prepareCanvas(canvas) {
    canvas.width = Math.floor(app.PAGE_W * getRenderScale());
    canvas.height = Math.floor(app.PAGE_H * getRenderScale());
    const displayZoom = layoutZoomFactor();
    canvas.style.width = (app.PAGE_W * displayZoom) + 'px';
    canvas.style.height = (app.PAGE_H * displayZoom) + 'px';
  }

  function configureCanvasContext(ctx) {
    const renderScale = getRenderScale();
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.font = exactFontString(getFontSize(), getActiveFontName());
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.imageSmoothingEnabled = false;
    try { ctx.filter = 'none'; } catch {}
    ctx.globalCompositeOperation = 'source-over';
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
      index: idx,
      wrapEl,
      pageEl,
      canvas,
      ctx,
      backCanvas,
      backCtx,
      grid: new Map(),
      raf: 0,
      dirtyAll: true,
      active: false,
      _dirtyRowMinMu: undefined,
      _dirtyRowMaxMu: undefined,
      marginBoxEl,
      grainCanvas: null,
      grainForSize: { w: 0, h: 0, key: null },
    };
    const handler = (e) => handlePageClick(e, idx);
    pageEl.addEventListener('mousedown', handler, { capture: false });
    canvas.addEventListener('mousedown', handler, { capture: false });
    return page;
  }

  function addPage() {
    const idx = state.pages.length;
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = String(idx);
    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.height = app.PAGE_H + 'px';
    const canvas = document.createElement('canvas');
    const mb = document.createElement('div');
    mb.className = 'margin-box';
    mb.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
    pageEl.appendChild(canvas);
    pageEl.appendChild(mb);
    wrap.appendChild(pageEl);
    app.stageInner.appendChild(wrap);
    const page = makePageRecord(idx, wrap, pageEl, canvas, mb);
    page.canvas.style.visibility = 'hidden';
    state.pages.push(page);
    renderMargins();
    requestVirtualization();
    return page;
  }

  function bootstrapFirstPage() {
    const pageEl = app.firstPage;
    pageEl.style.height = app.PAGE_H + 'px';
    const canvas = pageEl.querySelector('canvas');
    const page = makePageRecord(0, app.firstPageWrap, pageEl, canvas, app.marginBox);
    page.canvas.style.visibility = 'hidden';
    page.marginBoxEl.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
    state.pages.push(page);
  }

  function resetPagesBlankPreserveSettings() {
    state.pages = [];
    app.stageInner.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = '0';
    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.height = app.PAGE_H + 'px';
    const canvas = document.createElement('canvas');
    const marginBoxEl = document.createElement('div');
    marginBoxEl.className = 'margin-box';
    marginBoxEl.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
    pageEl.appendChild(canvas);
    pageEl.appendChild(marginBoxEl);
    wrap.appendChild(pageEl);
    app.stageInner.appendChild(wrap);
    app.firstPageWrap = wrap;
    app.firstPage = pageEl;
    app.marginBox = marginBoxEl;
    const page = makePageRecord(0, wrap, pageEl, canvas, marginBoxEl);
    page.canvas.style.visibility = 'hidden';
    state.pages.push(page);
    renderMargins();
    requestVirtualization();
  }

  function handlePageClick(e, pageIndex) {
    e.preventDefault();
    e.stopPropagation();
    const ae = document.activeElement;
    if (ae && ae !== document.body) { try { ae.blur(); } catch {} }
    const pageEl = (e.currentTarget.classList?.contains('page'))
      ? e.currentTarget
      : e.currentTarget.closest('.page');
    if (!pageEl) return;
    const rect = pageEl.getBoundingClientRect();
    const bounds = getCurrentBounds();
    const gridHeight = getGridHeight();
    const charWidth = getCharWidth();
    const zoom = state.zoom || 1;
    const rawRowMu = Math.round(((e.clientY - rect.top) / zoom) / gridHeight);
    const rowMu = snapRowMuToStep(clamp(rawRowMu, bounds.Tmu, bounds.Bmu), bounds);
    const col = clamp(
      Math.floor(((e.clientX - rect.left) / zoom) / charWidth),
      bounds.L,
      bounds.R,
    );
    state.caret = { page: pageIndex, rowMu, col };
    app.activePageIndex = pageIndex;
    resetTypedRun();
    updateCaretPosition();
    positionRulers();
  }

  function effectiveVirtualPad() {
    return state.zoom >= 3 ? 0 : 1;
  }

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
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < state.pages.length; i++) {
      const r = state.pages[i].wrapEl.getBoundingClientRect();
      const d = Math.abs(((r.top + r.bottom) / 2) - scrollCenterY);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const pad = effectiveVirtualPad();
    let i0 = Math.max(0, bestIdx - pad);
    let i1 = Math.min(state.pages.length - 1, bestIdx + pad);
    const cp = state.caret.page;
    i0 = Math.min(i0, cp);
    i1 = Math.max(i1, cp);
    return [i0, i1];
  }

  function updateVirtualization() {
    if (getFreezeVirtual()) {
      for (let i = 0; i < state.pages.length; i++) setPageActive(state.pages[i], true);
      return;
    }
    if (state.pages.length === 0) return;
    const [i0, i1] = visibleWindowIndices();
    for (let i = 0; i < state.pages.length; i++) {
      setPageActive(state.pages[i], i >= i0 && i <= i1);
    }
  }

  function requestVirtualization() {
    if (getVirtRAF()) return;
    const raf = requestAnimationFrame(() => {
      setVirtRAF(0);
      updateVirtualization();
    });
    setVirtRAF(raf);
  }

  function registerRendererHooks({ schedulePaint: schedulePaintFn }) {
    if (typeof schedulePaintFn === 'function') {
      schedulePaint = schedulePaintFn;
    }
  }

  return {
    prepareCanvas,
    configureCanvasContext,
    makePageRecord,
    addPage,
    bootstrapFirstPage,
    resetPagesBlankPreserveSettings,
    setPageActive,
    visibleWindowIndices,
    updateVirtualization,
    requestVirtualization,
    handlePageClick,
    touchPage,
    clampCaretToBounds,
    updateCaretPosition,
    registerRendererHooks,
  };
}
