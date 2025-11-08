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

  let lastScrollFocusIndex = 0;

  function effectiveVirtualPad() {
    return state.zoom >= 2 ? 0 : 1;
  }

  function clampIndex(idx) {
    if (!Number.isInteger(idx)) return 0;
    if (!state.pages.length) return 0;
    return Math.max(0, Math.min(state.pages.length - 1, idx));
  }

  function getAnchorIndex() {
    if (Number.isInteger(app.activePageIndex)) return clampIndex(app.activePageIndex);
    if (Number.isInteger(state.caret?.page)) return clampIndex(state.caret.page);
    return clampIndex(lastScrollFocusIndex);
  }

  function limitWindowForHighZoom(i0, i1) {
    const zoom = state.zoom || 1;
    if (zoom < 2 || !state.pages.length) return [i0, i1];
    const maxPad = zoom >= 3 ? 0 : 1;
    const maxSpan = Math.max(0, maxPad * 2);
    if ((i1 - i0) <= maxSpan) return [i0, i1];
    const last = state.pages.length - 1;
    let anchor = clamp(getAnchorIndex(), i0, i1);
    if (!Number.isInteger(anchor)) anchor = clampIndex(i0);
    const anchorBase = anchor;
    let start = anchor;
    let end = anchor;
    while ((end - start) < maxSpan) {
      const canExpandLeft = start > i0;
      const canExpandRight = end < i1;
      if (!canExpandLeft && !canExpandRight) break;
      if (canExpandLeft && canExpandRight) {
        const leftGap = anchorBase - start;
        const rightGap = end - anchorBase;
        if (rightGap <= leftGap) {
          end++;
        } else {
          start--;
        }
      } else if (canExpandRight) {
        end++;
      } else if (canExpandLeft) {
        start--;
      }
      if ((end - start) >= maxSpan) break;
    }
    start = Math.max(0, Math.min(start, last));
    end = Math.max(start, Math.min(end, last));
    return [start, end];
  }

  function applyActiveWindow(i0, i1) {
    if (!state.pages.length) return;
    const last = state.pages.length - 1;
    const start = Math.max(0, Math.min(i0, i1));
    const end = Math.max(start, Math.min(last, Math.max(i0, i1)));
    for (let i = 0; i < state.pages.length; i++) {
      setPageActive(state.pages[i], i >= start && i <= end);
    }
  }

  function getForcedZoomWindow() {
    if (!state.pages.length) return null;
    const zoom = state.zoom || 1;
    if (zoom < 2) return null;
    const pad = zoom >= 3 ? 0 : 1;
    const anchor = getAnchorIndex();
    const start = Math.max(0, Math.min(state.pages.length - 1, anchor - pad));
    const end = Math.max(start, Math.min(state.pages.length - 1, anchor + pad));
    return [start, end];
  }

  function setPageActive(page, active) {
    if (!page || page.active === active) return;
    page.active = active;
    if (active) {
      if (page.canvas?.style) {
        page.canvas.style.visibility = 'visible';
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
    lastScrollFocusIndex = bestIdx;
    const pad = effectiveVirtualPad();
    let i0 = Math.max(0, bestIdx - pad);
    let i1 = Math.min(state.pages.length - 1, bestIdx + pad);
    const cp = state.caret.page;
    i0 = Math.min(i0, cp);
    i1 = Math.max(i1, cp);
    return limitWindowForHighZoom(i0, i1);
  }

  function updateVirtualization() {
    if (state.pages.length === 0) return;
    const freezeVirtual = getFreezeVirtual();
    const zoom = state.zoom || 1;
    if (freezeVirtual && zoom >= 2) {
      const forced = getForcedZoomWindow();
      if (forced) {
        applyActiveWindow(forced[0], forced[1]);
        return;
      }
    }
    if (freezeVirtual) {
      for (let i = 0; i < state.pages.length; i++) setPageActive(state.pages[i], true);
      return;
    }
    const [i0, i1] = visibleWindowIndices();
    applyActiveWindow(i0, i1);
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
