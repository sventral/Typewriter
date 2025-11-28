import { clamp } from '../utils/math.js';

export const LINE_SLANT_DEFAULTS = Object.freeze({
  enabled: true,
  range: Object.freeze({ min: 0, max: 0.6 }),
});

export const LINE_SLANT_LIMITS = Object.freeze({ min: 0, max: 20 });

function sanitizeRange(range, fallback) {
  const fb = fallback || { min: 0, max: 0 };
  let min = Number(range?.min);
  let max = Number(range?.max);
  if (!Number.isFinite(min)) min = fb.min;
  if (!Number.isFinite(max)) max = fb.max;
  if (min > max) [min, max] = [max, min];
  min = clamp(min, LINE_SLANT_LIMITS.min, LINE_SLANT_LIMITS.max);
  max = clamp(max, LINE_SLANT_LIMITS.min, LINE_SLANT_LIMITS.max);
  if (max < min) max = min;
  const round = (v) => Math.round(v * 1000) / 1000;
  return { min: round(min), max: round(max) };
}

export function normalizeLineSlantRange(range, fallback = LINE_SLANT_DEFAULTS.range) {
  return sanitizeRange(range, fallback);
}

export function clampLineSlantDeg(deg, range = LINE_SLANT_DEFAULTS.range) {
  const lim = normalizeLineSlantRange(range, LINE_SLANT_DEFAULTS.range);
  const absLimit = Math.max(lim.max, 0);
  if (!Number.isFinite(deg) || absLimit <= 0) return 0;
  const capped = clamp(deg, -absLimit, absLimit);
  const rounded = Math.round(capped * 1000) / 1000;
  return Math.abs(rounded) < 1e-6 ? 0 : rounded;
}

export function sampleLineSlantDeg(range = LINE_SLANT_DEFAULTS.range, rng = Math.random) {
  const lim = normalizeLineSlantRange(range, LINE_SLANT_DEFAULTS.range);
  if (!Number.isFinite(lim.max) || lim.max <= 0) return 0;
  const base = lim.min >= lim.max ? lim.max : (lim.min + (lim.max - lim.min) * ((typeof rng === 'function' ? rng() : Math.random())));
  const signed = (Math.random() < 0.5 ? -1 : 1) * base;
  return clampLineSlantDeg(signed, lim);
}
