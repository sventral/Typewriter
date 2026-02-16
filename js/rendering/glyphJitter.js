import {
  GLYPH_BASELINE_OFFSET_DEFAULTS,
  normalizeGlyphJitterAmount,
  normalizeGlyphJitterFrequency,
  normalizeGlyphJitterSeed,
  normalizeGlyphBaselineOffsetRange,
} from '../config/glyphJitterConfig.js';

function hash2(ix, iy, seed) {
  let h = seed | 0;
  h ^= Math.imul(ix | 0, 0x9E3779B1);
  h ^= Math.imul((iy | 0) ^ 0x85EBCA77, 0xC2B2AE3D);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function normalizeGlyphSalt(value) {
  if (!Number.isFinite(value)) return 0;
  return (value >>> 0);
}

function resolveBaselineDirection(glyphChar, aboveChars, belowChars) {
  if (typeof glyphChar !== 'string' || !glyphChar) return 0;
  if (aboveChars && aboveChars.includes(glyphChar)) return -1;
  if (belowChars && belowChars.includes(glyphChar)) return 1;
  return 0;
}

export function computeGlyphJitterOffset(state, pageIndex, rowMu, col, gridHeight, glyphSalt = 0) {
  if (!state?.glyphJitterEnabled) return 0;
  const lineHeight = Number(gridHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0;
  const amountRange = normalizeGlyphJitterAmount(state.glyphJitterAmountPct);
  const frequencyRange = normalizeGlyphJitterFrequency(state.glyphJitterFrequencyPct);
  const freqMax = Math.max(0, frequencyRange.max) / 100;
  if (freqMax <= 0) return 0;
  const freqMin = Math.max(0, Math.min(frequencyRange.min, frequencyRange.max)) / 100;
  const freqSpread = Math.max(0, freqMax - freqMin);
  const seed = normalizeGlyphJitterSeed(state.glyphJitterSeed);
  const saltNorm = normalizeGlyphSalt(glyphSalt);
  const saltMixX = saltNorm | 1;
  const saltMixY = ((saltNorm >>> 1) | 1);

  const cellXBase = ((pageIndex + 1) * 4099 + rowMu) | 0;
  const cellYBase = ((col + 1) * 6151) | 0;
  const cellX = saltNorm ? (cellXBase ^ Math.imul(saltMixX, 0x27D4EB2F)) | 0 : cellXBase;
  const cellY = saltNorm ? (cellYBase ^ Math.imul(saltMixY, 0x165667B1)) | 0 : cellYBase;

  const freqSample = hash2(cellX, cellY, (seed ^ 0x9E3779B1) ^ saltNorm);
  const freqThreshold = freqMin + freqSpread * freqSample;
  const occurrenceRand = hash2(
    cellX ^ 0x51F15EED,
    cellY ^ 0xC0FFEE,
    (seed ^ 0x85EBCA77) ^ (saltNorm >>> 1),
  );
  if (occurrenceRand >= freqThreshold) return 0;

  const amountSpread = Math.max(0, amountRange.max - amountRange.min);
  const amplitudeSample = hash2(
    cellX ^ 0xA511E9,
    cellY ^ 0x1B873593,
    (seed ^ 0xC2B2AE3D) ^ (saltNorm << 1),
  );
  const directionSample = hash2(
    cellX ^ 0x27D4EB2F,
    cellY ^ 0x165667B1,
    (seed ^ 0x68E31DA4) ^ (saltNorm >>> 2),
  );

  const amplitudePct = Math.max(0, amountRange.min + amountSpread * amplitudeSample);
  if (amplitudePct <= 0) return 0;
  const rawOffset = (amplitudePct / 100) * lineHeight;
  if (rawOffset <= 0) return 0;
  const sign = directionSample < 0.5 ? -1 : 1;
  return rawOffset * sign;
}

export function computeGlyphBaselineCharacterOffset(
  state,
  pageIndex,
  rowMu,
  col,
  glyphChar,
  gridHeight,
  glyphSalt = 0,
) {
  const lineHeight = Number(gridHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0;

  const aboveChars = typeof state?.glyphBaselineOffsetAboveChars === 'string'
    ? state.glyphBaselineOffsetAboveChars
    : GLYPH_BASELINE_OFFSET_DEFAULTS.aboveChars;
  const belowChars = typeof state?.glyphBaselineOffsetBelowChars === 'string'
    ? state.glyphBaselineOffsetBelowChars
    : GLYPH_BASELINE_OFFSET_DEFAULTS.belowChars;
  if (!aboveChars && !belowChars) return 0;

  const direction = resolveBaselineDirection(glyphChar, aboveChars, belowChars);
  if (!direction) return 0;

  const range = direction < 0
    ? normalizeGlyphBaselineOffsetRange(
      state?.glyphBaselineOffsetAboveRangePct,
      GLYPH_BASELINE_OFFSET_DEFAULTS.aboveRangePct,
    )
    : normalizeGlyphBaselineOffsetRange(
      state?.glyphBaselineOffsetBelowRangePct,
      GLYPH_BASELINE_OFFSET_DEFAULTS.belowRangePct,
    );
  const amountMin = Math.max(0, Math.min(range.min, range.max));
  const amountSpread = Math.max(0, range.max - amountMin);
  if (amountMin <= 0 && amountSpread <= 0) return 0;

  const seed = normalizeGlyphJitterSeed(state?.glyphJitterSeed);
  const saltNorm = normalizeGlyphSalt(glyphSalt);
  const saltMixX = saltNorm | 1;
  const saltMixY = ((saltNorm >>> 1) | 1);
  const glyphCode = typeof glyphChar === 'string' && glyphChar
    ? ((glyphChar.codePointAt(0) || 0) >>> 0)
    : 0;

  const cellXBase = ((pageIndex + 1) * 1619 + rowMu) | 0;
  const cellYBase = ((col + 1) * 3571) | 0;
  const mixedXBase = (cellXBase ^ Math.imul((glyphCode | 1), 0x45D9F3B)) | 0;
  const mixedYBase = (cellYBase ^ Math.imul((glyphCode | 1), 0x119DE1F3)) | 0;
  const cellX = saltNorm ? (mixedXBase ^ Math.imul(saltMixX, 0x27D4EB2F)) | 0 : mixedXBase;
  const cellY = saltNorm ? (mixedYBase ^ Math.imul(saltMixY, 0x165667B1)) | 0 : mixedYBase;

  const amountSample = hash2(
    cellX ^ 0xB5297A4D,
    cellY ^ 0x68E31DA4,
    (seed ^ 0x1B873593) ^ (saltNorm << 2) ^ glyphCode,
  );
  const amountPct = Math.max(0, amountMin + amountSpread * amountSample);
  if (amountPct <= 0) return 0;

  const rawOffset = (amountPct / 100) * lineHeight;
  if (rawOffset <= 0) return 0;
  return rawOffset * direction;
}
