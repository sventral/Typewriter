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
      zoomPreparedFor: state.zoom || 1,
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
  let prevScrollFocusIndex = 0;
  let lastScrollDirection = 0;
  let lastPaperOffsetY = 0;

  function effectiveVirtualPad() {
    return state.zoom >= 3 ? 0 : 1;
  }

  function clampIndex(idx) {
    if (!Number.isInteger(idx)) return 0;
    if (!state.pages.length) return 0;
    return Math.max(0, Math.min(state.pages.length - 1, idx));
  }

  function ensurePagePreparedForCurrentZoom(page) {
    if (!page) return;
    const currentZoom = state.zoom || 1;
    if (page.zoomPreparedFor === currentZoom) return;
    if (page.canvas) prepareCanvas(page.canvas);
    if (page.backCanvas) prepareCanvas(page.backCanvas);
    if (page.ctx) configureCanvasContext(page.ctx);
    if (page.backCtx) configureCanvasContext(page.backCtx);
    page.zoomPreparedFor = currentZoom;
    page.dirtyAll = true;
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

  function setPageActive(page, active) {
    if (!page || page.active === active) return;
    page.active = active;
    if (active) {
      if (page.canvas?.style) {
        page.canvas.style.visibility = 'visible';
      }
      ensurePagePreparedForCurrentZoom(page);
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
    if (!state.pages.length) return [0, 0];
    const sp = app.stage.getBoundingClientRect();
    const viewTop = sp.top;
    const viewBottom = sp.bottom;
    const rawViewHeight = viewBottom - viewTop;
    const viewportHeight = (typeof window !== 'undefined' && Number.isFinite(window.innerHeight))
      ? window.innerHeight
      : rawViewHeight;
    let padBase = Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : rawViewHeight;
    if (!Number.isFinite(padBase) || padBase <= 0) {
      padBase = Number.isFinite(app.PAGE_H) ? app.PAGE_H : 0;
    }
    const viewPadding = Math.max(48, padBase * 0.15);
    const paddedTop = viewTop - viewPadding;
    const paddedBottom = viewBottom + viewPadding;
    const scrollCenterY = (viewTop + viewBottom) / 2;
    const currentOffsetY = Number.isFinite(state.paperOffset?.y) ? state.paperOffset.y : 0;
    const deltaOffset = currentOffsetY - lastPaperOffsetY;
    if (Math.abs(deltaOffset) > 0.1) {
      lastScrollDirection = deltaOffset > 0 ? 1 : -1;
    }
    lastPaperOffsetY = currentOffsetY;

    let bestIdx = clampIndex(lastScrollFocusIndex);
    let bestDist = Infinity;
    const visibleCandidates = [];
    const overlapByIndex = new Map();

    for (let i = 0; i < state.pages.length; i++) {
      const page = state.pages[i];
      if (!page?.wrapEl) continue;
      const r = page.wrapEl.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2;
      const d = Math.abs(mid - scrollCenterY);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
      const overlap = Math.max(0, Math.min(r.bottom, paddedBottom) - Math.max(r.top, paddedTop));
      if (overlap > 0) {
        visibleCandidates.push({ index: i, overlap });
        overlapByIndex.set(i, overlap);
      }
    }

    const zoom = state.zoom || 1;
    const lastIndex = state.pages.length - 1;

    if (zoom >= 2 && visibleCandidates.length) {
      let targetIdx;
      if (lastScrollDirection < 0) {
        targetIdx = visibleCandidates[0].index;
      } else if (lastScrollDirection > 0) {
        targetIdx = visibleCandidates[visibleCandidates.length - 1].index;
      } else {
        let maxCandidate = visibleCandidates[0];
        for (let j = 1; j < visibleCandidates.length; j++) {
          if (visibleCandidates[j].overlap > maxCandidate.overlap) {
            maxCandidate = visibleCandidates[j];
          }
        }
        targetIdx = maxCandidate.index;
      }
      targetIdx = clampIndex(targetIdx);
      const allowedCount = zoom >= 3 ? 1 : 2;
      let start = targetIdx;
      let end = targetIdx;
      if (allowedCount === 2) {
        if (lastScrollDirection < 0) {
          start = Math.max(0, targetIdx - 1);
          end = targetIdx;
          if (start === end && targetIdx < lastIndex) {
            end = Math.min(lastIndex, targetIdx + 1);
          }
        } else if (lastScrollDirection > 0) {
          end = Math.min(lastIndex, targetIdx + 1);
          start = targetIdx;
          if (start === end && targetIdx > 0) {
            start = Math.max(0, targetIdx - 1);
          }
        } else {
          const prev = Math.max(0, targetIdx - 1);
          const next = Math.min(lastIndex, targetIdx + 1);
          const prevOverlap = overlapByIndex.get(prev) || 0;
          const nextOverlap = overlapByIndex.get(next) || 0;
          if (nextOverlap >= prevOverlap) {
            end = next;
            start = Math.max(0, end - 1);
          } else {
            start = prev;
            end = Math.min(lastIndex, start + 1);
          }
        }
      }
      start = Math.max(0, Math.min(start, end));
      end = Math.max(start, Math.min(end, lastIndex));
      prevScrollFocusIndex = lastScrollFocusIndex;
      lastScrollFocusIndex = targetIdx;
      if (lastScrollDirection > 0 && end < lastIndex) {
        end = Math.min(lastIndex, end + 1);
      } else if (lastScrollDirection < 0 && start > 0) {
        start = Math.max(0, start - 1);
      }
      return [start, end];
    }

    const pad = effectiveVirtualPad();
    let i0 = Math.max(0, bestIdx - pad);
    let i1 = Math.min(lastIndex, bestIdx + pad);
    if (visibleCandidates.length) {
      i0 = Math.min(i0, visibleCandidates[0].index);
      i1 = Math.max(i1, visibleCandidates[visibleCandidates.length - 1].index);
    }
    const caretPage = Number.isInteger(state.caret?.page) ? clampIndex(state.caret.page) : bestIdx;
    i0 = Math.min(i0, caretPage);
    i1 = Math.max(i1, caretPage);
    prevScrollFocusIndex = lastScrollFocusIndex;
    lastScrollFocusIndex = bestIdx;
    if (bestIdx !== prevScrollFocusIndex) {
      lastScrollDirection = Math.sign(bestIdx - prevScrollFocusIndex) || lastScrollDirection;
    }
    if (lastScrollDirection > 0 && i1 < lastIndex) {
      i1 = Math.min(lastIndex, i1 + 1);
    } else if (lastScrollDirection < 0 && i0 > 0) {
      i0 = Math.max(0, i0 - 1);
    }
    return [i0, i1];
  }

  function updateVirtualization() {
    if (state.pages.length === 0) return;
    const freezeVirtual = getFreezeVirtual();
    const zoom = state.zoom || 1;
    if (freezeVirtual && zoom < 2) {
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
