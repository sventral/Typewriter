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
import {
  createTextureKernels,
  SPECK_SUBPIXEL_OFFSETS,
  SPECK_SUPERSAMPLE_OFFSETS,
} from './textureKernels.js';
import { createDropoutsStage } from './dropoutsStage.js';
import { createTextureStage } from './textureStage.js';
import { createFuzzStages } from './fuzzStage.js';
import { createSmudgeStage } from './smudgeStage.js';

const { min, max, abs, floor, ceil, round, sin, cos, pow, hypot, imul } = Math;

const MIN_DETAIL_DENSITY_CSS = 2;
const DETAIL_MULTIPLIER = 2.6;
const MIN_DETAIL_SCALE = 0.05;
const MIN_STAGE_QUALITY = 0.05;
const MAX_STAGE_QUALITY = 2;
const DEFAULT_DETAIL_RESOLUTION = Object.freeze({
  threshold: 2.5,
  scale: 0.5,
  // ADDED: 'counterFill' to the list of stages that can run at low resolution
  stages: Object.freeze(['dropouts', 'texture', 'fuzz', 'smudge', 'counterFill']),
});

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
  const subStageQuality = new Map();
  const rawSubQuality = source.subStageQuality;
  if (rawSubQuality instanceof Map) {
    rawSubQuality.forEach((value, stageId) => {
      if (typeof stageId !== 'string' || !stageId) return;
      if (!value || typeof value !== 'object') return;
      subStageQuality.set(stageId, { ...value });
    });
  } else if (rawSubQuality && typeof rawSubQuality === 'object') {
    Object.entries(rawSubQuality).forEach(([stageId, value]) => {
      if (typeof stageId !== 'string' || !stageId) return;
      if (!value || typeof value !== 'object') return;
      subStageQuality.set(stageId, { ...value });
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
    subStageQuality,
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

  // Inline lerp
  const nx0 = v00 + (v10 - v00) * tx;
  const nx1 = v01 + (v11 - v01) * tx;
  return nx0 + (nx1 - nx0) * ty;
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

const DETAIL_GEOMETRY_KEY_PRECISION = 4;

const getDetailGeometryCache = ctx => {
  if (!ctx) return null;
  if (!ctx.__detailGeometryCache) {
    ctx.__detailGeometryCache = new Map();
  }
  return ctx.__detailGeometryCache;
};

const buildDetailDistanceMap = (dm, scale, width, height) => {
  if (!dm || !dm.raw) return null;
  const inside = dm.raw.inside;
  const outside = dm.raw.outside;
  const insideResult = inside ? downsampleFloat(inside, width, height, scale, true) : null;
  const outsideResult = outside ? downsampleFloat(outside, width, height, scale, true) : null;
  let maxInside = 0;
  if (insideResult && insideResult.data) {
    const arr = insideResult.data;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > maxInside) maxInside = arr[i];
    }
  } else if (typeof dm.getMaxInside === 'function') {
    maxInside = (dm.getMaxInside() || 0) * scale;
  }
  return {
    getInside: idx => (insideResult?.data ? insideResult.data[idx] : 0),
    getOutside: idx => (outsideResult?.data ? outsideResult.data[idx] : 0),
    getMaxInside: () => maxInside,
    raw: {
      inside: insideResult?.data || null,
      outside: outsideResult?.data || null,
    },
  };
};

const getOrCreateDetailGeometry = (ctx, scale) => {
  if (!ctx) return null;
  const { w, h } = ctx;
  if (!w || !h) return null;
  const dw = max(1, round(w * scale));
  const dh = max(1, round(h * scale));
  if (dw === w && dh === h) return null;
  const cache = getDetailGeometryCache(ctx);
  const key = `${dw}x${dh}:${scale.toFixed(DETAIL_GEOMETRY_KEY_PRECISION)}`;
  if (cache && cache.has(key)) {
    return cache.get(key);
  }
  const alphaResult = ctx.alpha0 ? downsampleUint8(ctx.alpha0, w, h, scale) : null;
  const geometry = {
    w: dw,
    h: dh,
    alpha: alphaResult?.data || new Uint8Array(dw * dh),
    dpPerCss: max(1e-6, (ctx.dpPerCss || 1) * scale),
    dm: buildDetailDistanceMap(ctx.dm, scale, w, h),
  };
  if (cache) {
    cache.set(key, geometry);
  }
  return geometry;
};

const DISTANCE_DERIVED_EPSILON = 1e-6;

const computeNormalizedGradient = (dist, w, h) => {
  if (!dist || w <= 0 || h <= 0) return null;
  const total = w * h;
  const grad = new Float32Array(total * 2);
  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    for (let x = 0; x < w; x++) {
      const idx = rowOffset + x;
      const center = dist[idx] || 0;
      const left = x > 0 ? (dist[idx - 1] || 0) : center;
      const right = x < w - 1 ? (dist[idx + 1] || 0) : center;
      const up = y > 0 ? (dist[idx - w] || 0) : center;
      const down = y < h - 1 ? (dist[idx + w] || 0) : center;
      let dx = left - right;
      let dy = up - down;
      const length = hypot(dx, dy);
      if (length > DISTANCE_DERIVED_EPSILON) {
        dx /= length;
        dy /= length;
      } else {
        dx = 0;
        dy = 0;
      }
      grad[idx * 2] = dx;
      grad[idx * 2 + 1] = dy;
    }
  }
  return grad;
};

const ensureDistanceDerived = ctx => {
  if (!ctx) return null;
  if (ctx.__distanceDerived !== undefined) {
    return ctx.__distanceDerived;
  }
  const { dm, w, h } = ctx;
  if (!dm || !dm.raw || !w || !h) {
    ctx.__distanceDerived = null;
    return null;
  }
  const smul = Math.max(DISTANCE_DERIVED_EPSILON, ctx.smul || 1);
  const dpPerCss = Math.max(DISTANCE_DERIVED_EPSILON, ctx.dpPerCss || 1);
  const normFactor = smul * dpPerCss;
  const result = {};
  let hasData = false;
  if (dm.raw.inside) {
    const insideSource = dm.raw.inside;
    const insideNorm = new Float32Array(w * h);
    for (let i = 0; i < insideNorm.length; i++) {
      insideNorm[i] = (insideSource[i] || 0) / normFactor;
    }
    result.inside = insideNorm;
    hasData = true;
  }
  if (dm.raw.outside) {
    const outsideSource = dm.raw.outside;
    const outsideNorm = new Float32Array(w * h);
    for (let i = 0; i < outsideNorm.length; i++) {
      outsideNorm[i] = (outsideSource[i] || 0) / normFactor;
    }
    result.outside = outsideNorm;
    result.outsideNormal = computeNormalizedGradient(outsideSource, w, h);
    hasData = true;
  }
  ctx.__distanceDerived = hasData ? result : null;
  return ctx.__distanceDerived;
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
    const rowOffset = y * baseWidth;
    for (let x = 0; x < baseWidth; x++) {
      const srcX = (x + 0.5) * scaleX - 0.5;
      const deltaSample = sampleBilinear(delta, lowWidth, lowHeight, srcX, srcY);
      const idx = rowOffset + x;
      coverage[idx] = clampCoverage(coverage[idx] + deltaSample);
    }
  }
};

const createDetailResolutionContext = (ctx, coverage, scale) => {
  if (!ctx || !coverage) return null;
  const baseWidth = ctx.w;
  const baseHeight = ctx.h;
  if (!baseWidth || !baseHeight) return null;
  const geometry = getOrCreateDetailGeometry(ctx, scale);
  if (!geometry) return null;

  const coverageLow = downsampleFloat(coverage, baseWidth, baseHeight, scale).data;
  const coverageBefore = coverageLow.slice();

  const detailCtx = { ...ctx };
  detailCtx.w = geometry.w;
  detailCtx.h = geometry.h;
  detailCtx.alpha0 = geometry.alpha;
  detailCtx.dpPerCss = geometry.dpPerCss;
  detailCtx.__detailDensity = undefined;
  detailCtx.__detailGeometryCache = undefined;
  detailCtx.__distanceDerived = undefined;
  detailCtx.dm = geometry.dm || ctx.dm;
  if (typeof ctx.stageQuality === 'number') {
    detailCtx.stageQuality = ctx.stageQuality;
  } else if ('stageQuality' in detailCtx) {
    delete detailCtx.stageQuality;
  }

  return {
    detailCtx,
    coverageLow,
    coverageBefore,
    lowWidth: geometry.w,
    lowHeight: geometry.h,
  };
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

export const GLYPH_PIPELINE_ORDER = Object.freeze([
  'init',
  'tone',
  'dropouts',
  'texture',
  'counterFill',
  'fuzzExp',
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

  const { fastHash2, sampleSpeckValueNoiseFast, sampleSpeckFieldFast } = createTextureKernels({
    clamp01: clamp01Fn,
  });

  const applyDropoutsMask = createDropoutsStage({
    clampFn,
    clamp01Fn,
    getStageQualityFromContext,
    getDetailDensityCss,
    detailNoiseCache,
    fastHash2,
  });

  const applyGrainSpeckTexture = createTextureStage({
    clampFn,
    clamp01Fn,
    getStageQualityFromContext,
    getDetailDensityCss,
    sampleSpeckFieldFast,
    sampleSpeckValueNoiseFast,
    subpixelOffsets: SPECK_SUBPIXEL_OFFSETS,
    supersampleOffsets: SPECK_SUPERSAMPLE_OFFSETS,
  });

  const { applyEdgeFuzz, applyExperimentalFuzz } = createFuzzStages({
    clampFn,
    clamp01Fn,
    sampleSpeckValueNoiseFast,
    getStageQualityFromContext,
    getDetailDensityCss,
    detailNoiseCache,
    ensureDistanceDerived,
    fastHash2,
    distanceEpsilon: DISTANCE_DERIVED_EPSILON,
  });

  const applySmudgeHalo = createSmudgeStage({
    getDetailDensityCss,
    detailNoiseCache,
    ensureDistanceDerived,
    gradOutFn,
    dotFn,
    lenFn,
  });


  function applyInit(coverage, ctx) {
    const { w, h, alpha0 } = ctx;
    const len = w * h;
    for (let i = 0; i < len; i++) {
      coverage[i] = alpha0[i] / 255;
    }
  }

  function applyToneAdjustments(coverage, ctx) {
    const { w, h, alpha0, params, seed, gix, smul } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    const stageQualityBase = getStageQualityFromContext(ctx);
    const subQualities = ctx?.subStageQuality || {};
    const toneQuality = clampStageQuality(subQualities['filters.variations'] ?? stageQualityBase);
    const ribbonQuality = clampStageQuality(subQualities['filters.ribbon'] ?? stageQualityBase);
    const rimQuality = clampStageQuality(subQualities['filters.rim'] ?? stageQualityBase);
    const detailCssRaw = getDetailDensityCss(ctx);
    const detailCss = Math.max(MIN_DETAIL_DENSITY_CSS, detailCssRaw * toneQuality);
    
    // Destructuring params
    const pNoise = params.noise || {};
    const pInk = params.ink || {};
    const pEnable = params.enable || {};
    const pRibbon = params.ribbon || {};

    const lfScale = Math.max(1e-6, (pNoise.lfScale * smul) / detailCss);
    const hfScale = Math.max(1e-6, (pNoise.hfScale * smul) / detailCss);
    const gammaLUT = getGamma(pInk.inkGamma);
    const rimLUT = getRim(pInk.rimCurve);
    
    const toneCoreEn = !!pEnable.toneCore;
    const toneDynamicsEn = toneCoreEn && pEnable.toneDynamics !== false;
    const ribbonEn = toneCoreEn && pEnable.ribbonBands !== false;
    const rimEn = !!pEnable.rim;
    
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
    const ribbonBandCfg = ribbonEn ? normalizeRibbonBandConfig(pRibbon) : DEFAULT_RIBBON_BAND;
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
      detailCss: Math.max(MIN_DETAIL_DENSITY_CSS, detailCssRaw * ribbonQuality),
      width: w,
      height: h,
      dpPerCss,
      scale: Math.max(1e-6, (glyphHeightCss / Math.max(0.1, ribbonBandCfg.height)) * 0.35),
      seed: seed ^ 0xD15EA5E,
      xOffset: (gix || 0) * 17,
      yOffset: (gix || 0) * 5,
    }) : null;

    // Destructure ink params for loop
    const inkPressMid = pInk.pressureMid;
    const inkPressVar = pInk.pressureVar;
    const inkToneJitter = pInk.toneJitter;
    const inkRim = pInk.rim;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yCss = y * invDp;
      
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        let cov = coverage[i];
        
        const p = toneDynamicsEn ? baseTile.data[i] : 0.5;
        const m = toneDynamicsEn ? microTile.data[i] : 0.5;
        const wobbleOffset = ribbonTile ? (ribbonTile.data[i] - 0.5) * wobbleRangeCss * 2 : 0;
        const bandCenterCss = baseBandCenterCss + wobbleOffset;
        
        let press = toneDynamicsEn
          ? inkPressMid + inkPressVar * (p - 0.5) * 2
          : 1;
        press = clampFn(press, 0.05, 1.6);
        
        cov *= press;
        
        if (toneDynamicsEn) cov *= 1 + inkToneJitter * ((m - 0.5) * 2);
        
        if (applyRibbon) {
          const dist = Math.abs(yCss - bandCenterCss);
          let bandWeight = 0;
          if (dist < bandHalfCss) {
            if (dist <= innerRadius) {
              bandWeight = 1;
            } else {
              const t = clamp01Fn((dist - innerRadius) / edgeSpan);
              // smoothStep inline
              const ss = t * t * (3 - 2 * t);
              bandWeight = 1 - ss;
            }
          }
          if (bandWeight > 0) {
            const modifier = 1 + bandStrength * bandWeight;
            cov *= modifier <= 0 ? 0 : modifier;
          }
        }
        
        cov *= rhythm; // pre-calculated rhythm
        const e = edgeMaskFn(alpha0, w, h, x, y);
        const rimBoost = rimLUT[(e * 255) | 0];
        if (rimEn) cov += inkRim * rimQuality * rimBoost * (1 - cov);
        
        if (toneDynamicsEn) {
          const idx = (clamp01Fn(cov) * 255) | 0;
          cov = gammaLUT[idx];
        }
        coverage[i] = clamp01Fn(cov);
      }
    }
  }


function applyCenterEdgeShape(coverage, ctx) {
    const { w, h, params, alpha0, dm, seed, anchorX, anchorY } = ctx;
    const centerEdgeCfg = params.centerEdge || {};
    const centerEdgeEnabled = !!params.enable.centerEdge;
    
    // Destructure config
    const cK = centerEdgeCfg.center || 0;
    const eK = centerEdgeCfg.edge || 0;
    const tK = centerEdgeCfg.thicken || 0;
    const patchFillThicken = clamp(centerEdgeCfg.patchFill ?? 1, 0, 1);
    const patchSizeThicken = clamp(centerEdgeCfg.patchSize ?? 0.5, 0, 1);
    
    const hasCenterEdgeShaping = Math.abs(cK) > 1e-6 || Math.abs(eK) > 1e-6;
    const centerEdgeActive = centerEdgeEnabled && (hasCenterEdgeShaping || (tK > 1e-6 && patchFillThicken > 0));

    if (!centerEdgeActive) return;
    const inside = dm?.raw?.inside;
    const outside = dm?.raw?.outside;
    const maxInside = dm?.getMaxInside ? dm.getMaxInside() : 0;
    if (!inside || maxInside <= 0) return;

    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    const stageQuality = getStageQualityFromContext(ctx);
    
    const thickenRadiusPx = tK > 1e-6 ? (Math.max(0, tK) * 1.0 + 0.15) * dpPerCss : 0;

    // OPTIMIZATION: Increased base softness to smooth out the discrete distance map steps
    const softnessBase = 0.35 + 0.35 / Math.max(0.4, stageQuality + 0.4);
    const thickenSoftPx = softnessBase * 1.2; // Increased from 0.9
    
    const seedThicken = (seed ^ 0xC1CE3E53) >>> 0;
    // New seed for micro-dithering
    const seedDither = (seed ^ 0x77777777) >>> 0;

    const usePatchMask = tK > 1e-6 && patchFillThicken < 0.999;
    const glyphSpanCss = Math.max(1, Math.max(w, h) * invDp);
    const cyclesAcrossGlyph = 0.5 + patchSizeThicken * 2.5;
    const freqCss = usePatchMask ? (cyclesAcrossGlyph / glyphSpanCss) : 0;
    
    const patchSoft = 0.15; 
    
    const originXCss = Number.isFinite(anchorX) ? anchorX : 0;
    const originYCss = Number.isFinite(anchorY) ? anchorY : 0;

    // OPTIMIZATION: Widen the sampling kernel slightly (0.35 instead of 0.25)
    // to blur the underlying grid artifacts more effectively.
    const samples = [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]];

    const applyDilateAlpha = (signedDist, radiusPx, softPx) => {
      if (radiusPx <= 0) return 0;
      const span = Math.max(1e-6, softPx * 2);
      const shifted = signedDist - radiusPx;
      const t = clamp01Fn((-shifted + softPx) / span);
      // smoothStep inline
      return t * t * (3 - 2 * t);
    };

    const quantLevels = stageQuality >= 1
      ? Math.max(8, Math.round(8 + (stageQuality - 1) * 12))
      : Math.max(2, Math.round(2 + stageQuality * 10));

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yCssBase = (y * invDp) - originYCss;
      
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        
        let norm = (inside[i] || 0) / maxInside;
        if (quantLevels > 1) {
          const steps = quantLevels - 1;
          norm = clamp((Math.round(norm * steps) / steps) || 0, 0, 1);
        }
        
        let cov = coverage[i];
        const hasAlpha = alpha0[i] !== 0;
        
        if (hasAlpha && hasCenterEdgeShaping) {
          if (centerEdgeEnabled && cK !== 0) cov *= clampFn(1 + cK * norm, 0, 3);
          if (centerEdgeEnabled && eK !== 0) cov *= clampFn(1 - (eK * 2.0) * (1 - norm), 0, 3);
        }

        if (thickenRadiusPx > 0) {
          const centerInside = inside[i] || 0;
          const centerOutside = outside ? (outside[i] || 0) : 0;
          const centerSigned = centerOutside > 0 ? centerOutside : -centerInside;

          // Optimization: Skip if far outside radius
          if (centerSigned > thickenRadiusPx + 2.5) {
            coverage[i] = clamp01Fn(cov);
            continue;
          }

          // Optimization: If deep inside, we are solid.
          if (!usePatchMask && centerSigned < -thickenRadiusPx - 2.5) {
            coverage[i] = 1;
            continue;
          }

          const xCssBase = (x * invDp) - originXCss;
          let accumThicken = 0;

          // VISUAL FIX: Add micro-dithering to the radius.
          // This breaks up the stair-stepping of the discrete distance map.
          // Range +/- 0.35px is enough to hide grid alignment without looking noisy.
          const dither = (fastHash2(x, y, seedDither) - 0.5) * 0.7; 
          const effectiveRadius = thickenRadiusPx + dither;

          for (let s = 0; s < samples.length; s++) {
            const offset = samples[s];
            
            const sx = x + offset[0];
            const sy = y + offset[1];
            
            const dInside = sampleBilinear(inside, w, h, sx, sy);
            const dOutside = outside ? sampleBilinear(outside, w, h, sx, sy) : 0;
            const dSigned = dOutside > 0 ? dOutside : -dInside;

            const sampleXCss = xCssBase + (offset[0] * invDp) + 0.123;
            const sampleYCss = yCssBase + (offset[1] * invDp) + 0.123;

            let maskVal = 1;
            if (usePatchMask) {
              const n = sampleSpeckValueNoiseFast(sampleXCss * freqCss, sampleYCss * freqCss, seedThicken);
              maskVal = clamp01Fn((patchFillThicken - n) / patchSoft); 
              maskVal = maskVal * maskVal * (3 - 2 * maskVal); // smoothStep
            }

            if (maskVal > 0.01) {
              const boldAlpha = applyDilateAlpha(dSigned, effectiveRadius, thickenSoftPx);
              accumThicken += boldAlpha * maskVal;
            }
          }

          const finalThickenAlpha = accumThicken / samples.length;
          cov = Math.max(cov, finalThickenAlpha);
        }

        coverage[i] = clamp01Fn(cov);
      }
    }
  }


function applyCounterFill(coverage, ctx) {
  const { w, h, params, alpha0, seed, smul } = ctx;
  const cfg = params.counterFill || {};
  const enabled = params.enable?.counterFill;
  const fillRadius = cfg.fill || 0;
  const opacity = clamp01Fn(cfg.transparency ?? 0.9);
  const coverageThreshold = clamp01Fn(cfg.coverage ?? 1.0);
  const noiseStrength = clamp01Fn(cfg.noise ?? 0);

  if (!enabled || fillRadius <= 0.01 || opacity <= 0.01) return;

  const smulSafe = Math.max(1e-6, smul || 1);
  const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
  const invDp = 1 / dpPerCss;

  const radiusPx = fillRadius * 12.0 * smulSafe * dpPerCss;
  
  // OPTIMIZATION: Cap the search radius to prevent cubic scaling explosion at high zoom.
  // 32px is sufficient to find most counters even at high resolution.
  const effectiveRadiusPx = Math.min(radiusPx, 32);
  const radiusInt = Math.ceil(effectiveRadiusPx);
  const searchLimit = radiusInt + 1;

  const noiseSeed = seed ^ 0xCF11CF11;
  const grainSeed = seed ^ 0x62A1D5ED;
  const detailCss = getDetailDensityCss(ctx, 0.6);
  const grainCss = getDetailDensityCss(ctx, 2.4);

  const pixels = alpha0;
  const outsideDist = ctx.dm?.raw?.outside;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w;
    const yCss = y * invDp;

    for (let x = 0; x < w; x++) {
      const i = rowOffset + x;

      if (pixels[i] > 20) continue;

      let dist = 0;
      if (outsideDist) {
        dist = outsideDist[i];
        if (dist > effectiveRadiusPx * 1.25) continue;
      }

      let dL = searchLimit, dR = searchLimit;
      let dU = searchLimit, dD = searchLimit;
      let dTL = searchLimit, dBR = searchLimit;
      let dTR = searchLimit, dBL = searchLimit;

      for (let r = 1; r < searchLimit; r++) {
        if (dL === searchLimit) {
          const tx = x - r;
          if (tx >= 0 && pixels[rowOffset + tx] > 20) dL = r;
        }
        if (dR === searchLimit) {
          const tx = x + r;
          if (tx < w && pixels[rowOffset + tx] > 20) dR = r;
        }
        if (dL < searchLimit && dR < searchLimit) break;
      }

      for (let r = 1; r < searchLimit; r++) {
        if (dU === searchLimit) {
          const ty = y - r;
          if (ty >= 0 && pixels[ty * w + x] > 20) dU = r;
        }
        if (dD === searchLimit) {
          const ty = y + r;
          if (ty < h && pixels[ty * w + x] > 20) dD = r;
        }
        if (dU < searchLimit && dD < searchLimit) break;
      }

      for (let r = 1; r < searchLimit; r++) {
        if (dTL === searchLimit) {
          const tx = x - r, ty = y - r;
          if (tx >= 0 && ty >= 0 && pixels[ty * w + tx] > 20) dTL = r;
        }
        if (dBR === searchLimit) {
          const tx = x + r, ty = y + r;
          if (tx < w && ty < h && pixels[ty * w + tx] > 20) dBR = r;
        }
        if (dTL < searchLimit && dBR < searchLimit) break;
      }

      for (let r = 1; r < searchLimit; r++) {
        if (dTR === searchLimit) {
          const tx = x + r, ty = y - r;
          if (tx < w && ty >= 0 && pixels[ty * w + tx] > 20) dTR = r;
        }
        if (dBL === searchLimit) {
          const tx = x - r, ty = y + r;
          if (tx >= 0 && ty < h && pixels[ty * w + tx] > 20) dBL = r;
        }
        if (dTR < searchLimit && dBL < searchLimit) break;
      }

      const gapH = dL + dR;
      const gapV = dU + dD;
      const gapD1 = (dTL + dBR) * 1.414;
      const gapD2 = (dTR + dBL) * 1.414;
      const maxGap = effectiveRadiusPx * 2.5;

      const calcScore = (gap) => {
        if (gap >= maxGap) return 0;
        const t = 1.0 - (gap / maxGap);
        return t * t * t;
      };

      const sH = calcScore(gapH);
      const sV = calcScore(gapV);
      const sD1 = calcScore(gapD1);
      const sD2 = calcScore(gapD2);

      let enclosure = (sH + sV + sD1 + sD2) * 0.25;

      enclosure = Math.pow(enclosure, 2.5);

      const minGap = Math.min(gapH, gapV, gapD1, gapD2);
      const tightThreshold = effectiveRadiusPx * 0.9;
      if (minGap < tightThreshold) {
        const boost = 1.0 - (minGap / tightThreshold);
        enclosure = Math.min(1.0, enclosure + boost * 0.4);
      }

      const strictness = 1.0 - coverageThreshold;
      const acceptanceThreshold = 0.05 + strictness * 0.35;

      const acceptanceFade = 0.1;
      let intensity = 0;
      if (enclosure > acceptanceThreshold + acceptanceFade) {
        intensity = 1;
      } else if (enclosure < acceptanceThreshold - acceptanceFade) {
        intensity = 0;
      } else {
        const t = (enclosure - (acceptanceThreshold - acceptanceFade)) / (acceptanceFade * 2);
        intensity = t * t * (3 - 2 * t);
      }

      if (intensity <= 0.001) continue;

      const xCss = x * invDp;
      const n = sampleSpeckValueNoiseFast(xCss * detailCss, yCss * detailCss, noiseSeed);
      const nGrain = sampleSpeckValueNoiseFast(xCss * grainCss, yCss * grainCss, grainSeed);

      const solidity = clamp01Fn((enclosure + coverageThreshold * 0.5) * 1.2);

      const fuzzRange = effectiveRadiusPx * 0.35;
      const distJitter = (n - 0.5) * fuzzRange;
      const effectiveDist = Math.max(0, dist + distJitter);

      const dNorm = clamp01Fn(effectiveDist / (effectiveRadiusPx * 1.1));
      const meniscus = (1.0 - dNorm);
      const surfaceTension = meniscus * meniscus;

      const texturedAlpha = 1.0 - (1.0 - nGrain) * noiseStrength;

      const fillAlpha = opacity * intensity * surfaceTension * texturedAlpha;

      const existing = coverage[i];
      coverage[i] = existing + fillAlpha * (1 - existing);
    }
  }
}

  function createPunchSet(ctx) {
    const { w, h, params, seed, dm, alpha0 } = ctx;
    const pPunch = params.punch || {};
    if (!params.enable.punch || !pPunch || pPunch.intensity <= 0) return null;
    const inside = dm?.raw?.inside;
    const maxInside = dm?.getMaxInside ? dm.getMaxInside() : 0;
    const rng = mulberry32Factory((seed ^ 0xC71C71C7) >>> 0);
    const cnt = max(0, pPunch.count | 0);
    if (cnt <= 0) return null;
    const rmin = max(0.001, min(pPunch.rMin, pPunch.rMax));
    const rmax = max(rmin, pPunch.rMax);
    const b = clampFn(pPunch.edgeBias || 0, -1, 1);
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
      const soft = (pPunch.soft || 0) * max(ax, ay);
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
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
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

  const stageRegistry = {
    init: applyInit,
    tone: applyToneAdjustments,
    dropouts: applyDropoutsMask,
    texture: applyGrainSpeckTexture,
    counterFill: applyCounterFill,
    fuzzExp: applyExperimentalFuzz,
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
      ctx.subStageQuality = detailResolutionConfig?.subStageQuality?.get(id) || null;
      if (detailResolutionConfig && shouldRunDetailStageLowRes(id, ctx, detailResolutionConfig)) {
        runDetailStageAtResolution(id, fn, coverage, ctx, detailResolutionConfig, clamp01Fn);
      } else {
        fn(coverage, ctx);
      }
      ctx.stageQuality = undefined;
      ctx.subStageQuality = undefined;
    }
  };

  return {
    stageRegistry,
    pipelineOrder: GLYPH_PIPELINE_ORDER,
    applyInit,
    applyToneAdjustments,
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
