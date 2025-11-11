import {
  TAU,
  clamp,
  clamp01,
  noise2,
  edgeMask,
  superellipseMask,
  gradOut,
  dot,
  len,
  getGammaLUT,
  getRimLUT,
  hash2,
  mulberry32,
  signOf,
} from './textureMath.js';
import { createDetailNoiseCache, globalDetailNoiseCache } from './detailNoiseCache.js';

const { min, max, abs, floor, ceil, round, sin, cos, pow } = Math;

const lerp = (a, b, t) => a + (b - a) * t;
const smoothStep = t => t * t * (3 - 2 * t);

const SPECK_NOISE_OCTAVES = Object.freeze([
  { freq: 0.75, weight: 0.28, offsetX: 17.31, offsetY: -9.41, salt: 0x13579BDF },
  { freq: 1, weight: 0.46, offsetX: -3.77, offsetY: 11.09, salt: 0x2468ACE1 },
  { freq: 1.92, weight: 0.26, offsetX: 6.51, offsetY: 4.22, salt: 0x9E3779B9 },
]);
const SPECK_NOISE_WEIGHT_SUM = SPECK_NOISE_OCTAVES.reduce((sum, octave) => sum + octave.weight, 0);

const MIN_DETAIL_DENSITY_CSS = 2;
const DETAIL_MULTIPLIER = 2.6;
const MIN_DETAIL_SCALE = 0.05;
const MIN_STAGE_QUALITY = 0.05;
const MAX_STAGE_QUALITY = 2;
const DEFAULT_DETAIL_RESOLUTION = Object.freeze({
  threshold: 2.5,
  scale: 0.5,
  stages: Object.freeze(['dropouts', 'texture', 'fuzz', 'smudge']),
});
const SPECK_SUBPIXEL_OFFSETS = Object.freeze([
  [0.1666667, 0.1666667],
  [0.6666667, 0.1666667],
  [0.1666667, 0.6666667],
  [0.6666667, 0.6666667],
]);

const DEFAULT_RIBBON_BAND = Object.freeze({
  height: 0.35,
  position: 0.55,
  delta: 0.12,
  fade: 0.65,
  wobble: 0.25,
});

const clampBandHeight = value => clamp(Number.isFinite(value) ? value : DEFAULT_RIBBON_BAND.height, 0.02, 1);
const clampBandDelta = value => clamp(Number.isFinite(value) ? value : DEFAULT_RIBBON_BAND.delta, -0.6, 0.6);
const clamp01WithFallback = (value, fallback) => clamp01(Number.isFinite(value) ? value : fallback);

function normalizeRibbonBandConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const candidate = source.band && typeof source.band === 'object' ? source.band : source;
  const hasModernKeys = ['height', 'position', 'delta', 'fade', 'wobble'].some(
    key => typeof candidate[key] === 'number',
  );
  if (!hasModernKeys) {
    const legacyPeriod = clamp(Number.isFinite(candidate.period) ? candidate.period : 12, 3, 30);
    const legacySharp = clamp01WithFallback(candidate.sharp, 0.15);
    return {
      height: clampBandHeight(legacyPeriod / 30),
      position: clamp01WithFallback(candidate.position, DEFAULT_RIBBON_BAND.position),
      delta: clampBandDelta(candidate.amp),
      fade: clamp01WithFallback(1 - legacySharp, DEFAULT_RIBBON_BAND.fade),
      wobble: clamp01WithFallback(candidate.wobble, DEFAULT_RIBBON_BAND.wobble),
    };
  }
  return {
    height: clampBandHeight(candidate.height),
    position: clamp01WithFallback(candidate.position, DEFAULT_RIBBON_BAND.position),
    delta: clampBandDelta(candidate.delta),
    fade: clamp01WithFallback(candidate.fade, DEFAULT_RIBBON_BAND.fade),
    wobble: clamp01WithFallback(candidate.wobble, DEFAULT_RIBBON_BAND.wobble),
  };
}

const ensureDetailDensity = ctx => {
  if (!ctx) {
    return { css: MIN_DETAIL_DENSITY_CSS };
  }
  if (!ctx.__detailDensity) {
    const smul = Number.isFinite(ctx.smul) ? max(1, ctx.smul) : 1;
    const css = max(MIN_DETAIL_DENSITY_CSS, smul * DETAIL_MULTIPLIER);
    ctx.__detailDensity = { css };
  }
  return ctx.__detailDensity;
};

const getDetailDensityCss = (ctx, boost = 1) => ensureDetailDensity(ctx).css * boost;

const getStageQualityFromContext = ctx => clampStageQuality(typeof ctx?.stageQuality === 'number' ? ctx.stageQuality : 1);

const clampScale = (value, minValue, maxValue) =>
  Number.isFinite(value) ? clamp(value, minValue, maxValue) : maxValue;

const clampStageQuality = value => clamp(Number.isFinite(value) ? value : 1, MIN_STAGE_QUALITY, MAX_STAGE_QUALITY);

const normalizeDetailResolutionConfig = raw => {
  if (raw === false) return null;
  const source = raw && typeof raw === 'object' ? raw : DEFAULT_DETAIL_RESOLUTION;
  const threshold = Number.isFinite(source.threshold)
    ? max(0, source.threshold)
    : DEFAULT_DETAIL_RESOLUTION.threshold;
  const scale = clampScale(source.scale, MIN_DETAIL_SCALE, 1);
  if (scale >= 0.999) {
    return {
      threshold,
      scale: 1,
      stages: new Set(),
      stageScaleMap: new Map(),
      stageQualityMap: new Map(),
    };
  }
  const stagesArray = Array.isArray(source.stages) && source.stages.length
    ? source.stages
    : DEFAULT_DETAIL_RESOLUTION.stages;
  const stageSet = new Set();
  stagesArray.forEach(stage => {
    if (typeof stage === 'string' && stage) {
      stageSet.add(stage);
    }
  });
  if (!stageSet.size) {
    DEFAULT_DETAIL_RESOLUTION.stages.forEach(stage => stageSet.add(stage));
  }
  const stageScaleMap = new Map();
  const rawScaleMap = source.stageScaleMap || source.stageScales;
  if (rawScaleMap instanceof Map) {
    rawScaleMap.forEach((value, stageId) => {
      if (typeof stageId !== 'string' || !stageId) return;
      stageScaleMap.set(stageId, clampScale(value, MIN_DETAIL_SCALE, 1));
    });
  } else if (rawScaleMap && typeof rawScaleMap === 'object') {
    Object.entries(rawScaleMap).forEach(([stageId, value]) => {
      if (typeof stageId !== 'string' || !stageId) return;
      stageScaleMap.set(stageId, clampScale(value, MIN_DETAIL_SCALE, 1));
    });
  }
  if (!stageScaleMap.size) {
    stageSet.forEach(stageId => {
      stageScaleMap.set(stageId, scale);
    });
  }
  const stageQualityMap = new Map();
  const rawQualityMap = source.stageQualityMap || source.stageQuality || source.stageQualities;
  if (rawQualityMap instanceof Map) {
    rawQualityMap.forEach((value, stageId) => {
      if (typeof stageId !== 'string' || !stageId) return;
      stageQualityMap.set(stageId, clampStageQuality(value));
    });
  } else if (rawQualityMap && typeof rawQualityMap === 'object') {
    Object.entries(rawQualityMap).forEach(([stageId, value]) => {
      if (typeof stageId !== 'string' || !stageId) return;
      stageQualityMap.set(stageId, clampStageQuality(value));
    });
  }
  if (!stageQualityMap.size) {
    stageSet.forEach(stageId => {
      stageQualityMap.set(stageId, 1);
    });
  }
  return {
    threshold,
    scale,
    stages: stageSet,
    stageScaleMap,
    stageQualityMap,
  };
};

const resolveStageScale = (config, stageId) => {
  if (!config) return 1;
  if (config.stageScaleMap && config.stageScaleMap.has(stageId)) {
    return clampScale(config.stageScaleMap.get(stageId), MIN_DETAIL_SCALE, 1);
  }
  return clampScale(config.scale, MIN_DETAIL_SCALE, 1);
};

const resolveStageQuality = (config, stageId) => {
  if (!config) return 1;
  if (config.stageQualityMap && config.stageQualityMap.has(stageId)) {
    return clampStageQuality(config.stageQualityMap.get(stageId));
  }
  return 1;
};

const sampleBilinear = (data, width, height, x, y) => {
  if (!data || width <= 0 || height <= 0) return 0;
  const x0 = clamp(floor(x), 0, width - 1);
  const y0 = clamp(floor(y), 0, height - 1);
  const x1 = clamp(x0 + 1, 0, width - 1);
  const y1 = clamp(y0 + 1, 0, height - 1);
  const tx = clamp01(x - x0);
  const ty = clamp01(y - y0);
  const i00 = y0 * width + x0;
  const i10 = y0 * width + x1;
  const i01 = y1 * width + x0;
  const i11 = y1 * width + x1;
  const v00 = data[i00] ?? 0;
  const v10 = data[i10] ?? v00;
  const v01 = data[i01] ?? v00;
  const v11 = data[i11] ?? v01;
  const nx0 = lerp(v00, v10, tx);
  const nx1 = lerp(v01, v11, tx);
  return lerp(nx0, nx1, ty);
};

const downsampleUint8 = (data, width, height, scale) => {
  const dw = max(1, round(width * scale));
  const dh = max(1, round(height * scale));
  if (dw === width && dh === height) {
    return { data: new Uint8Array(data), width, height };
  }
  const result = new Uint8Array(dw * dh);
  const scaleX = width / dw;
  const scaleY = height / dh;
  for (let y = 0; y < dh; y++) {
    const srcY = (y + 0.5) * scaleY - 0.5;
    for (let x = 0; x < dw; x++) {
      const srcX = (x + 0.5) * scaleX - 0.5;
      const value = sampleBilinear(data, width, height, srcX, srcY);
      result[y * dw + x] = clamp(round(value), 0, 255);
    }
  }
  return { data: result, width: dw, height: dh };
};

const downsampleFloat = (data, width, height, scale, scaleValues = false) => {
  const dw = max(1, round(width * scale));
  const dh = max(1, round(height * scale));
  if (dw === width && dh === height) {
    const clone = new Float32Array(data.length);
    clone.set(data);
    if (scaleValues && scale !== 1) {
      for (let i = 0; i < clone.length; i++) clone[i] *= scale;
    }
    return { data: clone, width, height };
  }
  const result = new Float32Array(dw * dh);
  const scaleX = width / dw;
  const scaleY = height / dh;
  for (let y = 0; y < dh; y++) {
    const srcY = (y + 0.5) * scaleY - 0.5;
    for (let x = 0; x < dw; x++) {
      const srcX = (x + 0.5) * scaleX - 0.5;
      let value = sampleBilinear(data, width, height, srcX, srcY);
      if (scaleValues) value *= scale;
      result[y * dw + x] = value;
    }
  }
  return { data: result, width: dw, height: dh };
};

const applyLowResDeltaToCoverage = (
  coverage,
  baseWidth,
  baseHeight,
  lowAfter,
  lowBefore,
  lowWidth,
  lowHeight,
  clamp01Fn,
) => {
  const total = lowAfter.length;
  const delta = new Float32Array(total);
  for (let i = 0; i < total; i++) delta[i] = lowAfter[i] - lowBefore[i];
  const scaleX = lowWidth / baseWidth;
  const scaleY = lowHeight / baseHeight;
  const clampCoverage = typeof clamp01Fn === 'function' ? clamp01Fn : clamp01;
  for (let y = 0; y < baseHeight; y++) {
    const srcY = (y + 0.5) * scaleY - 0.5;
    for (let x = 0; x < baseWidth; x++) {
      const srcX = (x + 0.5) * scaleX - 0.5;
      const deltaSample = sampleBilinear(delta, lowWidth, lowHeight, srcX, srcY);
      const idx = y * baseWidth + x;
      coverage[idx] = clampCoverage(coverage[idx] + deltaSample);
    }
  }
};

const createDetailResolutionContext = (ctx, coverage, scale) => {
  if (!ctx || !coverage) return null;
  const { w, h, alpha0, dm } = ctx;
  if (!w || !h) return null;
  const dw = max(1, round(w * scale));
  const dh = max(1, round(h * scale));
  if (dw === w && dh === h) return null;

  const coverageLow = downsampleFloat(coverage, w, h, scale).data;
  const coverageBefore = coverageLow.slice();
  const alphaResult = alpha0 ? downsampleUint8(alpha0, w, h, scale) : null;

  let detailDm = null;
  if (dm && dm.raw) {
    const inside = dm.raw.inside;
    const outside = dm.raw.outside;
    const insideResult = inside ? downsampleFloat(inside, w, h, scale, true) : null;
    const outsideResult = outside ? downsampleFloat(outside, w, h, scale, true) : null;
    let maxInside = 0;
    if (insideResult && insideResult.data) {
      const arr = insideResult.data;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] > maxInside) maxInside = arr[i];
      }
    } else if (typeof dm.getMaxInside === 'function') {
      maxInside = (dm.getMaxInside() || 0) * scale;
    }
    detailDm = {
      getInside: idx => (insideResult?.data ? insideResult.data[idx] : 0),
      getOutside: idx => (outsideResult?.data ? outsideResult.data[idx] : 0),
      getMaxInside: () => maxInside,
      raw: {
        inside: insideResult?.data || null,
        outside: outsideResult?.data || null,
      },
    };
  }

  const detailCtx = { ...ctx };
  detailCtx.w = dw;
  detailCtx.h = dh;
  detailCtx.alpha0 = alphaResult?.data || new Uint8Array(dw * dh);
  detailCtx.dpPerCss = max(1e-6, (ctx.dpPerCss || 1) * scale);
  detailCtx.__detailDensity = undefined;
  if (typeof ctx.stageQuality === 'number') {
    detailCtx.stageQuality = ctx.stageQuality;
  }
  if (detailDm) detailCtx.dm = detailDm;

  return { detailCtx, coverageLow, coverageBefore, lowWidth: dw, lowHeight: dh };
};

const shouldRunDetailStageLowRes = (stageId, ctx, config) => {
  if (!config || !config.stages || !config.stages.size) return false;
  if (!config.stages.has(stageId)) return false;
  if (!ctx || !ctx.w || !ctx.h) return false;
  const dpPerCss = Math.max(1e-6, ctx.dpPerCss || 1);
  const stageScale = resolveStageScale(config, stageId);
  if (stageScale >= 0.999) return false;
  const baseScale = clampScale(config.scale, MIN_DETAIL_SCALE, 1);
  if (dpPerCss < config.threshold && stageScale >= baseScale - 1e-6) return false;
  if (ctx.w <= 2 || ctx.h <= 2) return false;
  return true;
};

const runDetailStageAtResolution = (stageId, stageFn, coverage, ctx, config, clamp01Fn) => {
  const stageScale = resolveStageScale(config, stageId);
  const detail = createDetailResolutionContext(ctx, coverage, stageScale);
  if (!detail) {
    stageFn(coverage, ctx);
    return;
  }
  stageFn(detail.coverageLow, detail.detailCtx);
  applyLowResDeltaToCoverage(
    coverage,
    ctx.w,
    ctx.h,
    detail.coverageLow,
    detail.coverageBefore,
    detail.lowWidth,
    detail.lowHeight,
    clamp01Fn,
  );
};

const sampleSpeckValueNoise = (hash2Fn, x, y, seed) => {
  const xi = floor(x);
  const yi = floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = smoothStep(xf);
  const sy = smoothStep(yf);
  const h00 = hash2Fn(xi, yi, seed);
  const h10 = hash2Fn(xi + 1, yi, seed);
  const h01 = hash2Fn(xi, yi + 1, seed);
  const h11 = hash2Fn(xi + 1, yi + 1, seed);
  const nx0 = lerp(h00, h10, sx);
  const nx1 = lerp(h01, h11, sx);
  return lerp(nx0, nx1, sy);
};

const sampleSpeckField = (hash2Fn, xCss, yCss, detailCss, seed) => {
  let accum = 0;
  for (let o = 0; o < SPECK_NOISE_OCTAVES.length; o++) {
    const octave = SPECK_NOISE_OCTAVES[o];
    const freq = max(0.0001, detailCss * octave.freq);
    const value = sampleSpeckValueNoise(
      hash2Fn,
      xCss * freq + octave.offsetX,
      yCss * freq + octave.offsetY,
      seed ^ octave.salt,
    );
    accum += value * octave.weight;
  }
  const normalized = accum / (SPECK_NOISE_WEIGHT_SUM || 1);
  const centered = normalized - 0.5;
  const contrast = 1.25;
  return clamp01(centered * contrast + 0.5);
};

export const GLYPH_PIPELINE_ORDER = Object.freeze([
  'fill',
  'dropouts',
  'texture',
  'centerEdge',
  'punch',
  'fuzz',
  'smudge',
]);

export function createExperimentalStagePipeline(deps = {}) {
  const {
    clamp: clampFn = clamp,
    clamp01: clamp01Fn = clamp01,
    noise2: noise2Fn = noise2,
    edgeMask: edgeMaskFn = edgeMask,
    superellipseMask: superellipseMaskFn = superellipseMask,
    gradOut: gradOutFn = gradOut,
    dot: dotFn = dot,
    len: lenFn = len,
    getGammaLUT: getGamma = getGammaLUT,
    getRimLUT: getRim = getRimLUT,
    hash2: hash2Fn = hash2,
    mulberry32: mulberry32Factory = mulberry32,
    TAU: tauConst = TAU,
    sign: signFn = signOf,
  } = deps;

  const detailNoiseCache =
    deps.detailNoiseCache || globalDetailNoiseCache || createDetailNoiseCache({ noise2: noise2Fn });
  const hasDetailConfig = Object.prototype.hasOwnProperty.call(deps, 'detailResolution');
  const detailResolutionConfig = normalizeDetailResolutionConfig(
    hasDetailConfig ? deps.detailResolution : undefined,
  );

  function applyFillAdjustments(coverage, ctx) {
    const { w, h, alpha0, params, seed, gix, smul } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    const stageQuality = getStageQualityFromContext(ctx);
    const detailCssRaw = getDetailDensityCss(ctx);
    const detailCss = Math.max(MIN_DETAIL_DENSITY_CSS, detailCssRaw * stageQuality);
    const lfScale = Math.max(1e-6, (params.noise.lfScale * smul) / detailCss);
    const hfScale = Math.max(1e-6, (params.noise.hfScale * smul) / detailCss);
    const gammaLUT = getGamma(params.ink.inkGamma);
    const rimLUT = getRim(params.ink.rimCurve);
    const toneCoreEn = !!params.enable.toneCore;
    const toneDynamicsEn = toneCoreEn && params.enable.toneDynamics !== false;
    const ribbonEn = toneCoreEn && params.enable.ribbonBands !== false;
    const rimEn = !!params.enable.rim;
    const rhythm = 1 + 0.08 * sin((gix % 23) / 23 * tauConst);
    const baseTile = toneDynamicsEn ? detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: lfScale,
      seed,
      xOffset: (gix || 0) * 13,
      yOffset: (gix || 0) * 7,
    }) : null;
    const microTile = toneDynamicsEn ? detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: hfScale,
      seed: seed ^ 0xA5A5A5A5,
      xMul: 1.7,
      yMul: 1.3,
      xOffset: seed,
      yOffset: -seed,
    }) : null;
    const glyphHeightCss = Math.max(1e-6, h * invDp);
    const ribbonBandCfg = ribbonEn ? normalizeRibbonBandConfig(params.ribbon) : DEFAULT_RIBBON_BAND;
    const bandStrength = ribbonEn ? ribbonBandCfg.delta : 0;
    const applyRibbon = ribbonEn && Math.abs(bandStrength) > 1e-3;
    const bandHalfCss = Math.max(1e-4, ribbonBandCfg.height * glyphHeightCss * 0.5);
    const fadeWidthCss = Math.max(bandHalfCss * 0.05, bandHalfCss * ribbonBandCfg.fade);
    const innerRadius = Math.max(0, bandHalfCss - fadeWidthCss);
    const edgeSpan = Math.max(1e-4, bandHalfCss - innerRadius);
    const baseBandCenterCss = clamp01(ribbonBandCfg.position) * glyphHeightCss;
    const wobbleAmount = ribbonBandCfg.wobble;
    const wobbleRangeCss = applyRibbon && wobbleAmount > 0 ? bandHalfCss * 0.8 * wobbleAmount : 0;
    const ribbonTile = wobbleRangeCss > 0 ? detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: Math.max(1e-6, (glyphHeightCss / Math.max(0.1, ribbonBandCfg.height)) * 0.35),
      seed: seed ^ 0xD15EA5E,
      xOffset: (gix || 0) * 17,
      yOffset: (gix || 0) * 5,
    }) : null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const xCss = x * invDp;
        const yCss = y * invDp;
        const a = alpha0[i] / 255;
        const e = edgeMaskFn(alpha0, w, h, x, y);
        const p = toneDynamicsEn ? baseTile.data[i] : 0.5;
        const m = toneDynamicsEn ? microTile.data[i] : 0.5;
        const wobbleOffset = ribbonTile ? (ribbonTile.data[i] - 0.5) * wobbleRangeCss * 2 : 0;
        const bandCenterCss = baseBandCenterCss + wobbleOffset;
        let press = toneDynamicsEn
          ? params.ink.pressureMid + params.ink.pressureVar * (p - 0.5) * 2
          : 1;
        press = clampFn(press, 0.05, 1.6);
        let cov = a * press;
        if (toneDynamicsEn) cov *= 1 + params.ink.toneJitter * ((m - 0.5) * 2);
        if (applyRibbon) {
          const dist = Math.abs(yCss - bandCenterCss);
          let bandWeight = 0;
          if (dist < bandHalfCss) {
            if (dist <= innerRadius) {
              bandWeight = 1;
            } else {
              const t = clamp01Fn((dist - innerRadius) / edgeSpan);
              bandWeight = 1 - smoothStep(t);
            }
          }
          if (bandWeight > 0) {
            const modifier = 1 + bandStrength * bandWeight;
            cov *= modifier <= 0 ? 0 : modifier;
          }
        }
        cov *= 1 + 0 * rhythm + rhythm - 1;
        const rimBoost = rimLUT[(e * 255) | 0];
        if (rimEn) cov += params.ink.rim * rimBoost * (1 - cov);
        if (toneDynamicsEn) {
          const idx = (clamp01Fn(cov) * 255) | 0;
          cov = gammaLUT[idx];
        }
        coverage[i] = clamp01Fn(cov);
      }
    }
  }

  function applyDropoutsMask(coverage, ctx) {
    const { w, h, params, seed, smul, alpha0, dm } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    if (!params.enable.dropouts || !params.dropouts || params.dropouts.amount <= 0) return;
    const detailCss = getDetailDensityCss(ctx);
    const inside = dm?.raw?.inside;
    const widthPx = max(0.0001, params.dropouts.width * smul * dpPerCss);
    const dropScalePx = max(2 / detailCss, (params.dropouts.scale * smul) / detailCss);
    const dropThr = 1 - clamp01Fn(params.dropouts.streakDensity);
    const dropPw = clamp01Fn(params.dropouts.pinholeWeight);
    const dropoutTile = detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: dropScalePx,
      seed: seed ^ 0x51F1F1F1,
    });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (alpha0[i] === 0) continue;
        const band = inside ? clamp01Fn(1 - ((inside[i] || 0) / widthPx)) : 0;
        const xCss = x * invDp;
        const yCss = y * invDp;
        const nlf = dropoutTile.data[i];
        const streak = (nlf > dropThr ? 1 : 0) * band;
        const nhf = hash2Fn(
          floor(xCss * detailCss * 3 + 7),
          floor(yCss * detailCss * 3 + 11),
          seed ^ 0xC0FFEE00,
        );
        const pinh = (nhf > 1 - params.dropouts.pinhole ? 1 : 0) * (1 - band);
        const gap = clamp01Fn((1 - dropPw) * streak + dropPw * pinh);
        const amt = min(2, params.dropouts.amount);
        coverage[i] = clamp01Fn(max(0, 1 - amt * gap) * coverage[i]);
      }
    }
  }

  function applyGrainSpeckTexture(coverage, ctx) {
    const { w, h, params, seed, alpha0 } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    if (!params.enable.grainSpeck) return;
    const detailCss = getDetailDensityCss(ctx, 1.5);
    const sampleOffsets = SPECK_SUBPIXEL_OFFSETS;
    const sampleCount = sampleOffsets.length || 1;
    const invSampleCount = 1 / sampleCount;
    const speckSeed = seed ^ 0xBEEFCAFE;
    const { speckDark = 0, speckLight = 0, speckGrayBias = 0 } = params.ink || {};
    const darkGate = 0.85;
    const lightGate = 0.15;
    const invDarkSpan = 1 / (1 - darkGate);
    const invLightSpan = 1 / lightGate;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (alpha0[i] === 0) continue;
        let darkAccum = 0;
        let lightAccum = 0;
        for (let s = 0; s < sampleCount; s++) {
          const offset = sampleOffsets[s];
          const xCss = (x + offset[0]) * invDp;
          const yCss = (y + offset[1]) * invDp;
          const baseMask = sampleSpeckField(hash2Fn, xCss, yCss, detailCss, speckSeed);
          const microMask = sampleSpeckValueNoise(
            hash2Fn,
            xCss * detailCss * 3.37 + 5.71,
            yCss * detailCss * 3.17 - 2.9,
            speckSeed ^ 0x7F4A7C15,
          );
          const microPerturb = (microMask - 0.5) * 0.7;
          const combinedMask = clamp01Fn(baseMask + microPerturb);
          const speckMask = clamp01Fn((combinedMask - 0.5) * 1.6 + 0.5);
          if (speckMask > darkGate) {
            darkAccum += (speckMask - darkGate) * invDarkSpan;
          }
          if (speckMask < lightGate) {
            lightAccum += (lightGate - speckMask) * invLightSpan;
          }
        }
        const affect = (1 - speckGrayBias) + speckGrayBias * (1 - coverage[i]);
        const interior = clamp01Fn(alpha0[i] / 255);
        const edgeFade = clamp01Fn(interior * interior * 1.1);
        const darkFactor = speckDark * affect * edgeFade * clamp01Fn(darkAccum * invSampleCount * 2.2);
        const lightFactor = speckLight * affect * edgeFade * clamp01Fn(lightAccum * invSampleCount * 2);
        let cov = coverage[i];
        cov = 1 - (1 - cov) * (1 - darkFactor);
        cov *= 1 - lightFactor;
        coverage[i] = clamp01Fn(cov);
      }
    }
  }

  function applyCenterEdgeShape(coverage, ctx) {
    const { w, h, params, alpha0, dm } = ctx;
    if (!params.enable.centerEdge || !params.centerEdge) return;
    const inside = dm?.raw?.inside;
    const maxInside = dm?.getMaxInside ? dm.getMaxInside() : 0;
    if (!inside || maxInside <= 0) return;
    const stageQuality = getStageQualityFromContext(ctx);
    const quantLevels = stageQuality >= 1
      ? Math.max(8, Math.round(8 + (stageQuality - 1) * 12))
      : Math.max(2, Math.round(2 + stageQuality * 10));
    const cK = params.centerEdge.center || 0;
    const eK = params.centerEdge.edge || 0;
    if (cK === 0 && eK === 0) return;
    for (let i = 0; i < w * h; i++) {
      if (alpha0[i] === 0) continue;
      let norm = (inside[i] || 0) / maxInside;
      if (quantLevels > 1) {
        const steps = quantLevels - 1;
        norm = clamp((Math.round(norm * steps) / steps) || 0, 0, 1);
      }
      let mod = 1;
      mod *= clampFn(1 + cK * norm, 0, 2);
      mod *= clampFn(1 - eK * (1 - norm), 0, 2);
      coverage[i] = clamp01Fn(coverage[i] * mod);
    }
  }

  function createPunchSet(ctx) {
    const { w, h, params, seed, dm, alpha0 } = ctx;
    if (!params.enable.punch || !params.punch || params.punch.intensity <= 0) return null;
    const inside = dm?.raw?.inside;
    const maxInside = dm?.getMaxInside ? dm.getMaxInside() : 0;
    const rng = mulberry32Factory((seed ^ 0xC71C71C7) >>> 0);
    const cnt = max(0, params.punch.count | 0);
    if (cnt <= 0) return null;
    const rmin = max(0.001, min(params.punch.rMin, params.punch.rMax));
    const rmax = max(rmin, params.punch.rMax);
    const b = clampFn(params.punch.edgeBias || 0, -1, 1);
    const mag = abs(b);
    const sgn = signFn(b);
    const baseScale = min(w, h);
    const sxN = baseScale / w;
    const syN = baseScale / h;

    const pickCenter = () => {
      for (let t = 0; t < 60; t++) {
        const cx = floor(rng() * w);
        const cy = floor(rng() * h);
        const i = cy * w + cx;
        if (alpha0[i] === 0) continue;
        if (mag > 0 && inside && maxInside > 0) {
          const norm = (inside[i] || 0) / (1e-6 + max(1, maxInside));
          const prefer = sgn > 0 ? 1 - norm : norm;
          const p = (1 - mag) + mag * prefer;
          if (rng() < p) return [cx / w, cy / h];
        } else {
          return [cx / w, cy / h];
        }
      }
      return [rng(), rng()];
    };

    const holes = [];
    for (let k = 0; k < cnt; k++) {
      const [cxN, cyN] = pickCenter();
      const r = rmin + rng() * (rmax - rmin);
      const anis = 0.8 + rng() * 0.4;
      const ax = r * sxN * anis;
      const ay = r * syN / anis;
      const rot = rng() * tauConst;
      const soft = (params.punch.soft || 0) * max(ax, ay);
      const minX = max(0, floor((cxN - ax - soft) * w));
      const maxX = min(w - 1, ceil((cxN + ax + soft) * w));
      const minY = max(0, floor((cyN - ay - soft) * h));
      const maxY = min(h - 1, ceil((cyN + ay + soft) * h));
      holes.push({ cx: cxN, cy: cyN, ax, ay, rot, soft, minX, maxX, minY, maxY });
    }
    return holes;
  }

  function applyPunchHolesMask(coverage, ctx, holes) {
    if (!holes || !holes.length) return;
    const { w, h, params, alpha0 } = ctx;
    const punchK = clampFn(params.punch?.intensity || 0, 0, 1.5);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (alpha0[i] === 0) continue;
        let hole = 0;
        for (const pf of holes) {
          if (x < pf.minX || x > pf.maxX || y < pf.minY || y > pf.maxY) continue;
          const nx = x / w - pf.cx;
          const ny = y / h - pf.cy;
          const v = superellipseMaskFn(nx, ny, pf.ax, pf.ay, pf.rot, 2);
          if (v < 1 + pf.soft) {
            const t = pf.soft > 0 ? clamp01Fn((1 + pf.soft - v) / pf.soft) : (v < 1 ? 1 : 0);
            if (t > hole) hole = t;
          }
        }
        if (hole > 0) {
          coverage[i] = clamp01Fn(max(0, coverage[i] * (1 - punchK * hole)));
        }
      }
    }
  }

  function applyEdgeFuzz(coverage, ctx) {
    const { w, h, params, seed, smul, alpha0, dm } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    const cfg = params.edgeFuzz;
    if (!params.enable.edgeFuzz || !cfg || (cfg.inBand <= 0 && cfg.outBand <= 0)) return;
    const inside = dm?.raw?.inside;
    const outside = dm?.raw?.outside;
    const detailCss = getDetailDensityCss(ctx);
    const ns = max(2 / detailCss, ((cfg.scale || 2) * smul) / detailCss);
    const fuzzTile = detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: ns,
      seed: seed ^ 0x0F0F0F0F,
    });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let covF = 0;
        const a = alpha0[i] / 255;
        if (a > 0 && cfg.inBand > 0 && inside) {
          covF = max(covF, clamp01Fn(1 - ((inside[i] || 0) / (cfg.inBand * smul * dpPerCss))));
        }
        if (a === 0 && cfg.outBand > 0 && outside && outside[i] > 0) {
          covF = max(covF, clamp01Fn(1 - ((outside[i] || 0) / (cfg.outBand * smul * dpPerCss))));
        }
        if (covF > 0) {
          const xCss = x * invDp;
          const yCss = y * invDp;
          const vNoise = fuzzTile.data[i];
          const vHash = hash2Fn(
            floor(xCss * detailCss),
            floor(yCss * detailCss),
            seed ^ 0xF00DFACE,
          );
          const blend = cfg.mix;
          const n = vNoise * (1 - blend) + vHash * blend;
          const jitter = 1 + cfg.rough * ((n - 0.5) * 2);
          const o = clampFn(cfg.opacity * covF * jitter, 0, 0.75);
          coverage[i] = 1 - (1 - coverage[i]) * (1 - clamp01Fn(o));
        }
      }
    }
  }

function applySmudgeHalo(coverage, ctx) {
  const { w, h, alpha0, params, smul, seed, dm } = ctx;
  const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
  const invDp = 1 / dpPerCss;
  const s = params.smudge;
  const outside = dm?.raw?.outside;
  if (!params.enable.smudge || !s || s.strength <= 0 || !outside) return;

  const R = Math.max(0.0001, s.radius * smul * dpPerCss);
  if (R <= 0) return;

  const detailCss = getDetailDensityCss(ctx);
  const ns = Math.max(2 / detailCss, (s.scale * smul) / detailCss);
  const theta = (s.dirDeg || 0) * (Math.PI / 180); // ← fix
  const dir = [Math.cos(theta), Math.sin(theta)];
  const smudgeTile = detailNoiseCache.getTile({
    detailCss,
    width: w,
    height: h,
    dpPerCss,
    scale: ns,
    seed: seed ^ 0xDEADC0DE,
  });

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!(outside[i] > 0)) continue;

      let band = Math.max(0, 1 - ((outside[i] || 0) / R));
      band = Math.pow(band, Math.max(0.0001, 1 + s.falloff));

      const xCss = x * invDp;
      const yCss = y * invDp;
      const n = smudgeTile.data[i];
      const gate = Math.max(0, (n - (1 - s.density)) * (1 / (s.density + 1e-4)));

      const g = gradOutFn(outside, w, h, x, y);
      const ndotl = Math.max(0, dotFn(g, dir[0], dir[1]) / lenFn(g));
      const dirW = Math.pow(ndotl, Math.max(0.01, 1 - s.spread) * 2 + 0.5);

      const sm = s.strength * band * gate * dirW;
      if (alpha0[i] === 0) {
        coverage[i] = Math.max(coverage[i], Math.min(1, sm));
      }
    }
  }
}

  const stageRegistry = {
    fill: applyFillAdjustments,
    dropouts: applyDropoutsMask,
    texture: applyGrainSpeckTexture,
    centerEdge: applyCenterEdgeShape,
    punch: (coverage, ctx) => {
      const holes = createPunchSet(ctx);
      applyPunchHolesMask(coverage, ctx, holes);
    },
    fuzz: applyEdgeFuzz,
    smudge: applySmudgeHalo,
  };

  const runPipeline = (coverage, ctx, order = GLYPH_PIPELINE_ORDER) => {
  const stages = Array.isArray(order) && order.length ? order : GLYPH_PIPELINE_ORDER;
  for (const id of stages) {
    const fn = stageRegistry[id];
    if (typeof fn !== 'function') continue;
    ctx.stageQuality = resolveStageQuality(detailResolutionConfig, id);
    if (detailResolutionConfig && shouldRunDetailStageLowRes(id, ctx, detailResolutionConfig)) {
      runDetailStageAtResolution(id, fn, coverage, ctx, detailResolutionConfig, clamp01Fn);
    } else {
      fn(coverage, ctx);
    }
    ctx.stageQuality = undefined;
  }
};

  return {
    stageRegistry,
    pipelineOrder: GLYPH_PIPELINE_ORDER,
    applyFillAdjustments,
    applyDropoutsMask,
    applyGrainSpeckTexture,
    applyCenterEdgeShape,
    applyPunchHolesMask,
    createPunchSet,
    applyEdgeFuzz,
    applySmudgeHalo,
    runPipeline,
  };
}

export function createExperimentalStageRegistry(deps = {}) {
  return createExperimentalStagePipeline(deps).stageRegistry;
}
