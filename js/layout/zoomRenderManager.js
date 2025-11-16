export function createZoomRenderManager(options) {
  const {
    state,
    app,
    prepareCanvas,
    configureCanvasContext,
    getEffectiveRenderZoom,
    schedulePaint,
    rebuildAllAtlases,
    setFreezeVirtual,
    requestVirtualization,
    requestHammerNudge,
    isSafari,
    syncSafariZoomLayout,
    stageLayoutSetSafariZoomMode,
    getZooming,
    setZooming,
    getZoomDebounceTimer,
    setZoomDebounceTimer,
    setRenderScaleForZoom,
    documentVerticalSpanPx,
    trackZoomLag,
  } = options;

  let pendingZoomRedrawRAF = 0;
  let pendingZoomRedrawIsTimeout = false;

  function clearPendingZoomRedrawFrame() {
    if (!pendingZoomRedrawRAF) return;
    if (pendingZoomRedrawIsTimeout) {
      clearTimeout(pendingZoomRedrawRAF);
    } else if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(pendingZoomRedrawRAF);
    }
    pendingZoomRedrawRAF = 0;
    pendingZoomRedrawIsTimeout = false;
  }

  function scheduleZoomRedrawFrame(callback) {
    if (typeof requestAnimationFrame === 'function') {
      pendingZoomRedrawIsTimeout = false;
      pendingZoomRedrawRAF = requestAnimationFrame((timestamp) => {
        pendingZoomRedrawRAF = 0;
        pendingZoomRedrawIsTimeout = false;
        callback(timestamp);
      });
    } else {
      pendingZoomRedrawIsTimeout = true;
      pendingZoomRedrawRAF = setTimeout(() => {
        pendingZoomRedrawRAF = 0;
        pendingZoomRedrawIsTimeout = false;
        callback(Date.now());
      }, 16);
    }
  }

  function runBatchedZoomRedraw() {
    if (typeof trackZoomLag === 'function') {
      trackZoomLag({ zoom: state.zoom, delta: 0, reason: 'zoom-redraw' });
    }
    const seen = new Set();
    const priority = [];
    const rest = [];

    const enqueue = (page, target) => {
      if (!page || seen.has(page)) return;
      seen.add(page);
      target.push(page);
    };

    const activeIndex = Number.isInteger(app.activePageIndex) ? app.activePageIndex : null;
    if (activeIndex != null) enqueue(state.pages[activeIndex], priority);

    const caretIndex = Number.isInteger(state.caret?.page) ? state.caret.page : null;
    if (caretIndex != null) enqueue(state.pages[caretIndex], priority);

    for (const page of state.pages) {
      if (page?.active) enqueue(page, priority);
    }

    for (const page of state.pages) enqueue(page, rest);

    if (!priority.length && rest.length) {
      priority.push(rest.shift());
    }

    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? () => performance.now()
        : () => Date.now();

    const prepPage = (page) => {
      if (!page) return;
      if (page.canvas) prepareCanvas(page.canvas);
      if (page.backCanvas) prepareCanvas(page.backCanvas);
      if (page.ctx) configureCanvasContext(page.ctx);
      if (page.backCtx) configureCanvasContext(page.backCtx);
      const effectiveZoom = typeof getEffectiveRenderZoom === 'function'
        ? getEffectiveRenderZoom()
        : (state.zoom || 1);
      page.zoomPreparedFor = effectiveZoom;
      page.dirtyAll = true;
      if (page.active) schedulePaint(page);
    };

    for (const page of priority) prepPage(page);

    rebuildAllAtlases();

    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      setFreezeVirtual(false);
      requestVirtualization();
      requestHammerNudge();
      if (isSafari) syncSafariZoomLayout(true);
    };

    finalize();

    if (!rest.length) {
      return;
    }

    let index = 0;

    const processBatch = () => {
      const start = now();
      const budgetMs = 7;
      while (index < rest.length) {
        const page = rest[index++];
        prepPage(page);
        if (now() - start >= budgetMs) break;
      }

      if (index < rest.length) {
        scheduleZoomRedrawFrame(processBatch);
      }
    };

    scheduleZoomRedrawFrame(processBatch);
  }

  function zoomRedrawDebounceDelay() {
    const BASE_DELAY_MS = 160;
    const MIN_DELAY_MS = 60;
    const pageCount = Array.isArray(state.pages) ? state.pages.length : 0;
    if (!pageCount) return BASE_DELAY_MS;
    const docSpan = documentVerticalSpanPx();
    const approxPages = Number.isFinite(docSpan) && docSpan > 0 ? docSpan / app.PAGE_H : pageCount;
    const reduction = Math.min(90, Math.max(0, (approxPages - 1) * 12));
    const adjusted = BASE_DELAY_MS - reduction;
    return adjusted > MIN_DELAY_MS ? adjusted : MIN_DELAY_MS;
  }

  function scheduleZoomCrispRedraw() {
    const existing = getZoomDebounceTimer();
    if (existing) clearTimeout(existing);
    clearPendingZoomRedrawFrame();
    const debounceDelay = zoomRedrawDebounceDelay();
    const timer = setTimeout(() => {
      setZoomDebounceTimer(null);
      if (getZooming()) {
        scheduleZoomCrispRedraw();
        return;
      }
      setZooming(false);
      requestHammerNudge();
      setRenderScaleForZoom();
      if (isSafari) stageLayoutSetSafariZoomMode('steady', { force: true });
      runBatchedZoomRedraw();
    }, debounceDelay);
    setZoomDebounceTimer(timer);
  }

  return {
    clearPendingZoomRedrawFrame,
    scheduleZoomRedrawFrame,
    runBatchedZoomRedraw,
    scheduleZoomCrispRedraw,
  };
}
