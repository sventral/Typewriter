import assert from 'node:assert/strict';
import { createExperimentalStagePipeline } from './stagePipeline.js';

const approxEqual = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const pipeline = createExperimentalStagePipeline({
  detailResolution: { threshold: 2, scale: 0.5, stages: ['texture'], stageScaleMap: { texture: 0.5 } },
});

let recordedCtx = null;
pipeline.stageRegistry.texture = (coverage, ctx) => {
  recordedCtx = { w: ctx.w, h: ctx.h, dpPerCss: ctx.dpPerCss };
  for (let i = 0; i < coverage.length; i++) {
    coverage[i] = Math.min(1, coverage[i] + 0.25);
  }
};

const makeContext = dpPerCss => ({
  w: 4,
  h: 4,
  alpha0: new Uint8Array(16),
  dpPerCss,
  params: {},
});

const coverageBaseline = new Float32Array(16).fill(0.2);
recordedCtx = null;
pipeline.runPipeline(coverageBaseline, makeContext(1.2), ['texture']);
assert.ok(recordedCtx, 'Stage should run in baseline test.');
assert.equal(recordedCtx.w, 4, 'Width should remain full resolution below threshold.');
assert.equal(recordedCtx.h, 4, 'Height should remain full resolution below threshold.');
assert.ok(
  approxEqual(recordedCtx.dpPerCss, 1.2, 1e-6),
  'dpPerCss should not change below threshold.',
);
for (let i = 0; i < coverageBaseline.length; i++) {
  assert.ok(
    approxEqual(coverageBaseline[i], 0.45, 1e-5),
    `Baseline coverage mismatch at index ${i}.`,
  );
}

const coverageDownsampled = new Float32Array(16).fill(0.2);
recordedCtx = null;
pipeline.runPipeline(coverageDownsampled, makeContext(3.1), ['texture']);
assert.ok(recordedCtx, 'Stage should run in downsampled test.');
assert.equal(recordedCtx.w, 2, 'Width should downsample at high zoom.');
assert.equal(recordedCtx.h, 2, 'Height should downsample at high zoom.');
assert.ok(
  approxEqual(recordedCtx.dpPerCss, 3.1 * 0.5, 1e-6),
  'dpPerCss should scale with detail resolution.',
);
for (let i = 0; i < coverageDownsampled.length; i++) {
  assert.ok(
    approxEqual(coverageDownsampled[i], 0.45, 1e-5),
    `Downsampled coverage mismatch at index ${i}.`,
  );
}

const customPipeline = createExperimentalStagePipeline({
  detailResolution: { threshold: 2, scale: 0.5, stages: ['texture'], stageScaleMap: { texture: 0.25 } },
});

let customRecordedCtx = null;
customPipeline.stageRegistry.texture = (coverage, ctx) => {
  customRecordedCtx = { w: ctx.w, h: ctx.h, dpPerCss: ctx.dpPerCss };
  for (let i = 0; i < coverage.length; i++) {
    coverage[i] = Math.min(1, coverage[i] + 0.1);
  }
};

const coverageCustom = new Float32Array(16).fill(0.1);
customRecordedCtx = null;
customPipeline.runPipeline(coverageCustom, makeContext(3.2), ['texture']);
assert.ok(customRecordedCtx, 'Custom pipeline should run.');
assert.equal(customRecordedCtx.w, 1, 'Stage should respect override scale for width.');
assert.equal(customRecordedCtx.h, 1, 'Stage should respect override scale for height.');
assert.ok(
  approxEqual(customRecordedCtx.dpPerCss, 3.2 * 0.25, 1e-6),
  'Stage-specific quality scale should adjust dpPerCss.',
);

const lowDpPipeline = createExperimentalStagePipeline({
  detailResolution: { threshold: 2.5, scale: 0.5, stages: ['texture'], stageScaleMap: { texture: 0.2 } },
});

let lowDpCtx = null;
lowDpPipeline.stageRegistry.texture = (coverage, ctx) => {
  lowDpCtx = { w: ctx.w, h: ctx.h, dpPerCss: ctx.dpPerCss };
};

const coverageLowDp = new Float32Array(16).fill(0.3);
lowDpCtx = null;
lowDpPipeline.runPipeline(coverageLowDp, makeContext(1.4), ['texture']);
assert.ok(lowDpCtx, 'Low dp pipeline should still run when quality forces it.');
assert.equal(lowDpCtx.w, 1, 'Low dp pipeline should downsample even below threshold.');
assert.equal(lowDpCtx.h, 1, 'Low dp pipeline should downsample height below threshold.');

console.log('stagePipeline detail resolution tests passed.');
