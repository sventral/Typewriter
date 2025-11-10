import { clamp } from '../utils/math.js';

export const ZOOM_SLIDER_MIN_PCT = 50;
export const ZOOM_SLIDER_MAX_PCT = 400;

export const LOW_RES_ZOOM_DEFAULTS = {
  enabled: true,
  softCapPct: 200,
  marginPct: 20,
};

export function normalizeLowResZoomSettings(raw = {}, options = {}) {
  const maxZoomPct = Number.isFinite(options.maxZoomPct) ? options.maxZoomPct : ZOOM_SLIDER_MAX_PCT;
  const minSoftCapPct = Number.isFinite(options.minSoftCapPct) ? options.minSoftCapPct : ZOOM_SLIDER_MIN_PCT;
  const softCapSource = Number.isFinite(raw.softCapPct)
    ? raw.softCapPct
    : LOW_RES_ZOOM_DEFAULTS.softCapPct;
  const softCapPct = clamp(Math.round(softCapSource), minSoftCapPct, maxZoomPct);
  const marginCeiling = Math.max(0, maxZoomPct - softCapPct);
  const marginSource = Number.isFinite(raw.marginPct)
    ? raw.marginPct
    : LOW_RES_ZOOM_DEFAULTS.marginPct;
  const marginPct = clamp(Math.round(marginSource), 0, marginCeiling);
  return { softCapPct, marginPct };
}

export function resolveEffectiveZoomPct(requestedPct, settings = {}, options = {}) {
  const maxZoomPct = Number.isFinite(options.maxZoomPct) ? options.maxZoomPct : ZOOM_SLIDER_MAX_PCT;
  const minZoomPct = Number.isFinite(options.minZoomPct) ? options.minZoomPct : ZOOM_SLIDER_MIN_PCT;
  const requested = clamp(Number(requestedPct) || 0, minZoomPct, maxZoomPct);
  if (settings.enabled === false) return requested;
  const normalized = normalizeLowResZoomSettings(settings, {
    maxZoomPct,
    minSoftCapPct: minZoomPct,
  });
  if (requested <= normalized.softCapPct) return requested;
  if (normalized.marginPct <= 0 || maxZoomPct <= normalized.softCapPct) {
    return normalized.softCapPct;
  }
  const span = maxZoomPct - normalized.softCapPct;
  if (span <= 0) return normalized.softCapPct;
  const progress = (requested - normalized.softCapPct) / span;
  const ratio = clamp(progress, 0, 1);
  return normalized.softCapPct + normalized.marginPct * ratio;
}
