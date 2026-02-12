import { clamp } from '../utils/math.js';
import { computeLineStepPx, normalizeTopMarginPx } from '../utils/marginSnap.js';
import { markDocumentDirty } from '../state/saveRevision.js';
import { createZoomRenderManager } from './zoomRenderManager.js';
import { createZoomUiController } from './zoomUiController.js';
import { createZoomLagMonitor } from '../diagnostics/zoomLagMonitor.js';
import { createWheelAxisStabilizer } from './wheelAxisStabilizer.js';
import { BASE_PADDING_X_PX, BASE_PADDING_Y_PX } from './stageLayout.js';
import { createZoomSliderContrastManager } from './zoomSliderContrast.js';
import { isSafari } from '../utils/platform.js';
import { createRulerCanvasRenderer } from './rulerCanvasRenderer.js';

export function createLayoutAndZoomController(context, pageLifecycle, editingController) {
  const {
    app,
    state,
    DPR,
    getCharWidth,
    getGridHeight,
    getAsc,
    getDesc,
    getLineStepMu,
    layoutController,
    requestVirtualization,
    saveStateDebounced,
    setRenderScaleForZoom,
    getEffectiveRenderZoom,
    getRenderScale,
    configureCanvasContext,
    schedulePaint,
    rebuildAllAtlases,
    setFreezeVirtual,
    getZooming,
    setZooming,
    getZoomDebounceTimer,
    setZoomDebounceTimer,
    getDrag,
    setDrag,
    getPaperWidthMm = () => 210,
    getPaperHeightMm = () => 297,
  } = context;

  const {
    layoutZoomFactor,
    cssScaleFactor,
    stageDimensions,
    toolbarHeightPx,
    updateZoomWrapTransform,
    sanitizeStageInput,
  } = layoutController;

  const { clampCaretToBounds } = editingController;
  const { visibleWindowIndices } = pageLifecycle || {};
  const getVisibleWindowIndices = typeof visibleWindowIndices === 'function' ? visibleWindowIndices : null;

  let lastLagPhase = 'idle';

  const syncLagAssistState = (phaseInput) => {
    if (state.pdfExportActive) {
      const overlay = app.lagOverlay;
      if (overlay) {
        overlay.classList.add('lag-overlay--visible');
        overlay.setAttribute('aria-hidden', 'false');
        if (!overlay.dataset.phase || overlay.dataset.phase === 'idle') {
          overlay.dataset.phase = 'export';
        }
      }
      const notice = app.lagNotice;
      if (notice) {
        notice.classList.add('lag-notice--visible');
        notice.setAttribute('aria-hidden', 'false');
      }
      return;
    }
    const hasExplicitPhase = typeof phaseInput === 'string' && phaseInput.length > 0;
    const phase = hasExplicitPhase ? phaseInput : (lastLagPhase || 'idle');
    if (hasExplicitPhase) {
      lastLagPhase = phaseInput;
    }
    const lagAssistEnabled = state.lagAssistEnabled !== false;
    const overlayActive = phase === 'pending' || phase === 'lag';
    const shouldBlockInput = phase === 'lag';
    state.lagInputBlocked = lagAssistEnabled && shouldBlockInput;

    const overlay = app.lagOverlay;
    if (overlay) {
      overlay.classList.toggle('lag-overlay--visible', lagAssistEnabled && overlayActive);
      overlay.setAttribute('aria-hidden', lagAssistEnabled && overlayActive ? 'false' : 'true');
      overlay.dataset.phase = lagAssistEnabled && overlayActive ? (phase || 'lag') : 'idle';
    }

    const notice = app.lagNotice;
    if (notice) {
      notice.classList.toggle('lag-notice--visible', lagAssistEnabled && overlayActive);
      notice.setAttribute('aria-hidden', lagAssistEnabled && overlayActive ? 'false' : 'true');
    }
  };

  const zoomLagMonitor = createZoomLagMonitor({
    app,
    isLagAssistEnabled: () => state.lagAssistEnabled !== false,
    onLagStateChange: (phase) => {
      syncLagAssistState(phase);
    },
  });

  const refreshLagAssistState = () => {
    syncLagAssistState();
    if (zoomLagMonitor?.syncEnabledState) {
      zoomLagMonitor.syncEnabledState();
    }
  };
  // Skip the very first automatic redraw monitor (startup) to avoid showing
  // the spinner while the app is already responsive. After that, allow redraws
  // or any real zoom change to arm the monitor.
  let hasMeaningfulZoomChange = false;
  let suppressedInitialRedraw = true;
  const trackZoomLag = (payload = {}) => {
    if (!zoomLagMonitor || typeof zoomLagMonitor.trackZoomEvent !== 'function') return;

    const reason = payload?.reason;
    const deltaAbs = Number.isFinite(payload?.delta) ? Math.abs(payload.delta) : 0;

    if (reason === 'zoom-redraw' && !hasMeaningfulZoomChange) {
      if (suppressedInitialRedraw) {
        suppressedInitialRedraw = false;
        return;
      }
    }

    if (reason !== 'zoom-redraw' && deltaAbs > 0.0001) {
      hasMeaningfulZoomChange = true;
    }

    zoomLagMonitor.trackZoomEvent(payload);
  };
  let pendingZoomLagEvent = null;

  const isSafariLayoutZoom = () => isSafari() && state.lowResZoomEnabled === false;

  const previewCanvasCssScale = () => {
    if (!isSafariLayoutZoom()) return;
    const layoutZoom = layoutZoomFactor();
    const cssW = app.PAGE_W * layoutZoom;
    const cssH = app.PAGE_H * layoutZoom;
    for (const page of state.pages) {
      if (!page?.canvas) continue;
      page.canvas.style.width = `${cssW}px`;
      page.canvas.style.height = `${cssH}px`;
      if (page.pageEl?.style) {
        page.pageEl.style.height = `${cssH}px`;
      }
    }
  };

  const flushPendingZoomLagEvent = (reason) => {
    if (pendingZoomLagEvent) {
      const payload = reason ? { ...pendingZoomLagEvent, reason } : pendingZoomLagEvent;
      trackZoomLag(payload);
      pendingZoomLagEvent = null;
      return;
    }
    if (reason) {
      trackZoomLag({ zoom: state.zoom, delta: 0, reason });
    }
  };

  let hammerNudgeRAF = 0;
  let pendingRulerRAF1 = 0;
  let pendingRulerRAF2 = 0;
  let lastRulerSnapshot = null;
  let cachedRulerHostSize = { width: 0, height: 0 };
  let rulerStopHandles = null;
  const MIN_PAPER_OFFSET_DELTA_PX = 1 / 8;
  const initialPaperOffset = state.paperOffset || { x: 0, y: 0 };
  let lastSnappedPaperOffset = {
    x: Number.isFinite(initialPaperOffset.x) ? initialPaperOffset.x : 0,
    y: Number.isFinite(initialPaperOffset.y) ? initialPaperOffset.y : 0,
  };
  let pendingPaperOffsetWorkRAF = 0;
  const lastMarginInsets = { top: null, right: null, bottom: null, left: null };
  let lastPageHeightPx = '';
  const wheelAxisStabilizer = createWheelAxisStabilizer({
    dominanceRatio: 1.15,
    minorFloor: 0.35,
    crossAxisSuppression: 0.95,
    snapResponsiveness: 0.65,
    releaseDecay: 0.1,
    idleDecay: 0.05,
  });
  const zoomSliderContrast = createZoomSliderContrastManager({ app });
  const scheduleZoomSliderContrastUpdate = () => {
    if (zoomSliderContrast && typeof zoomSliderContrast.scheduleUpdate === 'function') {
      zoomSliderContrast.scheduleUpdate();
    }
  };
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('zoom-contrast-update', scheduleZoomSliderContrastUpdate, { passive: true });
    window.addEventListener('transitionend', scheduleZoomSliderContrastUpdate, { passive: true });
  }
  const hasElementApi = typeof Element !== 'undefined';
  const SCROLLBAR_VISIBILITY_EPSILON = 4;
  let suppressScrollLaneEvent = false;
  let lastScrollLaneContent = 0;
  let lastScrollLaneViewport = 0;
  let lastScrollLaneRange = 0;
  let lastScrollLaneVisible = false;
  const rulerCanvasRenderer = createRulerCanvasRenderer({
    app,
    getPaperWidthMm,
    getPaperHeightMm,
  });

  function scrollLaneElements() {
    return {
      lane: hasElementApi && app.scrollLane instanceof Element ? app.scrollLane : null,
      inner: hasElementApi && app.scrollLaneInner instanceof Element ? app.scrollLaneInner : null,
    };
  }

  function updateRulerHostDimensions(stageW, stageH) {
    if (!app.rulerH_host || !app.rulerV_host) return;
    const scale = cssScaleFactor();
    const scaledW = stageW * scale;
    const scaledH = stageH * scale;
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : scaledW;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : scaledH;
    const rulerW = Math.max(scaledW, viewportW);
    const rulerH = Math.max(scaledH, viewportH);
    app.rulerH_host.style.width = `${rulerW}px`;
    app.rulerV_host.style.height = `${rulerH}px`;
  }

  function documentHorizontalSpanPx() {
    if (!state.pages || !state.pages.length) return app.PAGE_W;
    const first = state.pages[0];
    if (!first || !first.wrapEl) return app.PAGE_W;
    const width = first.wrapEl.offsetWidth;
    return Number.isFinite(width) && width > 0 ? width : app.PAGE_W;
  }

  function documentVerticalSpanPx() {
    if (!state.pages || !state.pages.length) return app.PAGE_H;
    const first = state.pages[0];
    const last = state.pages[state.pages.length - 1];
    if (!first?.wrapEl || !last?.wrapEl) return app.PAGE_H;
    const top = first.wrapEl.offsetTop;
    const bottom = last.wrapEl.offsetTop + last.wrapEl.offsetHeight;
    const span = bottom - top;
    return Number.isFinite(span) && span > 0 ? span : app.PAGE_H;
  }

  function hammerAllowanceX() {
    const span = documentHorizontalSpanPx();
    const allowance = Number.isFinite(span) && span > 0 ? span / 2 : app.PAGE_W / 2;
    return allowance;
  }

  function computeStagePadding(dims) {
    const zoomDivisor = state.zoom || 1;
    const scale = cssScaleFactor() || 1;
    const padX = dims && Number.isFinite(dims.extraX) ? dims.extraX / zoomDivisor : BASE_PADDING_X_PX;
    const padY = dims && Number.isFinite(dims.extraY) ? dims.extraY / zoomDivisor : BASE_PADDING_Y_PX;
    const bottomPad = padY + toolbarHeightPx() / scale;
    return {
      left: padX,
      right: padX,
      top: padY,
      bottom: bottomPad,
    };
  }

  function computePaperOffsetLimits() {
    const dims = stageDimensions();
    const pads = computeStagePadding(dims);
    const hammerX = hammerAllowanceX();
    const minX = -hammerX;
    const maxX = hammerX;

    const cssScale = cssScaleFactor() || 1;
    const safeScale = Math.abs(cssScale) < 1e-6 ? 1 : cssScale;
    const viewportH = (typeof window !== 'undefined' ? window.innerHeight : dims.height) / safeScale;
    const center = viewportH / 2;
    const docHeight = documentVerticalSpanPx();
    const totalContentH = docHeight + pads.top + pads.bottom;
    const limitTop = center - pads.top;
    const limitBottom = center - totalContentH;

    return {
      minX,
      maxX,
      minY: Math.min(limitBottom, limitTop),
      maxY: Math.max(limitBottom, limitTop),
      pads,
      docHeight,
      totalContentH,
      viewportH,
    };
  }

  function clampPaperOffset(x, y, limits = null) {
    const bounds = limits || computePaperOffsetLimits();
    return {
      x: clamp(x, bounds.minX, bounds.maxX),
      y: clamp(y, bounds.minY, bounds.maxY),
    };
  }

  function scrollLaneHasOverflow(metrics) {
    if (!metrics) return false;
    return metrics.totalContentH - metrics.viewportH > SCROLLBAR_VISIBILITY_EPSILON;
  }

  function updateScrollLaneMetrics(limits, { force = false } = {}) {
    const { lane, inner } = scrollLaneElements();
    if (!lane || !inner) return limits;
    const metrics = limits || computePaperOffsetLimits();
    const content = metrics.totalContentH;
    const viewport = metrics.viewportH;
    const range = Math.max(0, metrics.maxY - metrics.minY);
    const hasOverflow = scrollLaneHasOverflow(metrics);
    const needsUpdate = force
      || Math.abs(content - lastScrollLaneContent) > 0.5
      || Math.abs(viewport - lastScrollLaneViewport) > 0.5
      || Math.abs(range - lastScrollLaneRange) > 0.5
      || hasOverflow !== lastScrollLaneVisible;

    if (!needsUpdate) return metrics;

    lastScrollLaneContent = content;
    lastScrollLaneViewport = viewport;
    lastScrollLaneRange = range;
    lastScrollLaneVisible = hasOverflow;

    const extent = lane.clientHeight || lane.offsetHeight || viewport || 0;
    const effectiveRange = hasOverflow ? range : 0;
    const innerHeight = Math.max(1, extent + effectiveRange);
    inner.style.height = `${innerHeight}px`;
    lane.classList.toggle('stage-scroll-lane--hidden', !hasOverflow);
    lane.setAttribute('aria-hidden', hasOverflow ? 'false' : 'true');
    if (!hasOverflow) {
      suppressScrollLaneEvent = true;
      lane.scrollTop = 0;
      suppressScrollLaneEvent = false;
    }
    return metrics;
  }

  function syncScrollLaneFromPaper(limits) {
    const { lane } = scrollLaneElements();
    if (!lane) return;
    const metrics = limits || computePaperOffsetLimits();
    if (!scrollLaneHasOverflow(metrics)) return;
    const trackRange = lane.scrollHeight - lane.clientHeight;
    if (trackRange <= 0.5) return;
    const motionRange = Math.max(1e-3, metrics.maxY - metrics.minY);
    const ratio = clamp((metrics.maxY - state.paperOffset.y) / motionRange, 0, 1);
    const target = ratio * trackRange;
    if (Math.abs(target - lane.scrollTop) < 0.25) return;
    suppressScrollLaneEvent = true;
    lane.scrollTop = target;
    suppressScrollLaneEvent = false;
  }

  function updateStageEnvironment() {
    const dims = stageDimensions();
    const rootStyle = document.documentElement.style;
    const layoutZoom = layoutZoomFactor();
    const pads = computeStagePadding(dims);

    rootStyle.setProperty('--page-w', (app.PAGE_W * layoutZoom).toString());
    rootStyle.setProperty('--stage-width-mult', dims.widthFactor.toString());
    rootStyle.setProperty('--stage-height-mult', dims.heightFactor.toString());

    const adjustedWidth = dims.pageW + pads.left * 2;
    const adjustedHeight = dims.pageH + pads.top * 2;

    if (app.zoomWrap) {
      app.zoomWrap.style.width = `${adjustedWidth}px`;
      app.zoomWrap.style.minHeight = `${adjustedHeight}px`;
      app.zoomWrap.style.height = '';
    }
    
    if (app.stageInner) {
      app.stageInner.style.minWidth = `${adjustedWidth}px`;
      app.stageInner.style.minHeight = `${adjustedHeight}px`;
      
      app.stageInner.style.paddingLeft = `${pads.left}px`;
      app.stageInner.style.paddingRight = `${pads.right}px`;
      app.stageInner.style.paddingTop = `${pads.top}px`;
      app.stageInner.style.paddingBottom = `${pads.bottom}px`;
    }

    updateRulerHostDimensions(adjustedWidth, adjustedHeight);
    setPaperOffset(state.paperOffset.x, state.paperOffset.y);
    scheduleZoomSliderContrastUpdate();
  }

  function setPaperOffset(x, y, options = {}) {
    const limits = computePaperOffsetLimits();
    const clamped = clampPaperOffset(x, y, limits);
    const scale = cssScaleFactor();
    const snap = (v) => Math.round(v * DPR) / DPR;
    const snappedX = scale ? snap(clamped.x * scale) / scale : clamped.x;
    const snappedY = scale ? snap(clamped.y * scale) / scale : clamped.y;
    state.paperOffset.x = snappedX;
    state.paperOffset.y = snappedY;
    const prevX = Number.isFinite(lastSnappedPaperOffset.x) ? lastSnappedPaperOffset.x : snappedX;
    const prevY = Number.isFinite(lastSnappedPaperOffset.y) ? lastSnappedPaperOffset.y : snappedY;
    const movedX = Math.abs(snappedX - prevX);
    const movedY = Math.abs(snappedY - prevY);
    if (movedX < MIN_PAPER_OFFSET_DELTA_PX && movedY < MIN_PAPER_OFFSET_DELTA_PX) {
      return;
    }
    lastSnappedPaperOffset = { x: snappedX, y: snappedY };
    if (app.stageInner) {
      const tx = Math.round(snappedX * 1000) / 1000;
      const ty = Math.round(snappedY * 1000) / 1000;
      app.stageInner.style.transform = `translate3d(${tx}px,${ty}px,0)`;
    }
    schedulePostPaperOffsetWork();
    const metrics = updateScrollLaneMetrics(limits);
    if (!options.skipScrollLaneSync) {
      syncScrollLaneFromPaper(metrics || limits);
    }
    scheduleZoomSliderContrastUpdate();
  }

  function schedulePostPaperOffsetWork() {
    if (typeof requestAnimationFrame !== 'function') {
      queueRulerRepositionAfterVisualMove();
      requestVirtualization();
      return;
    }
    if (pendingPaperOffsetWorkRAF) return;
    pendingPaperOffsetWorkRAF = requestAnimationFrame(() => {
      pendingPaperOffsetWorkRAF = 0;
      queueRulerRepositionAfterVisualMove();
      requestVirtualization();
    });
  }

  function caretViewportPos() {
    if (!app || !app.caretEl) return null;
    const rect = app.caretEl.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  function anchorPx() {
    return {
      ax: Math.round(window.innerWidth * state.caretAnchor.x),
      ay: Math.round(window.innerHeight * state.caretAnchor.y),
    };
  }

  const DEAD_X = 1.25;
  const DEAD_Y = 3.0;

  function nudgePaperToAnchor() {
    if (!state.hammerLock || getZooming()) return;
    const cv = caretViewportPos();
    if (!cv) return;
    const { ax, ay } = anchorPx();
    let dx = ax - cv.x;
    let dy = ay - cv.y;
    const pxThreshold = 1 / DPR;
    if (Math.abs(dx) < pxThreshold && Math.abs(dy) < pxThreshold) return;
    if (Math.abs(dx) < DEAD_X && Math.abs(dy) < DEAD_Y) return;
    const scale = cssScaleFactor() || 1;
    const prevX = state.paperOffset.x;
    const prevY = state.paperOffset.y;
    setPaperOffset(prevX + dx / scale, prevY + dy / scale);
    const movedX = Math.abs(state.paperOffset.x - prevX) > 1e-6;
    const movedY = Math.abs(state.paperOffset.y - prevY) > 1e-6;
    if (!movedX && !movedY) return;
    const after = caretViewportPos();
    if (!after) return;
    const errX = ax - after.x;
    const errY = ay - after.y;
    if (Math.abs(errX) >= pxThreshold || Math.abs(errY) >= pxThreshold) {
      requestHammerNudge();
    }
  }

  function reanchorCaretAfterZoomChange() {
    if (!state.hammerLock) return;
    const cv = caretViewportPos();
    if (!cv) return;
    const { ax, ay } = anchorPx();
    let dx = ax - cv.x;
    let dy = ay - cv.y;
    const pxThreshold = 1 / DPR;
    if (Math.abs(dx) < pxThreshold && Math.abs(dy) < pxThreshold) return;
    const scale = cssScaleFactor() || 1;
    if (!Number.isFinite(scale) || scale <= 0) return;
    setPaperOffset(state.paperOffset.x + dx / scale, state.paperOffset.y + dy / scale);
  }

  function requestHammerNudge() {
    if (getZooming() || !state.hammerLock) return;
    if (hammerNudgeRAF) return;
    const schedule = () => {
      hammerNudgeRAF = requestAnimationFrame(() => {
        hammerNudgeRAF = 0;
        nudgePaperToAnchor();
      });
    };
    schedule();
  }

  const zoomRenderManager = createZoomRenderManager({
    state,
    app,
    configureCanvasContext,
    getEffectiveRenderZoom,
    getRenderScale,
    getLayoutZoomFactor: layoutZoomFactor,
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
  });

  const { scheduleZoomCrispRedraw } = zoomRenderManager;

  let updateZoomUIFromState = () => {};
  let onZoomPointerDown = () => {};
  let onZoomPointerMove = () => {};
  let onZoomPointerUp = () => {};
  let setupZoomMeasurementTracking = () => {};

  function computeSnappedVisualMargins() {
    const charWidth = getCharWidth();
    const gridHeight = getGridHeight();
    const normalizedTop = normalizeTopMarginPx(state.marginTop, {
      pageHeight: app.PAGE_H,
      marginBottom: state.marginBottom,
      gridHeight,
      lineStepMu: getLineStepMu(),
      fallbackLineStepMu: state.lineStepMu,
    });
    if (Math.abs(normalizedTop - state.marginTop) > 1e-4) {
      state.marginTop = normalizedTop;
    }
    const Lcol = Math.ceil(state.marginL / charWidth);
    const Rcol = Math.floor((state.marginR - 1) / charWidth);
    const leftPx = Lcol * charWidth;
    const rightPx = (Rcol + 1) * charWidth;
    const topPx = normalizedTop;
    const bottomPx = state.marginBottom;
    const Tmu = Math.ceil((state.marginTop + getAsc()) / gridHeight);
    const Bmu = Math.floor((app.PAGE_H - state.marginBottom - getDesc()) / gridHeight);
    return { leftPx, rightPx, topPx, bottomPx, Lcol, Rcol, Tmu, Bmu };
  }

  function renderMargins() {
    const snap = computeSnappedVisualMargins();
    const layoutScale = layoutZoomFactor();
    const scaledInsets = {
      left: Math.round(snap.leftPx * layoutScale),
      right: Math.round((app.PAGE_W - snap.rightPx) * layoutScale),
      top: Math.round(snap.topPx * layoutScale),
      bottom: Math.round(snap.bottomPx * layoutScale),
    };
    const rootStyle = document?.documentElement?.style;
    if (rootStyle) {
      if (lastMarginInsets.top !== scaledInsets.top) {
        rootStyle.setProperty('--margin-top-px', `${scaledInsets.top}px`);
        lastMarginInsets.top = scaledInsets.top;
      }
      if (lastMarginInsets.right !== scaledInsets.right) {
        rootStyle.setProperty('--margin-right-px', `${scaledInsets.right}px`);
        lastMarginInsets.right = scaledInsets.right;
      }
      if (lastMarginInsets.bottom !== scaledInsets.bottom) {
        rootStyle.setProperty('--margin-bottom-px', `${scaledInsets.bottom}px`);
        lastMarginInsets.bottom = scaledInsets.bottom;
      }
      if (lastMarginInsets.left !== scaledInsets.left) {
        rootStyle.setProperty('--margin-left-px', `${scaledInsets.left}px`);
        lastMarginInsets.left = scaledInsets.left;
      }
    }
    const pageHeightPx = `${app.PAGE_H * layoutScale}px`;
    if (pageHeightPx !== lastPageHeightPx) {
      for (const p of state.pages) {
        if (p?.pageEl && p.pageEl.style.height !== pageHeightPx) {
          p.pageEl.style.height = pageHeightPx;
        }
      }
      lastPageHeightPx = pageHeightPx;
    }
  }

  function getActivePageRect() {
    const p = state.pages[app.activePageIndex ?? state.caret.page] || state.pages[0];
    const r = p.wrapEl.getBoundingClientRect();
    return new DOMRect(r.left, r.top, r.width, app.PAGE_H * state.zoom);
  }

  function snapshotRulerLayout(pageRect) {
    if (!pageRect) return;
    const cssScale = cssScaleFactor() || 1;
    const layoutZoom = layoutZoomFactor() || 1;
    const stage = app.stage;
    const scrollLeft = stage ? stage.scrollLeft : 0;
    const scrollTop = stage ? stage.scrollTop : 0;
    lastRulerSnapshot = {
      pageRect: new DOMRect(pageRect.left, pageRect.top, pageRect.width, pageRect.height),
      baseLeft: pageRect.left - state.paperOffset.x * cssScale + scrollLeft,
      baseTop: pageRect.top - state.paperOffset.y * cssScale + scrollTop,
      cssScale,
      layoutZoom,
    };
  }

  function computeManualPageRect() {
    const cssScale = cssScaleFactor() || 1;
    const layoutZoom = layoutZoomFactor() || 1;
    const width = app.PAGE_W * layoutZoom * cssScale;
    const height = app.PAGE_H * layoutZoom * cssScale;
    const stage = app.stage;
    const scrollLeft = stage ? stage.scrollLeft : 0;
    const scrollTop = stage ? stage.scrollTop : 0;
    let left;
    let top;
    if (
      lastRulerSnapshot &&
      Number.isFinite(lastRulerSnapshot.baseLeft) &&
      Number.isFinite(lastRulerSnapshot.baseTop)
    ) {
      left = lastRulerSnapshot.baseLeft + state.paperOffset.x * cssScale - scrollLeft;
      top = lastRulerSnapshot.baseTop + state.paperOffset.y * cssScale - scrollTop;
    } else {
      const viewportW = typeof window !== 'undefined' ? window.innerWidth : width;
      const viewportH = typeof window !== 'undefined' ? window.innerHeight : height;
      left = (viewportW - width) / 2 + state.paperOffset.x * cssScale - scrollLeft;
      top = (viewportH - height) / 2 + state.paperOffset.y * cssScale - scrollTop;
    }
    return new DOMRect(left, top, width, height);
  }

  function resolveRulerHostDimensions(activePageRect, { preferLiveLayout = true } = {}) {
    let hostWidth = cachedRulerHostSize.width;
    if (preferLiveLayout && app.rulerH_host) {
      const rect = app.rulerH_host.getBoundingClientRect();
      if (rect && Number.isFinite(rect.width) && rect.width > 0) {
        hostWidth = rect.width;
        cachedRulerHostSize.width = hostWidth;
      }
    }
    if (!hostWidth || !Number.isFinite(hostWidth)) {
      hostWidth = typeof window !== 'undefined' ? window.innerWidth : activePageRect.width;
    }

    let hostHeight = cachedRulerHostSize.height;
    if (preferLiveLayout && app.rulerV_host) {
      const rect = app.rulerV_host.getBoundingClientRect();
      if (rect && Number.isFinite(rect.height) && rect.height > 0) {
        hostHeight = rect.height;
        cachedRulerHostSize.height = hostHeight;
      }
    }
    if (!hostHeight || !Number.isFinite(hostHeight)) {
      hostHeight = typeof window !== 'undefined' ? window.innerHeight : activePageRect.height;
    }

    return { hostWidth, hostHeight };
  }

  function ensureRulerStopHandles() {
    if (!app.rulerH_stops_container || !app.rulerV_stops_container) return null;
    const connected = rulerStopHandles
      && rulerStopHandles.left?.isConnected
      && rulerStopHandles.right?.isConnected
      && rulerStopHandles.top?.isConnected
      && rulerStopHandles.bottom?.isConnected;
    if (connected) return rulerStopHandles;

    app.rulerH_stops_container.textContent = '';
    app.rulerV_stops_container.textContent = '';

    const left = document.createElement('div');
    left.className = 'tri left';
    app.rulerH_stops_container.appendChild(left);

    const right = document.createElement('div');
    right.className = 'tri right';
    app.rulerH_stops_container.appendChild(right);

    const top = document.createElement('div');
    top.className = 'tri-v top';
    app.rulerV_stops_container.appendChild(top);

    const bottom = document.createElement('div');
    bottom.className = 'tri-v bottom';
    app.rulerV_stops_container.appendChild(bottom);

    rulerStopHandles = { left, right, top, bottom };
    return rulerStopHandles;
  }

  function positionRulers(options = {}) {
    const preferLiveLayout = options && options.preferLiveLayout !== undefined ? options.preferLiveLayout : true;
    if (!state.showRulers) return;
    if (!app.rulerH_stops_container || !app.rulerV_stops_container) return;
    const pageRect = preferLiveLayout ? getActivePageRect() : computeManualPageRect();
    if (preferLiveLayout) {
      snapshotRulerLayout(pageRect);
    }
    const stops = ensureRulerStopHandles();
    if (!stops) return;
    const snap = computeSnappedVisualMargins();
    stops.left.style.left = `${pageRect.left + snap.leftPx * state.zoom}px`;
    stops.right.style.left = `${pageRect.left + snap.rightPx * state.zoom}px`;
    stops.top.style.top = `${pageRect.top + snap.topPx * state.zoom}px`;
    stops.bottom.style.top = `${pageRect.top + (app.PAGE_H - snap.bottomPx) * state.zoom}px`;
    const { hostWidth, hostHeight } = resolveRulerHostDimensions(pageRect, { preferLiveLayout });
    rulerCanvasRenderer.draw({
      activePageRect: pageRect,
      hostWidth,
      hostHeight,
    });
  }

  function queueRulerRepositionAfterVisualMove() {
    if (typeof requestAnimationFrame !== 'function') {
      positionRulers({ preferLiveLayout: false });
      positionRulers({ preferLiveLayout: true });
      return;
    }
    if (pendingRulerRAF1) return;
    if (pendingRulerRAF2 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(pendingRulerRAF2);
      pendingRulerRAF2 = 0;
    }
    pendingRulerRAF1 = requestAnimationFrame(() => {
      pendingRulerRAF1 = 0;
      positionRulers({ preferLiveLayout: false });
      pendingRulerRAF2 = requestAnimationFrame(() => {
        pendingRulerRAF2 = 0;
        positionRulers({ preferLiveLayout: true });
      });
    });
  }

  let lastMarginBoxesVisible = null;
  function setMarginBoxesVisible(show) {
    const shouldShow = !!(show && state.showMarginBox);
    if (shouldShow === lastMarginBoxesVisible) return;
    lastMarginBoxesVisible = shouldShow;
    for (const p of state.pages) {
      if (p?.marginBoxEl) {
        p.marginBoxEl.style.visibility = shouldShow ? 'visible' : 'hidden';
      }
    }
  }

  const snapXToGrid = (x) => {
    const charWidth = getCharWidth();
    return Math.round(x / charWidth) * charWidth;
  };

  const snapYToGrid = (y) => {
    const gridHeight = getGridHeight();
    return Math.round(y / gridHeight) * gridHeight;
  };

  function handleHorizontalMarginDrag(ev) {
    const drag = getDrag();
    if (!drag || drag.kind !== 'h') return;
    const pr = getActivePageRect();
    let x = snapXToGrid(clamp((ev.clientX - pr.left) / state.zoom, 0, app.PAGE_W));
    if (drag.side === 'left') {
      state.marginL = Math.min(x, Math.max(0, state.marginR - getCharWidth()));
    } else {
      state.marginR = Math.max(x, Math.min(app.PAGE_W, state.marginL + getCharWidth()));
    }
    app.guideV.style.left = `${pr.left + x * state.zoom}px`;
    app.guideV.style.display = 'block';
  }

  function handleVerticalMarginDrag(ev) {
    const drag = getDrag();
    if (!drag || drag.kind !== 'v') return;
    const pr = getActivePageRect();
    const pointerY = clamp((ev.clientY - pr.top) / state.zoom, 0, app.PAGE_H);
    const snappedPointerY = snapYToGrid(pointerY);
    const lineStepPx = computeLineStepPx(getGridHeight(), getLineStepMu(), state.lineStepMu);
    if (drag.side === 'top') {
      const normalizedTop = normalizeTopMarginPx(snappedPointerY, {
        pageHeight: app.PAGE_H,
        marginBottom: state.marginBottom,
        lineStepPx,
      });
      state.marginTop = normalizedTop;
      app.guideH.style.top = `${pr.top + normalizedTop * state.zoom}px`;
    } else {
      const bottomEdge = Math.max(state.marginTop + lineStepPx, snappedPointerY);
      const snappedBottomEdge = snapYToGrid(Math.min(bottomEdge, app.PAGE_H));
      state.marginBottom = Math.max(0, app.PAGE_H - snappedBottomEdge);
      app.guideH.style.top = `${pr.top + snappedBottomEdge * state.zoom}px`;
    }
    app.guideH.style.display = 'block';
  }

  function endMarginDrag() {
    const drag = getDrag();
    if (!drag) return;
    document.removeEventListener('pointermove', handleHorizontalMarginDrag);
    document.removeEventListener('pointermove', handleVerticalMarginDrag);
    document.removeEventListener('pointerup', endMarginDrag, true);
    document.removeEventListener('pointercancel', endMarginDrag, true);
    renderMargins();
    positionRulers();
    clampCaretToBounds();
    markDocumentDirty(state);
    saveStateDebounced();
    app.guideV.style.display = 'none';
    app.guideH.style.display = 'none';
    setMarginBoxesVisible(true);
    setDrag(null);
  }

  const Z_MIN = 50;
  const Z_MAX = 400;

  const detent = (p) => (Math.abs(p - 100) <= 6 ? 100 : p);

  function applyZoomCSS() {
    updateStageEnvironment();
    updateZoomWrapTransform();
    positionRulers();
    requestVirtualization();
  }

  function setZoomPercent(pct) {
    const z = detent(Math.round(Math.max(Z_MIN, Math.min(Z_MAX, pct))));
    const prevZoom = Number.isFinite(state.zoom) && state.zoom > 0 ? state.zoom : 1;
    const nextZoom = z / 100;
    const zoomDelta = Math.abs(nextZoom - prevZoom);
    const prevOffsetX = state.paperOffset.x;
    const prevOffsetY = state.paperOffset.y;
    state.zoom = nextZoom;
    const eventPayload = { zoom: nextZoom, delta: zoomDelta, reason: 'zoom-change' };
    if (getZooming()) {
      pendingZoomLagEvent = eventPayload;
    } else {
      trackZoomLag(eventPayload);
    }
    if (prevZoom > 0 && Number.isFinite(prevOffsetX) && Number.isFinite(prevOffsetY)) {
      const ratio = prevZoom / nextZoom;
      if (Number.isFinite(ratio) && Math.abs(ratio - 1) > 1e-6) {
        setPaperOffset(prevOffsetX * ratio, prevOffsetY * ratio);
      }
    }
    applyZoomCSS();
    previewCanvasCssScale();
    reanchorCaretAfterZoomChange();
    scheduleZoomCrispRedraw();
    updateZoomUIFromState();
    markDocumentDirty(state);
    saveStateDebounced();
  }

  const zoomUiController = createZoomUiController({
    app,
    state,
    setZoomPercent,
    setZooming,
    setFreezeVirtual,
    scheduleZoomCrispRedraw,
    onZoomCommit: () => flushPendingZoomLagEvent('zoom-pointer-commit'),
  });

  ({
    setupZoomMeasurementTracking,
    updateZoomUIFromState,
    onZoomPointerDown,
    onZoomPointerMove,
    onZoomPointerUp,
  } = zoomUiController);

  function handleWheelPan(e) {
    e.preventDefault();
    const { dx, dy } = wheelAxisStabilizer.filter(e.deltaX, e.deltaY);
    if (dx || dy) {
      const zoom = Number.isFinite(state.zoom) && state.zoom > 0 ? state.zoom : 1;
      setPaperOffset(state.paperOffset.x - dx / zoom, state.paperOffset.y - dy / zoom);
    }
  }

  function handleScrollLaneScroll() {
    if (suppressScrollLaneEvent) return;
    const { lane } = scrollLaneElements();
    if (!lane || !lastScrollLaneVisible) return;
    const trackRange = lane.scrollHeight - lane.clientHeight;
    if (trackRange <= 0.5) return;
    const limits = computePaperOffsetLimits();
    if (!scrollLaneHasOverflow(limits)) return;
    const ratio = clamp(lane.scrollTop / trackRange, 0, 1);
    const motionRange = Math.max(1e-3, limits.maxY - limits.minY);
    const targetY = limits.maxY - ratio * motionRange;
    setPaperOffset(state.paperOffset.x, targetY, { skipScrollLaneSync: true });
  }

  setupZoomMeasurementTracking();
  scheduleZoomSliderContrastUpdate();

  return {
    updateStageEnvironment,
    renderMargins,
    positionRulers,
    setPaperOffset,
    requestHammerNudge,
    handleWheelPan,
    handleHorizontalMarginDrag,
    handleVerticalMarginDrag,
    endMarginDrag,
    setMarginBoxesVisible,
    setZoomPercent,
    updateZoomUIFromState,
    onZoomPointerDown,
    onZoomPointerMove,
    onZoomPointerUp,
    sanitizeStageInput,
    scheduleZoomCrispRedraw,
    clampPaperOffset,
    handleScrollLaneScroll,
    refreshLagAssistState,
  };
}
