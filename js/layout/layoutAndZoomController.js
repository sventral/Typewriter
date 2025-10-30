import { clamp } from '../utils/math.js';

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

  let hammerNudgeRAF = 0;
  let zoomDrag = null;
  let zoomIndicatorTimer = null;
  let pendingZoomRedrawRAF = 0;
  let pendingZoomRedrawIsTimeout = false;

  const DEFAULT_ZOOM_THUMB_HEIGHT = 13;
  let zoomMeasurements = null;
  let zoomMeasurementsObserver = null;

  function refreshZoomMeasurements() {
    if (!app.zoomTrack) {
      zoomMeasurements = null;
      return null;
    }
    const trackRect = app.zoomTrack.getBoundingClientRect();
    const thumbRect = app.zoomThumb?.getBoundingClientRect();
    zoomMeasurements = {
      top: trackRect.top,
      height: trackRect.height,
      thumbHeight: thumbRect?.height || DEFAULT_ZOOM_THUMB_HEIGHT,
    };
    return zoomMeasurements;
  }

  function ensureZoomMeasurements() {
    if (!zoomMeasurements || !Number.isFinite(zoomMeasurements.height) || zoomMeasurements.height <= 0) {
      return refreshZoomMeasurements();
    }
    return zoomMeasurements;
  }

  function setupZoomMeasurementTracking() {
    if (!app.zoomTrack) {
      zoomMeasurements = null;
      return;
    }
    refreshZoomMeasurements();
    if (typeof ResizeObserver !== 'function' || zoomMeasurementsObserver) return;
    zoomMeasurementsObserver = new ResizeObserver(() => {
      refreshZoomMeasurements();
      updateZoomUIFromState();
    });
    zoomMeasurementsObserver.observe(app.zoomTrack);
    if (app.zoomThumb) zoomMeasurementsObserver.observe(app.zoomThumb);
  }

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
    return Number.isFinite(span) && span > 0 ? span / 2 : app.PAGE_W / 2;
  }

  function hammerAllowanceY() {
    const span = documentVerticalSpanPx();
    return Number.isFinite(span) && span > 0 ? span / 2 : app.PAGE_H / 2;
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
    if (app.stageInner) {
      const tx = Math.round(snappedX * 1000) / 1000;
      const ty = Math.round(snappedY * 1000) / 1000;
      app.stageInner.style.transform = `translate3d(${tx}px,${ty}px,0)`;
    }
    positionRulers();
    requestVirtualization();
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
    for (const p of state.pages) {
      if (!p?.marginBoxEl) continue;
      if (p.pageEl) p.pageEl.style.height = `${app.PAGE_H * layoutScale}px`;
      const leftPx = Math.round(snap.leftPx * layoutScale);
      const rightPx = Math.round((app.PAGE_W - snap.rightPx) * layoutScale);
      const topPx = Math.round(snap.topPx * layoutScale);
      const bottomPx = Math.round(snap.bottomPx * layoutScale);
      p.marginBoxEl.style.left = `${leftPx}px`;
      p.marginBoxEl.style.right = `${rightPx}px`;
      p.marginBoxEl.style.top = `${topPx}px`;
      p.marginBoxEl.style.bottom = `${bottomPx}px`;
      p.marginBoxEl.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
    }
  }

  function getActivePageRect() {
    const p = state.pages[app.activePageIndex ?? state.caret.page] || state.pages[0];
    const r = p.wrapEl.getBoundingClientRect();
    return new DOMRect(r.left, r.top, r.width, app.PAGE_H * state.zoom);
  }

  function updateRulerTicks(activePageRect) {
    const ticksH = app.rulerH_host.querySelector('.ruler-ticks');
    const ticksV = app.rulerV_host.querySelector('.ruler-v-ticks');
    if (!ticksH || !ticksV) return;
    ticksH.innerHTML = '';
    ticksV.innerHTML = '';
    const ppiH = (activePageRect.width / 210) * 25.4;
    const originX = activePageRect.left;
    const hostWidth = app.rulerH_host.getBoundingClientRect().width || window.innerWidth;
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
    const hostHeight = app.rulerV_host.getBoundingClientRect().height || window.innerHeight;
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

  let safariRulerRAF = 0;

  function positionRulersImmediate() {
    if (!state.showRulers) return;
    if (!app.rulerH_stops_container || !app.rulerV_stops_container) return;
    app.rulerH_stops_container.innerHTML = '';
    app.rulerV_stops_container.innerHTML = '';
    const pageRect = getActivePageRect();
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
    updateRulerTicks(pageRect);
  }

  function positionRulers() {
    if (!state.showRulers) {
      if (safariRulerRAF) {
        cancelAnimationFrame(safariRulerRAF);
        safariRulerRAF = 0;
      }
      return;
    }
    if (!isSafari) {
      positionRulersImmediate();
      return;
    }
    if (safariRulerRAF) return;
    safariRulerRAF = requestAnimationFrame(() => {
      safariRulerRAF = 0;
      positionRulersImmediate();
    });
  }

  function setMarginBoxesVisible(show) {
    for (const p of state.pages) {
      if (p?.marginBoxEl) {
        p.marginBoxEl.style.visibility = show && state.showMarginBox ? 'visible' : 'hidden';
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
    saveStateDebounced();
    app.guideV.style.display = 'none';
    app.guideH.style.display = 'none';
    setMarginBoxesVisible(true);
    setDrag(null);
  }

  const Z_MIN = 50;
  const Z_KNEE = 100;
  const Z_MAX = 400;
  const N_KNEE = 1 / 3;
  const LOG2 = Math.log(2);
  const LOG4 = Math.log(4);

  const zFromNorm = (n) => {
    const clamped = Math.max(0, Math.min(1, n));
    if (clamped <= N_KNEE) return 50 * Math.pow(2, clamped / N_KNEE);
    return 100 * Math.pow(4, (clamped - N_KNEE) / (1 - N_KNEE));
  };

  const normFromZ = (pct) => {
    let p = Math.max(Z_MIN, Math.min(Z_MAX, pct));
    if (p <= Z_KNEE) return (Math.log(p / 50) / LOG2) * N_KNEE;
    return N_KNEE + (Math.log(p / 100) / LOG4) * (1 - N_KNEE);
  };

  const detent = (p) => (Math.abs(p - 100) <= 6 ? 100 : p);

  function applyZoomCSS() {
    updateZoomWrapTransform();
    const dims = stageDimensions();
    updateRulerHostDimensions(dims.width, dims.height);
    positionRulers();
    requestVirtualization();
  }

  function showZoomIndicator() {
    if (!app.zoomIndicator) return;
    app.zoomIndicator.textContent = `${Math.round(state.zoom * 100)}%`;
    app.zoomIndicator.classList.add('show');
    if (zoomIndicatorTimer) clearTimeout(zoomIndicatorTimer);
    zoomIndicatorTimer = setTimeout(() => app.zoomIndicator.classList.remove('show'), 700);
  }

  function updateZoomUIFromState() {
    if (!app.zoomTrack || !app.zoomFill || !app.zoomThumb) return;
    const measurements = ensureZoomMeasurements();
    if (!measurements || !measurements.height) return;
    const { height: H, thumbHeight: th } = measurements;
    const n = normFromZ(state.zoom * 100);
    const fillH = n * H;
    app.zoomFill.style.height = `${fillH}px`;
    const y = (H - fillH) - th / 2;
    app.zoomThumb.style.top = `${Math.max(-th / 2, Math.min(H - th / 2, y))}px`;
    showZoomIndicator();
  }

  function runBatchedZoomRedraw() {
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
      page.dirtyAll = true;
      if (page.active) schedulePaint(page);
    };

    for (const page of priority) prepPage(page);

    rebuildAllAtlases();

    const finalize = () => {
      setFreezeVirtual(false);
      requestHammerNudge();
      if (isSafari) syncSafariZoomLayout(true);
    };

    finalize();

    if (!rest.length) return;

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

  function scheduleZoomCrispRedraw() {
    const existing = getZoomDebounceTimer();
    if (existing) clearTimeout(existing);
    clearPendingZoomRedrawFrame();
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
    }, 160);
    setZoomDebounceTimer(timer);
  }

  function setZoomPercent(pct) {
    const z = detent(Math.round(Math.max(Z_MIN, Math.min(Z_MAX, pct))));
    state.zoom = z / 100;
    if (isSafari && !getZooming()) stageLayoutSetSafariZoomMode('steady', { force: true });
    applyZoomCSS();
    scheduleZoomCrispRedraw();
    updateZoomUIFromState();
    saveStateDebounced();
  }

  const percentFromPointer = (clientY) => {
    if (!app.zoomTrack) return state.zoom * 100;
    const measurements = ensureZoomMeasurements();
    if (!measurements || !measurements.height) return state.zoom * 100;
    const y = clamp(clientY - measurements.top, 0, measurements.height);
    return zFromNorm(1 - y / measurements.height);
  };

  function onZoomPointerDown(e) {
    if (!app.zoomThumb || !app.zoomTrack) return;
    e.preventDefault();
    refreshZoomMeasurements();
    setZooming(true);
    setFreezeVirtual(true);
    if (isSafari) setSafariZoomMode('transient', { force: true });
    if (e.target === app.zoomThumb) {
      zoomDrag = { from: 'thumb', id: e.pointerId };
      app.zoomThumb.setPointerCapture && app.zoomThumb.setPointerCapture(e.pointerId);
    } else {
      zoomDrag = { from: 'track', id: e.pointerId };
    }
    setZoomPercent(percentFromPointer(e.clientY));
  }

  function onZoomPointerMove(e) {
    if (!zoomDrag) return;
    setZoomPercent(percentFromPointer(e.clientY));
  }

  function onZoomPointerUp() {
    if (!zoomDrag) return;
    zoomDrag = null;
    setZooming(false);
    scheduleZoomCrispRedraw();
  }

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
