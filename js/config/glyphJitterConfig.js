import { clamp } from '../utils/math.js';

export const GLYPH_JITTER_DEFAULTS = Object.freeze({
  enabled: true,
  amountPct: Object.freeze({ min: 0.4, max: 25 }),
  frequencyPct: Object.freeze({ min: 30, max: 65 }),
  seed: 0xD1FF1E,
});

export const GLYPH_BASELINE_OFFSET_DEFAULTS = Object.freeze({
  enabled: false,
  aboveChars: '',
  aboveRangePct: Object.freeze({ min: 70, max: 80 }),
  belowChars: '',
  belowRangePct: Object.freeze({ min: 70, max: 80 }),
});

export const GLYPH_JITTER_AMOUNT_LIMITS = Object.freeze({ min: 0, max: 100 });
export const GLYPH_JITTER_FREQUENCY_LIMITS = Object.freeze({ min: 0, max: 100 });
export const GLYPH_BASELINE_OFFSET_LIMITS = Object.freeze({ min: 0, max: 100 });
export const GLYPH_BASELINE_OFFSET_CHAR_LIMIT = 128;

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

export function normalizeGlyphBaselineOffsetChars(chars, fallback = '') {
  const fallbackValue = typeof fallback === 'string' ? fallback : '';
  const source = typeof chars === 'string' ? chars : fallbackValue;
  const seen = new Set();
  const normalized = [];
  for (const ch of Array.from(source)) {
    if (ch === '\n' || ch === '\r') continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    normalized.push(ch);
    if (normalized.length >= GLYPH_BASELINE_OFFSET_CHAR_LIMIT) break;
  }
  return normalized.join('');
}

export function normalizeGlyphBaselineOffsetRange(
  range,
  fallback = GLYPH_BASELINE_OFFSET_DEFAULTS.aboveRangePct,
) {
  return sanitizeRange(range, fallback, GLYPH_BASELINE_OFFSET_LIMITS);
}

export function normalizeGlyphBaselineOffsetSettings(
  settings,
  fallback = GLYPH_BASELINE_OFFSET_DEFAULTS,
) {
  const safeFallback = fallback || GLYPH_BASELINE_OFFSET_DEFAULTS;
  return {
    enabled: settings?.enabled === true
      ? true
      : settings?.enabled === false
        ? false
        : safeFallback.enabled === true,
    aboveChars: normalizeGlyphBaselineOffsetChars(
      settings?.aboveChars,
      safeFallback.aboveChars,
    ),
    aboveRangePct: normalizeGlyphBaselineOffsetRange(
      settings?.aboveRangePct,
      safeFallback.aboveRangePct,
    ),
    belowChars: normalizeGlyphBaselineOffsetChars(
      settings?.belowChars,
      safeFallback.belowChars,
    ),
    belowRangePct: normalizeGlyphBaselineOffsetRange(
      settings?.belowRangePct,
      safeFallback.belowRangePct,
    ),
  };
}

export function cloneGlyphBaselineOffsetSettings(settings) {
  return {
    enabled: settings?.enabled === true,
    aboveChars: typeof settings?.aboveChars === 'string' ? settings.aboveChars : '',
    aboveRangePct: cloneGlyphJitterRange(settings?.aboveRangePct),
    belowChars: typeof settings?.belowChars === 'string' ? settings.belowChars : '',
    belowRangePct: cloneGlyphJitterRange(settings?.belowRangePct),
  };
}
