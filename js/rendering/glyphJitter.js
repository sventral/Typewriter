import {
  normalizeGlyphJitterAmount,
  normalizeGlyphJitterFrequency,
  normalizeGlyphJitterSeed,
} from '../config/glyphJitter.js';

function hash2(ix, iy, seed) {
  let h = seed | 0;
  h ^= Math.imul(ix | 0, 0x9E3779B1);
  h ^= Math.imul((iy | 0) ^ 0x85EBCA77, 0xC2B2AE3D);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export function computeGlyphJitterOffset(state, pageIndex, rowMu, col, gridHeight) {
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

  const cellX = ((pageIndex + 1) * 4099 + rowMu) | 0;
  const cellY = ((col + 1) * 6151) | 0;

  const freqSample = hash2(cellX, cellY, seed ^ 0x9E3779B1);
  const freqThreshold = freqMin + freqSpread * freqSample;
  const occurrenceRand = hash2(cellX ^ 0x51F15EED, cellY ^ 0xC0FFEE, seed ^ 0x85EBCA77);
  if (occurrenceRand >= freqThreshold) return 0;

  const amountSpread = Math.max(0, amountRange.max - amountRange.min);
  const amplitudeSample = hash2(cellX ^ 0xA511E9, cellY ^ 0x1B873593, seed ^ 0xC2B2AE3D);
  const directionSample = hash2(cellX ^ 0x27D4EB2F, cellY ^ 0x165667B1, seed ^ 0x68E31DA4);

  const amplitudePct = Math.max(0, amountRange.min + amountSpread * amplitudeSample);
  if (amplitudePct <= 0) return 0;
  const rawOffset = (amplitudePct / 100) * lineHeight;
  if (rawOffset <= 0) return 0;
  const sign = directionSample < 0.5 ? -1 : 1;
  const maxOffset = lineHeight * 0.25;
  const offset = rawOffset * sign;
  if (!Number.isFinite(maxOffset) || maxOffset <= 0) {
    return offset;
  }
  return Math.max(-maxOffset, Math.min(maxOffset, offset));
}
