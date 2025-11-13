import { clamp } from '../utils/math.js';

export function createZoomUiController(options) {
  const {
    app,
    state,
    isSafari,
    setZoomPercent,
    setZooming,
    setFreezeVirtual,
    setSafariZoomMode,
    scheduleZoomCrispRedraw,
  } = options;

  const DEFAULT_ZOOM_THUMB_HEIGHT = 13;
  let zoomMeasurements = null;
  let zoomMeasurementsDirty = true;
  let zoomMeasurementsObserver = null;
  let zoomIndicatorTimer = null;
  let zoomDrag = null;

  function markZoomMeasurementsDirty() {
    zoomMeasurementsDirty = true;
  }

  function refreshZoomMeasurements({ force = false } = {}) {
    if (!force && !zoomMeasurementsDirty && zoomMeasurements && Number.isFinite(zoomMeasurements.height) && zoomMeasurements.height > 0) {
      return zoomMeasurements;
    }
    zoomMeasurementsDirty = false;
    if (!app.zoomTrack) {
      zoomMeasurements = null;
      zoomMeasurementsDirty = true;
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
    if (zoomMeasurementsDirty || !zoomMeasurements || !Number.isFinite(zoomMeasurements.height) || zoomMeasurements.height <= 0) {
      return refreshZoomMeasurements();
    }
    return zoomMeasurements;
  }

  function setupZoomMeasurementTracking() {
    if (!app.zoomTrack) {
      zoomMeasurements = null;
      markZoomMeasurementsDirty();
      return;
    }
    refreshZoomMeasurements({ force: true });
    if (typeof ResizeObserver !== 'function' || zoomMeasurementsObserver) return;
    zoomMeasurementsObserver = new ResizeObserver(() => {
      markZoomMeasurementsDirty();
      refreshZoomMeasurements({ force: true });
      updateZoomUIFromState();
    });
    zoomMeasurementsObserver.observe(app.zoomTrack);
    if (app.zoomThumb) zoomMeasurementsObserver.observe(app.zoomThumb);
  }

  function showZoomIndicator() {
    if (!app.zoomIndicator) return;
    app.zoomIndicator.textContent = `${Math.round(state.zoom * 100)}%`;
    app.zoomIndicator.classList.add('show');
    if (zoomIndicatorTimer) clearTimeout(zoomIndicatorTimer);
    zoomIndicatorTimer = setTimeout(() => app.zoomIndicator.classList.remove('show'), 700);
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

  return {
    setupZoomMeasurementTracking,
    refreshZoomMeasurements,
    ensureZoomMeasurements,
    markZoomMeasurementsDirty,
    updateZoomUIFromState,
    onZoomPointerDown,
    onZoomPointerMove,
    onZoomPointerUp,
    percentFromPointer,
  };
}
