import { clamp } from './math.js';

function resolveLineStepMu(lineStepMu, fallbackLineStepMu = 1) {
  if (Number.isFinite(lineStepMu) && lineStepMu > 0) return lineStepMu;
  if (Number.isFinite(fallbackLineStepMu) && fallbackLineStepMu > 0) {
    return fallbackLineStepMu;
  }
  return 1;
}

export function computeLineStepPx(gridHeight, lineStepMu, fallbackLineStepMu = 1) {
  const unitPx = Number.isFinite(gridHeight) && gridHeight > 0 ? gridHeight : 1;
  return unitPx * resolveLineStepMu(lineStepMu, fallbackLineStepMu);
}

export function snapTopMarginToLineStepPx(valuePx, {
  lineStepPx,
  minPx = 0,
  maxPx = Number.POSITIVE_INFINITY,
} = {}) {
  const min = Number.isFinite(minPx) ? minPx : 0;
  const max = Number.isFinite(maxPx) ? Math.max(min, maxPx) : Number.POSITIVE_INFINITY;
  const candidate = Number.isFinite(valuePx) ? valuePx : 0;
  const bounded = clamp(candidate, min, max);
  const step = Number.isFinite(lineStepPx) && lineStepPx > 0 ? lineStepPx : null;
  if (!step) return bounded;
  const snapped = Math.round(bounded / step) * step;
  return clamp(snapped, min, max);
}

export function normalizeTopMarginPx(valuePx, {
  pageHeight,
  marginBottom,
  gridHeight,
  lineStepMu,
  fallbackLineStepMu = 1,
  lineStepPx,
} = {}) {
  const resolvedPageHeight = Number.isFinite(pageHeight) && pageHeight > 0
    ? pageHeight
    : Number.POSITIVE_INFINITY;
  const resolvedMarginBottom = Number.isFinite(marginBottom) ? Math.max(0, marginBottom) : 0;
  const resolvedLineStepPx = Number.isFinite(lineStepPx) && lineStepPx > 0
    ? lineStepPx
    : computeLineStepPx(gridHeight, lineStepMu, fallbackLineStepMu);
  const maxPx = Number.isFinite(resolvedPageHeight)
    ? Math.max(0, resolvedPageHeight - resolvedMarginBottom - resolvedLineStepPx)
    : resolvedPageHeight;
  return snapTopMarginToLineStepPx(valuePx, {
    lineStepPx: resolvedLineStepPx,
    minPx: 0,
    maxPx,
  });
}
