import { clamp } from '../utils/math.js';
import { sanitizeIntegerField } from '../utils/forms.js';

const SAFARI_SUPERSAMPLE_THRESHOLD = 1.75;

export function detectSafariEnvironment() {
  if (typeof navigator === 'undefined') {
    return { isSafari: false, supersampleThreshold: SAFARI_SUPERSAMPLE_THRESHOLD };
  }
  const ua = navigator.userAgent || '';
  const vendor = navigator.vendor || '';
  const platform = navigator.platform || '';
  const maxTouch = Number.isFinite(navigator.maxTouchPoints) ? navigator.maxTouchPoints : 0;
  const isIos = /iP(ad|hone|od)/i.test(ua) || (platform === 'MacIntel' && maxTouch > 1);
  const isSafariDesktop = /Safari/i.test(ua) && /Apple/i.test(vendor) && !/Chrome|CriOS|FxiOS|Edg|Android/i.test(ua);
  const isSafari = isIos ? (/Safari/i.test(ua) || /Version\//i.test(ua)) : isSafariDesktop;
  return { isSafari, supersampleThreshold: SAFARI_SUPERSAMPLE_THRESHOLD };
}

export function createStageLayoutController({
  app,
  state,
  isSafari,
  DPR,
  requestVirtualization,
  getZooming = () => false,
  saveStateDebounced = () => {},
  getCharWidth,
  getGridHeight,
  getAsc,
  getDesc,
  updateCaretPosition,
}) {
  const STAGE_WIDTH_MIN = 1.0;
  const STAGE_WIDTH_MAX = 5.0;
  const STAGE_HEIGHT_MIN = 1.0;
  const STAGE_HEIGHT_MAX = 5.0;

  let safariZoomMode = isSafari ? 'steady' : 'transient';
  let lastSafariLayoutZoom = isSafari ? state.zoom : 1;
  let cachedToolbarHeight = null;
  let hammerNudgeRAF = 0;
  let drag = null;
  let boundsGetter = () => ({ L: 0, R: 0, Tmu: 0, Bmu: 0 });
  let clampCaretToBounds = () => {};
  let saveState = saveStateDebounced;

  if (isSafari) {
    try {
      document.documentElement.classList.add('safari-no-blur');
    } catch {}
  }

  function setDocumentModelHooks({ getCurrentBounds, clampCaret }) {
    if (typeof getCurrentBounds === 'function') boundsGetter = getCurrentBounds;
    if (typeof clampCaret === 'function') clampCaretToBounds = clampCaret;
  }

  function setPersistenceHooks({ saveStateDebounced: save }) {
    if (typeof save === 'function') saveState = save;
  }

  function layoutZoomFactor() {
    if (!isSafari) return 1;
    return safariZoomMode === 'steady' ? state.zoom : 1;
  }

  function cssScaleFactor() {
    if (!isSafari) return state.zoom;
    return safariZoomMode === 'steady' ? 1 : state.zoom;
  }

  function sanitizedStageWidthFactor() {
    const raw = Number(state.stageWidthFactor);
    const fallback = 2.0;
    const sanitized = clamp(Number.isFinite(raw) ? raw : fallback, STAGE_WIDTH_MIN, STAGE_WIDTH_MAX);
    if (sanitized !== state.stageWidthFactor) state.stageWidthFactor = sanitized;
    return sanitized;
  }

  function sanitizedStageHeightFactor() {
    const raw = Number(state.stageHeightFactor);
    const fallback = 1.2;
    const sanitized = clamp(Number.isFinite(raw) ? raw : fallback, STAGE_HEIGHT_MIN, STAGE_HEIGHT_MAX);
    if (sanitized !== state.stageHeightFactor) state.stageHeightFactor = sanitized;
    return sanitized;
  }

  function stageDimensions() {
    const widthFactor = sanitizedStageWidthFactor();
    const heightFactor = sanitizedStageHeightFactor();
    const layoutZoom = layoutZoomFactor();
    const pageW = app.PAGE_W * layoutZoom;
    const pageH = app.PAGE_H * layoutZoom;
    const width = pageW * widthFactor;
    const height = pageH * heightFactor;
    const extraX = Math.max(0, (width - pageW) / 2);
    const extraY = Math.max(0, (height - pageH) / 2);
    return { widthFactor, heightFactor, width, height, extraX, extraY, pageW, pageH };
  }

  function toolbarHeightPx() {
    if (cachedToolbarHeight !== null) return cachedToolbarHeight;
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--toolbar-h');
      const parsed = parseFloat(raw);
      cachedToolbarHeight = Number.isFinite(parsed) ? parsed : 48;
    } catch {
      cachedToolbarHeight = 48;
    }
    return cachedToolbarHeight;
  }

  function sanitizeStageInput(input, fallbackFactor, allowEmpty, isWidth) {
    if (!input) return null;
    const minPct = Math.round((isWidth ? STAGE_WIDTH_MIN : STAGE_HEIGHT_MIN) * 100);
    const maxPct = Math.round((isWidth ? STAGE_WIDTH_MAX : STAGE_HEIGHT_MAX) * 100);
    const fallbackPct = clamp(Math.round(fallbackFactor * 100), minPct, maxPct);
    const value = sanitizeIntegerField(input, { min: minPct, max: maxPct, allowEmpty, fallbackValue: fallbackPct });
    if (value === null || !Number.isFinite(value)) {
      return allowEmpty
        ? null
        : clamp(
            fallbackFactor,
            isWidth ? STAGE_WIDTH_MIN : STAGE_HEIGHT_MIN,
            isWidth ? STAGE_WIDTH_MAX : STAGE_HEIGHT_MAX,
          );
    }
    const factor = value / 100;
    return clamp(
      factor,
      isWidth ? STAGE_WIDTH_MIN : STAGE_HEIGHT_MIN,
      isWidth ? STAGE_WIDTH_MAX : STAGE_HEIGHT_MAX,
    );
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

  function updateRulerHostDimensions(stageW, stageH) {
    if (!app.rulerH_host || !app.rulerV_host) return;
    const scale = cssScaleFactor();
    const scaledW = stageW * scale;
    const scaledH = stageH * scale;
    app.rulerH_host.style.width = `${scaledW}px`;
    app.rulerV_host.style.height = `${scaledH}px`;
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
    if (!isSafariSteadyZoom()) return false;
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
    const DEAD_X = 1.25;
    const DEAD_Y = 3.0;
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
    const charW = getCharWidth();
    const gridH = getGridHeight();
    const asc = getAsc();
    const desc = getDesc();
    const Lcol = Math.ceil(state.marginL / charW);
    const Rcol = Math.floor((state.marginR - 1) / charW);
    const leftPx = Lcol * charW;
    const rightPx = (Rcol + 1) * charW;
    const topPx = state.marginTop;
    const bottomPx = state.marginBottom;
    const Tmu = Math.ceil((state.marginTop + asc) / gridH);
    const Bmu = Math.floor((app.PAGE_H - state.marginBottom - desc) / gridH);
    return { leftPx, rightPx, topPx, bottomPx, Lcol, Rcol, Tmu, Bmu };
  }

  function renderMargins() {
    const snap = computeSnappedVisualMargins();
    const layoutScale = layoutZoomFactor();
    for (const p of state.pages) {
      if (p?.pageEl) p.pageEl.style.height = app.PAGE_H * layoutScale + 'px';
      const leftPx = Math.round(snap.leftPx * layoutScale);
      const rightPx = Math.round((app.PAGE_W - snap.rightPx) * layoutScale);
      const topPx = Math.round(snap.topPx * layoutScale);
      const bottomPx = Math.round(snap.bottomPx * layoutScale);
      p.marginBoxEl.style.left = leftPx + 'px';
      p.marginBoxEl.style.right = rightPx + 'px';
      p.marginBoxEl.style.top = topPx + 'px';
      p.marginBoxEl.style.bottom = bottomPx + 'px';
      p.marginBoxEl.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
    }
  }

  function getActivePageRect() {
    const p = state.pages[app.activePageIndex ?? state.caret.page] || state.pages[0];
    if (!p || !p.wrapEl) return new DOMRect(0, 0, app.PAGE_W * state.zoom, app.PAGE_H * state.zoom);
    const r = p.wrapEl.getBoundingClientRect();
    return new DOMRect(r.left, r.top, r.width, app.PAGE_H * state.zoom);
  }

  function updateRulerTicks(activePageRect) {
    if (!app.rulerH_host || !app.rulerV_host) return;
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
        tick.style.left = x + 'px';
        ticksH.appendChild(tick);
        if (j === 0) {
          const lbl = document.createElement('div');
          lbl.className = 'tick-num';
          lbl.textContent = i;
          lbl.style.left = x + 4 + 'px';
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
        tick.style.top = y + 'px';
        ticksV.appendChild(tick);
        if (j === 0) {
          const lbl = document.createElement('div');
          lbl.className = 'tick-v-num';
          lbl.textContent = i;
          lbl.style.top = y + 4 + 'px';
          ticksV.appendChild(lbl);
        }
      }
    }
  }

  function setMarginBoxesVisible(show) {
    for (const p of state.pages) {
      if (p?.marginBoxEl) p.marginBoxEl.style.visibility = show && state.showMarginBox ? 'visible' : 'hidden';
    }
  }

  function positionRulers() {
    if (!state.showRulers) return;
    app.rulerH_stops_container.innerHTML = '';
    app.rulerV_stops_container.innerHTML = '';
    const pageRect = getActivePageRect();
    const snap = computeSnappedVisualMargins();
    const mLeft = document.createElement('div');
    mLeft.className = 'tri left';
    mLeft.style.left = pageRect.left + snap.leftPx * state.zoom + 'px';
    app.rulerH_stops_container.appendChild(mLeft);
    const mRight = document.createElement('div');
    mRight.className = 'tri right';
    mRight.style.left = pageRect.left + snap.rightPx * state.zoom + 'px';
    app.rulerH_stops_container.appendChild(mRight);
    const mTop = document.createElement('div');
    mTop.className = 'tri-v top';
    mTop.style.top = pageRect.top + snap.topPx * state.zoom + 'px';
    app.rulerV_stops_container.appendChild(mTop);
    const mBottom = document.createElement('div');
    mBottom.className = 'tri-v bottom';
    mBottom.style.top = pageRect.top + (app.PAGE_H - snap.bottomPx) * state.zoom + 'px';
    app.rulerV_stops_container.appendChild(mBottom);
    updateRulerTicks(pageRect);
  }

  function snapXToGrid(x) {
    const charW = getCharWidth();
    return Math.round(x / charW) * charW;
  }

  function snapYToGrid(y) {
    const gridH = getGridHeight();
    return Math.round(y / gridH) * gridH;
  }

  function handleHorizontalMarginDrag(ev) {
    if (!drag || drag.kind !== 'h') return;
    const pr = getActivePageRect();
    const x = snapXToGrid(clamp((ev.clientX - pr.left) / state.zoom, 0, app.PAGE_W));
    const charW = getCharWidth();
    if (drag.side === 'left') {
      state.marginL = Math.min(x, Math.max(0, state.marginR - charW));
    } else {
      state.marginR = Math.max(x, Math.min(app.PAGE_W, state.marginL + charW));
    }
    app.guideV.style.left = pr.left + x * state.zoom + 'px';
    app.guideV.style.display = 'block';
  }

  function handleVerticalMarginDrag(ev) {
    if (!drag || drag.kind !== 'v') return;
    const pr = getActivePageRect();
    const gridH = getGridHeight();
    const lineStepMu = state.lineStepMu;
    const y = snapYToGrid(clamp((ev.clientY - pr.top) / state.zoom, 0, app.PAGE_H));
    if (drag.side === 'top') {
      const maxTop = app.PAGE_H - state.marginBottom - lineStepMu * gridH;
      state.marginTop = Math.min(y, snapYToGrid(maxTop));
      app.guideH.style.top = pr.top + state.marginTop * state.zoom + 'px';
    } else {
      const bottomEdge = Math.max(state.marginTop + lineStepMu * gridH, y);
      const snappedBottomEdge = snapYToGrid(Math.min(bottomEdge, app.PAGE_H));
      state.marginBottom = app.PAGE_H - snappedBottomEdge;
      app.guideH.style.top = pr.top + snappedBottomEdge * state.zoom + 'px';
    }
    app.guideH.style.display = 'block';
  }

  function beginMarginDrag(kind, side, pointerId) {
    drag = { kind, side, pointerId };
    setMarginBoxesVisible(false);
  }

  function endMarginDrag() {
    if (!drag) return;
    document.removeEventListener('pointermove', handleHorizontalMarginDrag);
    document.removeEventListener('pointermove', handleVerticalMarginDrag);
    document.removeEventListener('pointerup', endMarginDrag, true);
    document.removeEventListener('pointercancel', endMarginDrag, true);
    renderMargins();
    positionRulers();
    clampCaretToBounds();
    saveState();
    app.guideV.style.display = 'none';
    app.guideH.style.display = 'none';
    setMarginBoxesVisible(true);
    drag = null;
  }

  function mmX(px) {
    return (px * 210) / app.PAGE_W;
  }

  function mmY(px) {
    return (px * 297) / app.PAGE_H;
  }

  function pxX(mm) {
    return (mm * app.PAGE_W) / 210;
  }

  function pxY(mm) {
    return (mm * app.PAGE_H) / 297;
  }

  function updateZoomWrapTransform() {
    if (!app.zoomWrap) return;
    const scale = cssScaleFactor();
    if (Math.abs(scale - 1) < 1e-6) {
      app.zoomWrap.style.transform = 'none';
    } else {
      app.zoomWrap.style.transform = `scale(${scale})`;
    }
  }

  function syncSafariZoomLayout(force = false) {
    if (!isSafari) return;
    const layoutZoom = layoutZoomFactor();
    if (!force && lastSafariLayoutZoom === layoutZoom) {
      updateZoomWrapTransform();
      return;
    }
    lastSafariLayoutZoom = layoutZoom;
    updateStageEnvironment();
    const cssW = app.PAGE_W * layoutZoom;
    const cssH = app.PAGE_H * layoutZoom;
    for (const page of state.pages) {
      if (!page) continue;
      if (page.pageEl) page.pageEl.style.height = `${cssH}px`;
      if (page.canvas) {
        page.canvas.style.width = `${cssW}px`;
        page.canvas.style.height = `${cssH}px`;
      }
      if (page.backCanvas) {
        page.backCanvas.style.width = `${cssW}px`;
        page.backCanvas.style.height = `${cssH}px`;
      }
    }
    renderMargins();
    updateCaretPosition();
    updateZoomWrapTransform();
  }

  function setSafariZoomMode(mode, { force = false } = {}) {
    if (!isSafari) return;
    const target = mode === 'transient' ? 'transient' : 'steady';
    const prevMode = safariZoomMode;
    safariZoomMode = target;
    const layoutZoom = layoutZoomFactor();
    const requireUpdate = force || prevMode !== target || lastSafariLayoutZoom !== layoutZoom;
    syncSafariZoomLayout(requireUpdate);
  }

  function isSafariSteadyZoom() {
    return isSafari && safariZoomMode === 'steady';
  }

  return {
    layoutZoomFactor,
    cssScaleFactor,
    sanitizedStageWidthFactor,
    sanitizedStageHeightFactor,
    stageDimensions,
    toolbarHeightPx,
    sanitizeStageInput,
    updateZoomWrapTransform,
    syncSafariZoomLayout,
    setSafariZoomMode,
    isSafariSteadyZoom,
    updateStageEnvironment,
    setPaperOffset,
    caretViewportPos,
    anchorPx,
    maybeApplyNativeScroll,
    nudgePaperToAnchor,
    requestHammerNudge,
    computeSnappedVisualMargins,
    renderMargins,
    updateRulerTicks,
    positionRulers,
    setMarginBoxesVisible,
    snapXToGrid,
    snapYToGrid,
    handleHorizontalMarginDrag,
    handleVerticalMarginDrag,
    beginMarginDrag,
    endMarginDrag,
    mmX,
    mmY,
    pxX,
    pxY,
    setDocumentModelHooks,
    setPersistenceHooks,
  };
}
