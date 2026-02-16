function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function countConcurrentFullPaints(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return 1;
  let count = 0;
  for (const page of pages) {
    if (!page?.active || !page?.fullPaintInProgress) continue;
    count += 1;
  }
  return Math.max(1, count);
}

function scaleLoadFactor(renderScale) {
  if (!Number.isFinite(renderScale) || renderScale <= 0) return 1;
  if (renderScale <= 2) return 1;
  const normalized = clamp((renderScale - 2) / 3, 0, 1);
  return 1 - normalized * 0.55;
}

function baseYieldInterval(renderScale) {
  if (!Number.isFinite(renderScale) || renderScale <= 0) return 48;
  if (renderScale >= 5) return 6;
  if (renderScale >= 4) return 8;
  if (renderScale >= 3) return 12;
  if (renderScale >= 2.25) return 20;
  if (renderScale >= 1.5) return 32;
  return 48;
}

export function computeFullPaintCadence({
  pages,
  renderScale,
  safari = false,
  baseBudgetMs,
} = {}) {
  const baseBudget = Number.isFinite(baseBudgetMs) && baseBudgetMs > 0
    ? baseBudgetMs
    : (safari ? 10 : 14);
  const concurrentFullPaints = countConcurrentFullPaints(pages);
  const loadFactor = scaleLoadFactor(renderScale);
  const sliceBudgetMs = clamp((baseBudget * loadFactor) / concurrentFullPaints, 2.5, baseBudget);
  const intervalBase = baseYieldInterval(renderScale);
  const concurrencyDivider = Math.max(1, concurrentFullPaints - 0.25);
  const yieldCheckInterval = Math.round(clamp(intervalBase / concurrencyDivider, 4, 64));

  return {
    concurrentFullPaints,
    sliceBudgetMs,
    yieldCheckInterval,
  };
}
