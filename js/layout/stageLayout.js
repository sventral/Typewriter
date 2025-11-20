import { clamp } from '../utils/math.js';
import { sanitizeIntegerField } from '../utils/forms.js';

const SAFARI_SUPERSAMPLE_THRESHOLD = 1.75;
export const STAGE_WIDTH_MIN = 1.0;
export const STAGE_WIDTH_MAX = 1.5;
export const STAGE_HEIGHT_MIN = 1.0;
export const STAGE_HEIGHT_MAX = 1.5;
export const BASE_PADDING_X_PX = 24;
export const BASE_PADDING_Y_PX = 40;

export function detectSafariEnvironment() {
  // Safari-specific branches are intentionally disabled to keep a single rendering path.
  return { isSafari: false, supersampleThreshold: SAFARI_SUPERSAMPLE_THRESHOLD };
}

export function createStageLayoutController(options) {
  const {
    context,
    app: explicitApp,
    state: explicitState,
    isSafari: _isSafari,
    renderMargins,
    updateStageEnvironment,
    updateCaretPosition,
  } = options || {};

  // Force Safari handling off so all browsers follow the same code path.
  const isSafari = false;

  const app = explicitApp || context?.app;
  const state = explicitState || context?.state || {};

  let safariZoomMode = isSafari ? 'steady' : 'transient';
  let lastSafariLayoutZoom = isSafari ? state.zoom : 1;
  let cachedToolbarHeight = null;

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
    const fallback = 1.0;
    const sanitized = clamp(Number.isFinite(raw) ? raw : fallback, STAGE_WIDTH_MIN, STAGE_WIDTH_MAX);
    if (sanitized !== state.stageWidthFactor) state.stageWidthFactor = sanitized;
    return sanitized;
  }

  function sanitizedStageHeightFactor() {
    const raw = Number(state.stageHeightFactor);
    const fallback = 1.0;
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
    const zoom = Number.isFinite(state.zoom) && state.zoom > 0 ? state.zoom : 1;

    const extraFromWidthFactor = Math.max(0, widthFactor - 1) * pageW / 2;
    const extraFromHeightFactor = Math.max(0, heightFactor - 1) * pageH / 2;
    const paddingX = BASE_PADDING_X_PX + extraFromWidthFactor;
    const paddingY = BASE_PADDING_Y_PX + extraFromHeightFactor;
    const scaledExtraX = paddingX * zoom;
    const scaledExtraY = paddingY * zoom;

    const width = pageW + paddingX * 2;
    const height = pageH + paddingY * 2;
    const widthMultiplier = width / pageW;
    const heightMultiplier = height / pageH;

    return {
      widthFactor: widthMultiplier,
      heightFactor: heightMultiplier,
      width,
      height,
      extraX: scaledExtraX,
      extraY: scaledExtraY,
      paddingX,
      paddingY,
      pageW,
      pageH,
    };
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
  };
}
