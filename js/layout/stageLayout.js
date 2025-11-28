import { clamp } from '../utils/math.js';
import { sanitizeIntegerField } from '../utils/forms.js';

export const STAGE_WIDTH_MIN = 1.0;
export const STAGE_WIDTH_MAX = 1.5;
export const STAGE_HEIGHT_MIN = 1.0;
export const STAGE_HEIGHT_MAX = 1.5;
export const BASE_PADDING_X_PX = 24;
export const BASE_PADDING_Y_PX = 40;

export function createStageLayoutController(options) {
  const {
    context,
    app: explicitApp,
    state: explicitState,
    renderMargins,
    updateStageEnvironment,
    updateCaretPosition,
  } = options || {};

  const app = explicitApp || context?.app;
  const state = explicitState || context?.state || {};

  let cachedToolbarHeight = null;

  function layoutZoomFactor() {
    return 1;
  }

  function cssScaleFactor() {
    return state.zoom;
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

  return {
    layoutZoomFactor,
    cssScaleFactor,
    sanitizedStageWidthFactor,
    sanitizedStageHeightFactor,
    stageDimensions,
    toolbarHeightPx,
    sanitizeStageInput,
    updateZoomWrapTransform,
  };
}
