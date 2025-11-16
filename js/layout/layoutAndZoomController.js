import { clamp } from '../utils/math.js';
import { markDocumentDirty } from '../state/saveRevision.js';
import { createZoomRenderManager } from './zoomRenderManager.js';
import { createZoomUiController } from './zoomUiController.js';
import { createZoomLagMonitor } from '../diagnostics/zoomLagMonitor.js';

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
    prepareCanvas,
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
    isSafari,
    setSafariZoomMode,
    syncSafariZoomLayout,
  } = context;

  const {
    layoutZoomFactor,
    cssScaleFactor,
    stageDimensions,
    toolbarHeightPx,
    updateZoomWrapTransform,
    sanitizeStageInput,
    setSafariZoomMode: stageLayoutSetSafariZoomMode,
  } = layoutController;

  const { clampCaretToBounds } = editingController;

  const zoomLagMonitor = createZoomLagMonitor({ app });
  const trackZoomLag = (payload) => {
    if (!zoomLagMonitor || typeof zoomLagMonitor.trackZoomEvent !== 'function') return;
    zoomLagMonitor.trackZoomEvent(payload);
  };

  let hammerNudgeRAF = 0;
  let pendingRulerRAF1 = 0;
  let pendingRulerRAF2 = 0;
  let lastRulerSnapshot = null;
  let cachedRulerHostSize = { width: 0, height: 0 };
  const MIN_PAPER_OFFSET_DELTA_PX = 1 / 8;
  const initialPaperOffset = state.paperOffset || { x: 0, y: 0 };
  let lastSnappedPaperOffset = {
    x: Number.isFinite(initialPaperOffset.x) ? initialPaperOffset.x : 0,
    y: Number.isFinite(initialPaperOffset.y) ? initialPaperOffset.y : 0,
  };
  let pendingPaperOffsetWorkRAF = 0;
  const lastMarginInsets = { top: null, right: null, bottom: null, left: null };
  let lastPageHeightPx = '';

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

  function effectiveZoomScale() {
    const scale = cssScaleFactor();
    return Number.isFinite(scale) && scale > 1 ? scale : 1;
  }

  function hammerAllowanceX() {
    const span = documentHorizontalSpanPx();
    const allowance = Number.isFinite(span) && span > 0 ? span / 2 : app.PAGE_W / 2;
    return allowance * effectiveZoomScale();
  }

  function hammerAllowanceY() {
    const span = documentVerticalSpanPx();
    const allowance = Number.isFinite(span) && span > 0 ? span / 2 : app.PAGE_H / 2;
    return allowance * effectiveZoomScale();
  }

  function clampPaperOffset(x, y) {
    const { extraX, extraY } = stageDimensions();
    const hammerX = hammerAllowanceX();
    const hammerY = hammerAllowanceY();
    const minX = -(extraX + hammerX);
    const maxX = extraX + hammerX;
    const minY = -(extraY + hammerY);
    const maxY = extraY + hammerY;
    return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
  }

  function updateStageEnvironment() {
    const dims = stageDimensions();
    const rootStyle = document.documentElement.style;
    const layoutZoom = layoutZoomFactor();
    rootStyle.setProperty('--page-w', (app.PAGE_W * layoutZoom).toString());
    rootStyle.setProperty('--stage-width-mult', dims.widthFactor.toString());
    rootStyle.setProperty('--stage-height-mult', dims.heightFactor.toString());
    if (app.zoomWrap) {
      app.zoomWrap.style.width = `${dims.width}px`;
      app.zoomWrap.style.minHeight = `${dims.height}px`;
      app.zoomWrap.style.height = '';
    }
    if (app.stageInner) {
      app.stageInner.style.minWidth = `${dims.width}px`;
      app.stageInner.style.minHeight = `${dims.height}px`;
      app.stageInner.style.paddingLeft = `${dims.extraX}px`;
      app.stageInner.style.paddingRight = `${dims.extraX}px`;
      const padTop = dims.extraY;
      const padBottom = dims.extraY + toolbarHeightPx();
      app.stageInner.style.paddingTop = `${padTop}px`;
      app.stageInner.style.paddingBottom = `${padBottom}px`;
    }
    updateRulerHostDimensions(dims.width, dims.height);
    setPaperOffset(state.paperOffset.x, state.paperOffset.y);
  }

  function setPaperOffset(x, y) {
    const clamped = clampPaperOffset(x, y);
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

  function maybeApplyNativeScroll(dx, dy, threshold) {
    if (!layoutController.isSafariSteadyZoom()) return false;
    const stage = app.stage;
    if (!stage) return false;
    let used = false;
    const maxX = stage.scrollWidth - stage.clientWidth;
    const maxY = stage.scrollHeight - stage.clientHeight;
    if (Math.abs(dx) > threshold && maxX > 1) {
      const target = clamp(stage.scrollLeft - dx, 0, Math.max(0, maxX));
      if (Math.abs(target - stage.scrollLeft) > threshold) {
        stage.scrollLeft = target;
        used = true;
      }
    }
    if (Math.abs(dy) > threshold && maxY > 1) {
      const target = clamp(stage.scrollTop - dy, 0, Math.max(0, maxY));
      if (Math.abs(target - stage.scrollTop) > threshold) {
        stage.scrollTop = target;
        used = true;
      }
    }
    if (used) {
      queueRulerRepositionAfterVisualMove();
    }
    return used;
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
    const usedNative = maybeApplyNativeScroll(dx, dy, pxThreshold);
    if (usedNative) {
      const updated = caretViewportPos();
      if (updated) {
        dx = ax - updated.x;
        dy = ay - updated.y;
        if (Math.abs(dx) < pxThreshold && Math.abs(dy) < pxThreshold) return;
      }
    }
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
    const usedNative = maybeApplyNativeScroll(dx, dy, pxThreshold);
    if (usedNative) {
      const updated = caretViewportPos();
      if (updated) {
        dx = ax - updated.x;
        dy = ay - updated.y;
        if (Math.abs(dx) < pxThreshold && Math.abs(dy) < pxThreshold) return;
      }
    }
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
    if (isSafari) {
      hammerNudgeRAF = requestAnimationFrame(() => {
        hammerNudgeRAF = 0;
        schedule();
      });
    } else {
      schedule();
    }
  }

  const zoomRenderManager = createZoomRenderManager({
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
    const Lcol = Math.ceil(state.marginL / charWidth);
    const Rcol = Math.floor((state.marginR - 1) / charWidth);
    const leftPx = Lcol * charWidth;
    const rightPx = (Rcol + 1) * charWidth;
    const topPx = state.marginTop;
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

  function updateRulerTicks(activePageRect, { preferLiveLayout = true } = {}) {
    const ticksH = app.rulerH_host ? app.rulerH_host.querySelector('.ruler-ticks') : null;
    const ticksV = app.rulerV_host ? app.rulerV_host.querySelector('.ruler-v-ticks') : null;
    if (!ticksH || !ticksV) return;
    ticksH.innerHTML = '';
    ticksV.innerHTML = '';
    const ppiH = (activePageRect.width / 210) * 25.4;
    const originX = activePageRect.left;
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
    const startInchH = Math.floor(-originX / ppiH);
    const endInchH = Math.ceil((hostWidth - originX) / ppiH);
    for (let i = startInchH; i <= endInchH; i++) {
      for (let j = 0; j < 10; j++) {
        const x = originX + (i + j / 10) * ppiH;
        if (x < 0 || x > hostWidth) continue;
        const tick = document.createElement('div');
        tick.className = j === 0 ? 'tick major' : j === 5 ? 'tick medium' : 'tick minor';
        tick.style.left = `${x}px`;
        ticksH.appendChild(tick);
        if (j === 0) {
          const lbl = document.createElement('div');
          lbl.className = 'tick-num';
          lbl.textContent = i;
          lbl.style.left = `${x + 4}px`;
          ticksH.appendChild(lbl);
        }
      }
    }
    const ppiV = (activePageRect.height / 297) * 25.4;
    const originY = activePageRect.top;
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
    const startInchV = Math.floor(-originY / ppiV);
    const endInchV = Math.ceil((hostHeight - originY) / ppiV);
    for (let i = startInchV; i <= endInchV; i++) {
      for (let j = 0; j < 10; j++) {
        const y = originY + (i + j / 10) * ppiV;
        if (y < 0 || y > hostHeight) continue;
        const tick = document.createElement('div');
        tick.className = j === 0 ? 'tick-v major' : j === 5 ? 'tick-v medium' : 'tick-v minor';
        tick.style.top = `${y}px`;
        ticksV.appendChild(tick);
        if (j === 0) {
          const lbl = document.createElement('div');
          lbl.className = 'tick-v-num';
          lbl.textContent = i;
          lbl.style.top = `${y + 4}px`;
          ticksV.appendChild(lbl);
        }
      }
    }
  }

  function positionRulers(options = {}) {
    const preferLiveLayout = options && options.preferLiveLayout !== undefined ? options.preferLiveLayout : true;
    if (!state.showRulers) return;
    if (!app.rulerH_stops_container || !app.rulerV_stops_container) return;
    const pageRect = preferLiveLayout ? getActivePageRect() : computeManualPageRect();
    if (preferLiveLayout) {
      snapshotRulerLayout(pageRect);
    }
    app.rulerH_stops_container.innerHTML = '';
    app.rulerV_stops_container.innerHTML = '';
    const snap = computeSnappedVisualMargins();
    const mLeft = document.createElement('div');
    mLeft.className = 'tri left';
    mLeft.style.left = `${pageRect.left + snap.leftPx * state.zoom}px`;
    app.rulerH_stops_container.appendChild(mLeft);
    const mRight = document.createElement('div');
    mRight.className = 'tri right';
    mRight.style.left = `${pageRect.left + snap.rightPx * state.zoom}px`;
    app.rulerH_stops_container.appendChild(mRight);
    const mTop = document.createElement('div');
    mTop.className = 'tri-v top';
    mTop.style.top = `${pageRect.top + snap.topPx * state.zoom}px`;
    app.rulerV_stops_container.appendChild(mTop);
    const mBottom = document.createElement('div');
    mBottom.className = 'tri-v bottom';
    mBottom.style.top = `${pageRect.top + (app.PAGE_H - snap.bottomPx) * state.zoom}px`;
    app.rulerV_stops_container.appendChild(mBottom);
    updateRulerTicks(pageRect, { preferLiveLayout });
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
    let y = snapYToGrid(clamp((ev.clientY - pr.top) / state.zoom, 0, app.PAGE_H));
    if (drag.side === 'top') {
      const maxTop = (app.PAGE_H - state.marginBottom) - (getLineStepMu() * getGridHeight());
      state.marginTop = Math.min(y, snapYToGrid(maxTop));
      app.guideH.style.top = `${pr.top + state.marginTop * state.zoom}px`;
    } else {
      const bottomEdge = Math.max(state.marginTop + (getLineStepMu() * getGridHeight()), y);
      const snappedBottomEdge = snapYToGrid(Math.min(bottomEdge, app.PAGE_H));
      state.marginBottom = app.PAGE_H - snappedBottomEdge;
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
    updateZoomWrapTransform();
    const dims = stageDimensions();
    updateRulerHostDimensions(dims.width, dims.height);
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
    trackZoomLag({ zoom: nextZoom, delta: zoomDelta, reason: 'zoom-change' });
    if (prevZoom > 0 && Number.isFinite(prevOffsetX) && Number.isFinite(prevOffsetY)) {
      const ratio = prevZoom / nextZoom;
      if (Number.isFinite(ratio) && Math.abs(ratio - 1) > 1e-6) {
        setPaperOffset(prevOffsetX * ratio, prevOffsetY * ratio);
      }
    }
    if (isSafari && !getZooming()) stageLayoutSetSafariZoomMode('steady', { force: true });
    applyZoomCSS();
    reanchorCaretAfterZoomChange();
    scheduleZoomCrispRedraw();
    updateZoomUIFromState();
    markDocumentDirty(state);
    saveStateDebounced();
  }

  const zoomUiController = createZoomUiController({
    app,
    state,
    isSafari,
    setZoomPercent,
    setZooming,
    setFreezeVirtual,
    setSafariZoomMode,
    scheduleZoomCrispRedraw,
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
    const dx = e.deltaX;
    const dy = e.deltaY;
    if (dx || dy) {
      setPaperOffset(state.paperOffset.x - dx / state.zoom, state.paperOffset.y - dy / state.zoom);
    }
  }

  setupZoomMeasurementTracking();

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
  };
}
