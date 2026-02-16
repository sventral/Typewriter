import { preparePageCanvasForViewport } from '../rendering/pageCanvasPreparation.js';

export function createZoomRenderManager(options) {
  const {
    state,
    app,
    configureCanvasContext,
    getEffectiveRenderZoom,
    getRenderScale,
    getLayoutZoomFactor,
    schedulePaint,
    rebuildAllAtlases,
    setFreezeVirtual,
    requestVirtualization,
    requestHammerNudge,
    getZooming,
    setZooming,
    getZoomDebounceTimer,
    setZoomDebounceTimer,
    setRenderScaleForZoom,
    documentVerticalSpanPx,
    trackZoomLag,
    getVisibleWindowIndices,
  } = options;

  let pendingZoomRedrawRAF = 0;
  let pendingZoomRedrawIsTimeout = false;
  let lastAtlasRebuildScale = null;
  let lastRedrawRenderScale = null;
  const MAX_FALLBACK_ACTIVE_PRIORITY = 6;
  const SECONDARY_WINDOW_PAD = 1;
  const ATLAS_REBUILD_SCALE_DELTA_RATIO = 0.15;

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
    const seen = new Set();
    const priority = [];
    const secondary = [];
    const effectiveZoom = typeof getEffectiveRenderZoom === 'function'
      ? getEffectiveRenderZoom()
      : (state.zoom || 1);
    const renderScale = typeof getRenderScale === 'function'
      ? getRenderScale()
      : effectiveZoom;
    const layoutZoom = typeof getLayoutZoomFactor === 'function'
      ? getLayoutZoomFactor()
      : 1;
    const isScaleDownshift = Number.isFinite(lastRedrawRenderScale)
      && renderScale < (lastRedrawRenderScale - 1e-3);

    const resolveVisibleWindowRange = () => {
      if (!Array.isArray(state.pages) || state.pages.length === 0) return null;
      if (typeof getVisibleWindowIndices !== 'function') return null;
      try {
        const range = getVisibleWindowIndices();
        if (!Array.isArray(range) || range.length === 0) return null;
        const lastIndex = state.pages.length ? state.pages.length - 1 : 0;
        const rawStart = Number.isFinite(range[0]) ? range[0] : range[1];
        const rawEnd = Number.isFinite(range[1]) ? range[1] : rawStart;
        if (!Number.isFinite(rawStart) && !Number.isFinite(rawEnd)) return null;
        const start = Number.isFinite(rawStart) ? rawStart : rawEnd;
        const end = Number.isFinite(rawEnd) ? rawEnd : start;
        const clampedStart = Math.min(Math.max(Math.round(start), 0), lastIndex);
        const clampedEnd = Math.min(Math.max(Math.round(end), clampedStart), lastIndex);
        if (clampedEnd < clampedStart) return null;
        const indexSet = new Set();
        for (let i = clampedStart; i <= clampedEnd; i += 1) {
          indexSet.add(i);
        }
        if (!indexSet.size) return null;
        return { start: clampedStart, end: clampedEnd, set: indexSet, lastIndex };
      } catch (err) {
        return null;
      }
    };

    const windowInfo = resolveVisibleWindowRange();

    const enqueue = (page, target) => {
      if (!page || seen.has(page)) return;
      seen.add(page);
      target.push(page);
    };

    const activeIndex = Number.isInteger(app.activePageIndex) ? app.activePageIndex : null;
    if (activeIndex != null) enqueue(state.pages[activeIndex], priority);

    const caretIndex = Number.isInteger(state.caret?.page) ? state.caret.page : null;
    if (caretIndex != null) enqueue(state.pages[caretIndex], priority);

    if (!isScaleDownshift && windowInfo?.set?.size) {
      windowInfo.set.forEach((idx) => {
        const page = state.pages[idx];
        enqueue(page, priority);
      });
      const paddedStart = Math.max(0, windowInfo.start - SECONDARY_WINDOW_PAD);
      const paddedEnd = Math.min(windowInfo.lastIndex ?? windowInfo.end, windowInfo.end + SECONDARY_WINDOW_PAD);
      for (let i = paddedStart; i <= paddedEnd; i += 1) {
        const page = state.pages[i];
        enqueue(page, secondary);
      }
    } else {
      let remaining = Math.min(
        MAX_FALLBACK_ACTIVE_PRIORITY,
        Number.isInteger(state.pages.length) ? state.pages.length : MAX_FALLBACK_ACTIVE_PRIORITY,
      );
      for (const page of state.pages) {
        if (!page?.active) continue;
        enqueue(page, priority);
        remaining -= 1;
        if (remaining <= 0) break;
      }
    }

    if (!priority.length && secondary.length) {
      priority.push(secondary.shift());
    }
    if (!priority.length && state.pages.length) {
      priority.push(state.pages[0]);
    }

    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? () => performance.now()
        : () => Date.now();

    let anyRedrawRequested = false;
    const prepPage = (page) => {
      if (!page) return;
      const prep = preparePageCanvasForViewport({
        page,
        app,
        renderScale,
        layoutZoom,
        configureCanvasContext,
        preserveMainBitmap: page.active === true,
      });
      page.zoomPreparedFor = effectiveZoom;
      const deferImmediateFullRepaint = page.active === true && prep.renderScaleDecreased;
      if (prep.needsRedraw && !deferImmediateFullRepaint) {
        page.preserveFrontBufferForFullPaint = true;
        page.dirtyAll = true;
        anyRedrawRequested = true;
      }
      if (page.active) {
        const hasPendingRows = page._dirtyRowMinMu !== undefined || page._dirtyRowMaxMu !== undefined;
        if (page.dirtyAll || hasPendingRows) {
          schedulePaint(page);
        }
      }
    };

    for (const page of priority) prepPage(page);
    const deferredQueue = isScaleDownshift ? [] : secondary.slice();
    const shouldTrackLagForRedraw =
      !isScaleDownshift
      || anyRedrawRequested
      || deferredQueue.length > 0;
    if (typeof trackZoomLag === 'function' && shouldTrackLagForRedraw) {
      trackZoomLag({ zoom: state.zoom, delta: 0, reason: 'zoom-redraw' });
    }
    const scaleDeltaForAtlasRebuild =
      !Number.isFinite(lastAtlasRebuildScale)
      || Math.abs(renderScale - lastAtlasRebuildScale)
        / Math.max(lastAtlasRebuildScale, 0.1) >= ATLAS_REBUILD_SCALE_DELTA_RATIO;
    const shouldRebuildAtlases =
      anyRedrawRequested
      && state.lowResZoomEnabled === false
      && scaleDeltaForAtlasRebuild;
    if (shouldRebuildAtlases) {
      rebuildAllAtlases();
      lastAtlasRebuildScale = renderScale;
    }
    lastRedrawRenderScale = renderScale;

    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      setFreezeVirtual(false);
      requestVirtualization();
      requestHammerNudge();
    };

    finalize();

    if (!deferredQueue.length) {
      return;
    }

    let index = 0;

    const processBatch = () => {
      const start = now();
      const budgetMs = 7;
      while (index < deferredQueue.length) {
        const page = deferredQueue[index++];
        prepPage(page);
        if (now() - start >= budgetMs) break;
      }

      if (index < deferredQueue.length) {
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
