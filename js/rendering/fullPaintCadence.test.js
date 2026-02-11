import assert from 'node:assert/strict';
import { computeFullPaintCadence, countConcurrentFullPaints } from './fullPaintCadence.js';

assert.equal(countConcurrentFullPaints(), 1, 'Missing page list should default to one worker.');
assert.equal(
  countConcurrentFullPaints([
    { active: true, fullPaintInProgress: true },
    { active: true, fullPaintInProgress: false },
    { active: false, fullPaintInProgress: true },
  ]),
  1,
  'Only active pages in full paint should count toward concurrency.',
);
assert.equal(
  countConcurrentFullPaints([
    { active: true, fullPaintInProgress: true },
    { active: true, fullPaintInProgress: true },
  ]),
  2,
  'Multiple active full paints should be counted.',
);

const baseline = computeFullPaintCadence({
  renderScale: 1.2,
  pages: [{ active: true, fullPaintInProgress: true }],
  safari: false,
});
assert.equal(baseline.concurrentFullPaints, 1, 'Baseline should have one active full paint.');
assert.equal(baseline.sliceBudgetMs, 14, 'Baseline budget should match desktop default.');
assert.equal(baseline.yieldCheckInterval, 48, 'Baseline interval should stay large at low scale.');

const heavyScale = computeFullPaintCadence({
  renderScale: 4.8,
  pages: [{ active: true, fullPaintInProgress: true }],
  safari: false,
});
assert.ok(
  heavyScale.sliceBudgetMs < baseline.sliceBudgetMs,
  'High render scale should reduce per-frame paint budget.',
);
assert.ok(
  heavyScale.yieldCheckInterval < baseline.yieldCheckInterval,
  'High render scale should trigger more frequent budget checks.',
);

const heavyConcurrent = computeFullPaintCadence({
  renderScale: 4.8,
  pages: [
    { active: true, fullPaintInProgress: true },
    { active: true, fullPaintInProgress: true },
  ],
  safari: false,
});
assert.equal(heavyConcurrent.concurrentFullPaints, 2, 'Concurrent full paints should be reflected.');
assert.ok(
  heavyConcurrent.sliceBudgetMs < heavyScale.sliceBudgetMs,
  'Concurrent repaint should split frame budget further.',
);
assert.ok(
  heavyConcurrent.yieldCheckInterval <= heavyScale.yieldCheckInterval,
  'Concurrent repaint should not increase the check interval.',
);

const extreme = computeFullPaintCadence({
  renderScale: 9,
  pages: new Array(8).fill(0).map(() => ({ active: true, fullPaintInProgress: true })),
  safari: false,
});
assert.equal(extreme.sliceBudgetMs, 2.5, 'Budget should be clamped to a non-zero minimum.');
assert.equal(extreme.yieldCheckInterval, 4, 'Yield interval should clamp for extreme load.');

console.log('fullPaintCadence tests passed.');
