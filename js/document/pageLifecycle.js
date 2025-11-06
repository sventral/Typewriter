import { clamp } from '../utils/math.js';

const CANVAS_RENDER_SCALE_PROP = '__twRenderScale';

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

  function currentCanvasScale(canvas) {
    const stored = canvas?.[CANVAS_RENDER_SCALE_PROP];
    return Number.isFinite(stored) ? stored : null;
  }

  function prepareCanvas(canvas, options = {}) {
    if (!canvas) return false;
    const { page = null, renderScale: overrideScale } = options || {};
    const targetScale = Number.isFinite(overrideScale)
      ? overrideScale
      : getRenderScale();
    const previousScale = currentCanvasScale(canvas);
    const resized = !Number.isFinite(previousScale)
      || previousScale <= 0
      || Math.abs(previousScale - targetScale) > 0.0001;
    if (resized) {
      canvas.width = Math.max(1, Math.floor(app.PAGE_W * targetScale));
      canvas.height = Math.max(1, Math.floor(app.PAGE_H * targetScale));
      canvas[CANVAS_RENDER_SCALE_PROP] = targetScale;
      if (page) {
        if (canvas === page.canvas) page.renderScale = targetScale;
        if (canvas === page.backCanvas) page.backRenderScale = targetScale;
      }
    }
    const displayZoom = layoutZoomFactor();
    canvas.style.width = (app.PAGE_W * displayZoom) + 'px';
    canvas.style.height = (app.PAGE_H * displayZoom) + 'px';
    return resized;
  }

  function resolveRenderScaleForContext(ctx, explicitScale) {
    if (Number.isFinite(explicitScale)) return explicitScale;
    if (ctx?.canvas) {
      const stored = currentCanvasScale(ctx.canvas);
      if (Number.isFinite(stored)) return stored;
    }
    return getRenderScale();
  }

  function configureCanvasContext(ctx, renderScaleOverride) {
    if (!ctx) return;
    const renderScale = resolveRenderScaleForContext(ctx, renderScaleOverride);
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
    const page = {
      index: idx,
      wrapEl,
      pageEl,
      canvas,
      ctx: null,
      backCanvas: null,
      backCtx: null,
      grid: new Map(),
      raf: 0,
      dirtyAll: true,
      active: false,
      _dirtyRowMinMu: undefined,
      _dirtyRowMaxMu: undefined,
      marginBoxEl,
      grainCanvas: null,
      grainForSize: { w: 0, h: 0, key: null },
      renderScale: null,
      backRenderScale: null,
      needsHighResRepaint: false,
    };
    const handler = (e) => handlePageClick(e, idx);
    pageEl.addEventListener('mousedown', handler, { capture: false });
    canvas.addEventListener('mousedown', handler, { capture: false });

    prepareCanvas(canvas, { page });
    const ctx = canvas.getContext('2d');
    page.ctx = ctx;
    configureCanvasContext(ctx);

    const backCanvas = document.createElement('canvas');
    page.backCanvas = backCanvas;
    prepareCanvas(backCanvas, { page });
    const backCtx = backCanvas.getContext('2d');
    page.backCtx = backCtx;
    configureCanvasContext(backCtx);
    backCtx.save();
    backCtx.globalCompositeOperation = 'source-over';
    backCtx.globalAlpha = 1;
    backCtx.fillStyle = '#ffffff';
    backCtx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
    backCtx.restore();
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
      if (page.canvas?.style) {
        page.canvas.style.visibility = 'visible';
      }
      if (page.needsHighResRepaint) {
        const resizedFront = prepareCanvas(page.canvas, { page });
        const resizedBack = prepareCanvas(page.backCanvas, { page });
        if (resizedFront && page.ctx) configureCanvasContext(page.ctx);
        if (resizedBack && page.backCtx) configureCanvasContext(page.backCtx);
        page.dirtyAll = true;
        page.needsHighResRepaint = false;
      }
      const hasPendingRows = page._dirtyRowMinMu !== undefined || page._dirtyRowMaxMu !== undefined;
      if (page.dirtyAll || hasPendingRows) {
        schedulePaint(page);
      }
    } else {
      if (page.canvas?.style) {
        page.canvas.style.visibility = 'hidden';
      }
      if (page.raf && typeof cancelAnimationFrame === 'function') {
        try {
          cancelAnimationFrame(page.raf);
        } catch {}
        page.raf = 0;
      }
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
