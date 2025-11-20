import { clamp } from '../utils/math.js';

export const PAGE_NUMBER_ALIGNMENTS = ['left', 'center', 'right'];

export function createDefaultPageNumberingSettings() {
  return {
    enabled: false,
    offsetLines: 1,
    alignment: 'center',
  };
}

export function sanitizePageNumberingSettings(raw, fallback = null) {
  const base = createDefaultPageNumberingSettings();
  const source = raw && typeof raw === 'object'
    ? raw
    : (fallback && typeof fallback === 'object' ? fallback : base);
  const alignment = PAGE_NUMBER_ALIGNMENTS.includes(source.alignment)
    ? source.alignment
    : base.alignment;
  const offsetLines = clamp(
    Math.max(0, Math.round(Number(source.offsetLines ?? base.offsetLines))),
    0,
    10000,
  );
  return {
    enabled: source.enabled === true,
    offsetLines,
    alignment,
  };
}
