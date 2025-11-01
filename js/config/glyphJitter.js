import { clamp } from '../utils/math.js';

export const GLYPH_JITTER_DEFAULTS = Object.freeze({
  enabled: false,
  amountPct: Object.freeze({ min: 0.4, max: 2.2 }),
  frequencyPct: Object.freeze({ min: 30, max: 65 }),
  seed: 0xD1FF1E,
});

export const GLYPH_JITTER_AMOUNT_LIMITS = Object.freeze({ min: 0, max: 12 });
export const GLYPH_JITTER_FREQUENCY_LIMITS = Object.freeze({ min: 0, max: 100 });

function sanitizeRange(range, fallback, limits) {
  const safeFallback = fallback || { min: 0, max: 0 };
  const { min: fbMin = 0, max: fbMax = 0 } = safeFallback;
  const { min: limMin = Number.NEGATIVE_INFINITY, max: limMax = Number.POSITIVE_INFINITY } = limits || {};
  let minVal = Number(range?.min);
  let maxVal = Number(range?.max);
  if (!Number.isFinite(minVal)) minVal = fbMin;
  if (!Number.isFinite(maxVal)) maxVal = fbMax;
  if (minVal > maxVal) {
    const tmp = minVal;
    minVal = maxVal;
    maxVal = tmp;
  }
  minVal = clamp(minVal, limMin, limMax);
  maxVal = clamp(maxVal, limMin, limMax);
  if (maxVal < minVal) {
    minVal = maxVal;
  }
  const round = (v) => Math.round(v * 100) / 100;
  return { min: round(minVal), max: round(maxVal) };
}

export function normalizeGlyphJitterAmount(range, fallback = GLYPH_JITTER_DEFAULTS.amountPct) {
  return sanitizeRange(range, fallback, GLYPH_JITTER_AMOUNT_LIMITS);
}

export function normalizeGlyphJitterFrequency(range, fallback = GLYPH_JITTER_DEFAULTS.frequencyPct) {
  return sanitizeRange(range, fallback, GLYPH_JITTER_FREQUENCY_LIMITS);
}

export function normalizeGlyphJitterSeed(seed, fallback = GLYPH_JITTER_DEFAULTS.seed) {
  if (!Number.isFinite(seed)) return fallback >>> 0;
  return (seed >>> 0) || (fallback >>> 0);
}

export function cloneGlyphJitterRange(range) {
  if (!range || typeof range !== 'object') return { min: 0, max: 0 };
  const { min, max } = range;
  return { min: Number(min) || 0, max: Number(max) || 0 };
}
