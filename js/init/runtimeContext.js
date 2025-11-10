import { createMainState, createEphemeralState } from '../state/state.js';
import { createAppContext } from './appContext.js';
import {
  recalcMetrics as recalcMetricsForContext,
  scheduleMetricsUpdate as scheduleMetricsUpdateForContext,
} from '../config/metrics.js';
import { clamp } from '../utils/math.js';
import {
  LOW_RES_ZOOM_DEFAULTS,
  normalizeLowResZoomSettings,
  resolveEffectiveZoomPct,
  ZOOM_SLIDER_MAX_PCT,
  ZOOM_SLIDER_MIN_PCT,
} from '../config/lowResZoom.js';
import { DEFAULT_CANVAS_DIMENSION_CAP } from './environment.js';

const ZOOM_SLIDER_MIN_FACTOR = ZOOM_SLIDER_MIN_PCT / 100;
const ZOOM_SLIDER_MAX_FACTOR = ZOOM_SLIDER_MAX_PCT / 100;

export function createRuntimeContext({ app, metrics, canvasDimensionLimit }) {
  const { DPR, GRID_DIV, LINE_H_RAW } = metrics;
  const state = createMainState(app, GRID_DIV);
  const ephemeral = createEphemeralState();
  const context = createAppContext({ app, state, metrics, ephemeral });
  const metricsStore = context.scalars;

  ensureLowResZoomState();

  const metricsOptions = {
    state,
    metricsStore,
    contextMetrics: context.metrics,
    app,
    lineHeightRaw: LINE_H_RAW,
    gridDiv: GRID_DIV,
    getTargetPitchPx,
    dpr: DPR,
    onCaretHeightChange: (heightPx) => {
      if (app?.caretEl?.style) {
        app.caretEl.style.height = heightPx + 'px';
      }
    },
  };

  function getTargetPitchPx() {
    return app.PAGE_W / state.colsAcross;
  }

  function computeMaxRenderScale() {
    const capW = Number.isFinite(canvasDimensionLimit?.width)
      ? canvasDimensionLimit.width
      : DEFAULT_CANVAS_DIMENSION_CAP;
    const capH = Number.isFinite(canvasDimensionLimit?.height)
      ? canvasDimensionLimit.height
      : DEFAULT_CANVAS_DIMENSION_CAP;
    const limitW = app.PAGE_W ? capW / app.PAGE_W : 1;
    const limitH = app.PAGE_H ? capH / app.PAGE_H : 1;
    return Math.max(1, Math.min(limitW, limitH));
  }

  function ensureLowResZoomState() {
    if (typeof state.lowResZoomEnabled !== 'boolean') {
      state.lowResZoomEnabled = LOW_RES_ZOOM_DEFAULTS.enabled;
    }
    const normalized = normalizeLowResZoomSettings(
      {
        softCapPct: state.lowResZoomSoftCapPct,
        marginPct: state.lowResZoomMarginPct,
      },
      { maxZoomPct: ZOOM_SLIDER_MAX_PCT, minSoftCapPct: ZOOM_SLIDER_MIN_PCT },
    );
    state.lowResZoomSoftCapPct = normalized.softCapPct;
    state.lowResZoomMarginPct = normalized.marginPct;
    return normalized;
  }

  function getRequestedZoomPct() {
    const zoom = Number.isFinite(state.zoom) && state.zoom > 0 ? state.zoom : 1;
    return clamp(zoom * 100, ZOOM_SLIDER_MIN_PCT, ZOOM_SLIDER_MAX_PCT);
  }

  function getEffectiveRenderZoomPct() {
    const normalized = ensureLowResZoomState();
    const requestedPct = getRequestedZoomPct();
    return resolveEffectiveZoomPct(
      requestedPct,
      {
        enabled: state.lowResZoomEnabled !== false,
        softCapPct: normalized.softCapPct,
        marginPct: normalized.marginPct,
      },
      {
        maxZoomPct: ZOOM_SLIDER_MAX_PCT,
        minZoomPct: ZOOM_SLIDER_MIN_PCT,
      },
    );
  }

  function getEffectiveRenderZoom() {
    const pct = getEffectiveRenderZoomPct();
    return clamp(pct / 100, ZOOM_SLIDER_MIN_FACTOR, ZOOM_SLIDER_MAX_FACTOR);
  }

  function setRenderScaleForZoom() {
    const zoom = getEffectiveRenderZoom();
    const baseScale = DPR * zoom;
    const zoomSupersampleTarget = zoom <= 1.5
      ? 1
      : Math.min(2.5, 1 + (zoom - 1.5) * 0.6);
    const maxScale = computeMaxRenderScale();
    const headroom = maxScale / Math.max(baseScale, 1);
    const canOversample = headroom > 1.01;
    const appliedSupersample = canOversample
      ? Math.max(1, Math.min(zoomSupersampleTarget, headroom))
      : 1;
    const renderScale = headroom >= 1
      ? Math.min(maxScale, baseScale * appliedSupersample)
      : maxScale;
    metricsStore.RENDER_SCALE = renderScale;
    metricsStore.RENDER_SUPERSAMPLE = appliedSupersample;
  }

  function recalcMetrics(face) {
    return recalcMetricsForContext(face, metricsOptions);
  }

  function primeInitialMetrics() {
    if (
      metricsStore?.CHAR_W > 0 &&
      metricsStore?.ASC > 0 &&
      metricsStore?.DESC > 0 &&
      metricsStore?.BASELINE_OFFSET_CELL > 0
    ) {
      return;
    }
    try {
      recalcMetrics(metricsStore.ACTIVE_FONT_NAME);
      ephemeral.primedMetricsAreFallback = true;
    } catch (err) {
      console.warn('Failed to initialize base metrics', err);
    }
  }

  function createMetricsScheduler(applyMetricsNow) {
    return (full = false) =>
      scheduleMetricsUpdateForContext(
        { ephemeral, applyMetricsNow, requestAnimationFrameFn: requestAnimationFrame },
        full,
      );
  }

  return {
    app,
    metrics,
    canvasDimensionLimit,
    state,
    context,
    metricsStore,
    metricsOptions,
    recalcMetrics,
    ensureLowResZoomState,
    getTargetPitchPx,
    getEffectiveRenderZoomPct,
    getEffectiveRenderZoom,
    setRenderScaleForZoom,
    primeInitialMetrics,
    createMetricsScheduler,
    DPR,
    GRID_DIV,
    LINE_H_RAW,
    A4_WIDTH_IN: metrics.A4_WIDTH_IN,
    PPI: metrics.PPI,
    LPI: metrics.LPI,
    COLORS: metrics.COLORS,
    STORAGE_KEY: metrics.STORAGE_KEY,
    ephemeral,
  };
}
