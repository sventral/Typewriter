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

const { min, max, abs, floor, ceil, round, sin, cos, pow, hypot, imul } = Math;

// Inline fast hash for internal use to avoid function call overhead in hot loops
const fastHash2 = (x, y, seed) => {
  let h = imul(x, 374761393) ^ imul(y, 668265263) ^ seed;
  h = (h ^ (h >>> 13)) >>> 0;
  h = imul(h, 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
};

// Inline noise function with inlined smoothStep and lerp
const sampleSpeckValueNoiseFast = (x, y, seed) => {
  const xi = floor(x);
  const yi = floor(y);
  const xf = x - xi;
  const yf = y - yi;
  // smoothStep: t * t * (3 - 2 * t)
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  
  const h00 = fastHash2(xi, yi, seed);
  const h10 = fastHash2(xi + 1, yi, seed);
  const h01 = fastHash2(xi, yi + 1, seed);
  const h11 = fastHash2(xi + 1, yi + 1, seed);
  
  // lerp: a + (b - a) * t
  const nx0 = h00 + (h10 - h00) * sx;
  const nx1 = h01 + (h11 - h01) * sx;
  return nx0 + (nx1 - nx0) * sy;
};

// Unrolled octave sampling to avoid array iteration overhead
const sampleSpeckFieldFast = (xCss, yCss, detailCss, seed, quality) => {
  // Octave 1: freq 0.75, weight 0.28, off 17.31, -9.41, salt 0x13579BDF
  const freq0 = max(0.0001, detailCss * 0.75);
  let accum = sampleSpeckValueNoiseFast(
    xCss * freq0 + 17.31,
    yCss * freq0 - 9.41,
    seed ^ 0x13579BDF
  ) * 0.28;
  
  // Octave 2: freq 1, weight 0.46, off -3.77, 11.09, salt 0x2468ACE1
  if (quality >= 0.4) {
    const freq1 = max(0.0001, detailCss);
    accum += sampleSpeckValueNoiseFast(
      xCss * freq1 - 3.77,
      yCss * freq1 + 11.09,
      seed ^ 0x2468ACE1
    ) * 0.46;
  }

  // Octave 3: freq 1.92, weight 0.26, off 6.51, 4.22, salt 0x9E3779B9
  if (quality >= 0.8) {
    const freq2 = max(0.0001, detailCss * 1.92);
    accum += sampleSpeckValueNoiseFast(
      xCss * freq2 + 6.51,
      yCss * freq2 + 4.22,
      seed ^ 0x9E3779B9
    ) * 0.26;
  }

  // Normalize (weights sum to ~1.0) & Contrast
  return clamp01((accum - 0.5) * 1.25 + 0.5);
};

const SPECK_NOISE_OCTAVES = Object.freeze([
  { freq: 0.75, weight: 0.28, offsetX: 17.31, offsetY: -9.41, salt: 0x13579BDF },
  { freq: 1, weight: 0.46, offsetX: -3.77, offsetY: 11.09, salt: 0x2468ACE1 },
  { freq: 1.92, weight: 0.26, offsetX: 6.51, offsetY: 4.22, salt: 0x9E3779B9 },
]);
const SPECK_NOISE_WEIGHT_SUM = 1.0;

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
const SPECK_SUPERSAMPLE_OFFSETS = Object.freeze([
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
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
  'fill',
  'dropouts',
  'texture',
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

  function applyFillAdjustments(coverage, ctx) {
    const { w, h, alpha0, params, seed, gix, smul } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    const stageQuality = getStageQualityFromContext(ctx);
    const detailCssRaw = getDetailDensityCss(ctx);
    const detailCss = Math.max(MIN_DETAIL_DENSITY_CSS, detailCssRaw * stageQuality);
    
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
      detailCss,
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
        const a = alpha0[i] / 255;
        // e is edgeMask, still needs x,y
        const e = edgeMaskFn(alpha0, w, h, x, y);
        
        const p = toneDynamicsEn ? baseTile.data[i] : 0.5;
        const m = toneDynamicsEn ? microTile.data[i] : 0.5;
        const wobbleOffset = ribbonTile ? (ribbonTile.data[i] - 0.5) * wobbleRangeCss * 2 : 0;
        const bandCenterCss = baseBandCenterCss + wobbleOffset;
        
        let press = toneDynamicsEn
          ? inkPressMid + inkPressVar * (p - 0.5) * 2
          : 1;
        press = clampFn(press, 0.05, 1.6);
        let cov = a * press;
        
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
        const rimBoost = rimLUT[(e * 255) | 0];
        if (rimEn) cov += inkRim * rimBoost * (1 - cov);
        
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
    
    // Destructure params
    const pDrop = params.dropouts || {};
    const pEnable = params.enable || {};

    if (!pEnable.dropouts || !pDrop || pDrop.amount <= 0) return;
    
    const stageQuality = getStageQualityFromContext(ctx);
    const detailCss = getDetailDensityCss(ctx);
    const inside = dm?.raw?.inside;
    const widthPx = max(0.0001, pDrop.width * smul * dpPerCss);
    const dropScalePx = max(2 / detailCss, (pDrop.scale * smul) / detailCss);
    const dropThr = 1 - clamp01Fn(pDrop.streakDensity);
    const dropPw = clamp01Fn(pDrop.pinholeWeight);
    const dropoutHashDensity = max(0.1, 3 * stageQuality);
    const dropAmount = min(2, pDrop.amount);
    const dropPinhole = pDrop.pinhole;

    const dropoutTile = detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: dropScalePx,
      seed: seed ^ 0x51F1F1F1,
    });

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yCss = y * invDp;
      
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        if (alpha0[i] === 0) continue;
        
        const band = inside ? clamp01Fn(1 - ((inside[i] || 0) / widthPx)) : 0;
        const xCss = x * invDp;
        const nlf = dropoutTile.data[i];
        const streak = (nlf > dropThr ? 1 : 0) * band;
        const nhf = fastHash2(
          floor(xCss * detailCss * dropoutHashDensity + 7),
          floor(yCss * detailCss * dropoutHashDensity + 11),
          seed ^ 0xC0FFEE00,
        );
        const pinh = (nhf > 1 - dropPinhole ? 1 : 0) * (1 - band);
        const gap = clamp01Fn((1 - dropPw) * streak + dropPw * pinh);
        coverage[i] = clamp01Fn(max(0, 1 - dropAmount * gap) * coverage[i]);
      }
    }
  }

  function applyGrainSpeckTexture(coverage, ctx) {
    const { w, h, params, seed, alpha0 } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    
    // Destructure params
    const pEnable = params.enable || {};
    const pInk = params.ink || {};

    if (!pEnable.grainSpeck) return;
    
    const stageQuality = getStageQualityFromContext(ctx);
    const mottlingRaw = clamp(pInk.mottling ?? 0, 0, 1.5);
    const t = mottlingRaw / 1.5;
    const freqScale = 0.4 + t * 2.4;
    const detailCss = getDetailDensityCss(ctx, 1.5 * freqScale);
    
    let sampleOffsets = SPECK_SUBPIXEL_OFFSETS;
    if (stageQuality < 1) {
      const subsetCount = Math.max(1, Math.round(sampleOffsets.length * stageQuality));
      sampleOffsets = SPECK_SUBPIXEL_OFFSETS.slice(0, subsetCount);
    } else if (stageQuality > 1) {
      const extraCount = Math.min(
        SPECK_SUPERSAMPLE_OFFSETS.length,
        Math.round((stageQuality - 1) * SPECK_SUPERSAMPLE_OFFSETS.length),
      );
      sampleOffsets = extraCount > 0
        ? SPECK_SUBPIXEL_OFFSETS.concat(SPECK_SUPERSAMPLE_OFFSETS.slice(0, extraCount))
        : SPECK_SUBPIXEL_OFFSETS;
    }
    
    const microNoiseWeight = clamp01((stageQuality - 0.5) / 0.5);
    const sampleCount = sampleOffsets.length || 1;
    const invSampleCount = 1 / sampleCount;
    const speckSeed = seed ^ 0xBEEFCAFE;
    const microSeed = speckSeed ^ 0x7F4A7C15;
    
    const { speckDark = 0, speckLight = 0, speckGrayBias = 0 } = pInk;
    const darkGate = 0.85;
    const lightGate = 0.15;
    const invDarkSpan = 1 / (1 - darkGate);
    const invLightSpan = 1 / lightGate;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yBase = y * invDp;
      
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        if (alpha0[i] === 0) continue;
        
        const xBase = x * invDp;
        let darkAccum = 0;
        let lightAccum = 0;
        
        for (let s = 0; s < sampleCount; s++) {
          const offset = sampleOffsets[s];
          const xCss = xBase + offset[0] * invDp;
          const yCss = yBase + offset[1] * invDp;
          const baseMask = sampleSpeckFieldFast(xCss, yCss, detailCss, speckSeed, stageQuality);
          let microPerturb = 0;
          if (microNoiseWeight > 0) {
            const microMask = sampleSpeckValueNoiseFast(
              xCss * detailCss * 3.37 + 5.71,
              yCss * detailCss * 3.17 - 2.9,
              microSeed,
            );
            microPerturb = (microMask - 0.5) * 0.7 * microNoiseWeight;
          }
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
    
    const resolutionBias = dpPerCss < 1.5 ? -0.25 : 0;
    const effectiveTK = Math.max(0, tK + resolutionBias / dpPerCss);
    const thickenRadiusPx = (effectiveTK * 1.0 + 0.15) * dpPerCss;

    const softnessBase = 0.35 + 0.35 / Math.max(0.4, stageQuality + 0.4);
    const thickenSoftPx = softnessBase * 0.9;
    
    const seedThicken = (seed ^ 0xC1CE3E53) >>> 0;

    const usePatchMask = tK > 1e-6 && patchFillThicken < 0.999;
    const glyphSpanCss = Math.max(1, Math.max(w, h) * invDp);
    const cyclesAcrossGlyph = 0.5 + patchSizeThicken * 2.5;
    const freqCss = usePatchMask ? (cyclesAcrossGlyph / glyphSpanCss) : 0;
    
    const patchSoft = 0.15; 
    
    const originXCss = Number.isFinite(anchorX) ? anchorX : 0;
    const originYCss = Number.isFinite(anchorY) ? anchorY : 0;

    const useSupersampling = dpPerCss < 2.5;
    const samples = useSupersampling 
      ? [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]
      : [[0, 0]];

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

    // Convert flat loop to nested to allow hoisting
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
          if (centerEdgeEnabled && eK !== 0) cov *= clampFn(1 - eK * (1 - norm), 0, 3);
        }

        if (thickenRadiusPx > 0) {
          const insideDist = inside[i] || 0;
          const outsideDist = outside ? (outside[i] || 0) : 0;
          const signedDist = outsideDist > 0 ? outsideDist : -insideDist;

          if (signedDist > thickenRadiusPx + 2.0) {
            coverage[i] = clamp01Fn(cov);
            continue;
          }

          if (!usePatchMask && signedDist < -thickenRadiusPx - 2.0) {
            coverage[i] = 1;
            continue;
          }

          const xCssBase = (x * invDp) - originXCss;
          let accumThicken = 0;

          for (let s = 0; s < samples.length; s++) {
            const offset = samples[s];
            const sampleXCss = xCssBase + (offset[0] * invDp) + 0.123;
            const sampleYCss = yCssBase + (offset[1] * invDp) + 0.123;

            let maskVal = 1;
            if (usePatchMask) {
              const n = sampleSpeckValueNoiseFast(sampleXCss * freqCss, sampleYCss * freqCss, seedThicken);
              maskVal = clamp01Fn((patchFillThicken - n) / patchSoft); 
              maskVal = maskVal * maskVal * (3 - 2 * maskVal); // smoothStep
            }

            if (maskVal > 0.01) {
              const boldAlpha = applyDilateAlpha(signedDist, thickenRadiusPx, thickenSoftPx);
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

  function applyExperimentalFuzz(coverage, ctx) {
    const { w, h, params, alpha0, dm, seed, anchorX, anchorY } = ctx;
    const fuzzExp = params.fuzzExp || {};
    const fuzzEnabled = fuzzExp.enable !== false;
    const fuzzThicken = fuzzEnabled ? (fuzzExp.thicken || 0) : 0;
    const fuzzPatchFill = fuzzEnabled ? clamp(fuzzExp.patchFill ?? 1, 0, 1) : 0;
    const hasFuzz = fuzzEnabled && Math.abs(fuzzThicken) > 1e-6;
    if (!hasFuzz) return;

    const inside = dm?.raw?.inside;
    const outside = dm?.raw?.outside;
    const maxInside = dm?.getMaxInside ? dm.getMaxInside() : 0;
    if (!inside || maxInside <= 0) return;

    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    const stageQuality = getStageQualityFromContext(ctx);

    const fuzzThickenRadiusPx = (Math.max(0, fuzzThicken) * 0.75 + 0.12) * dpPerCss;
    
    const softnessBase = 0.35 + 0.35 / Math.max(0.4, stageQuality + 0.4);
    const fuzzSoftPx = softnessBase * 1.35;
    const seedFuzz = (seed ^ 0xF077F00D) >>> 0;
    const seedBleed = seedFuzz ^ 0x12345;

    const bleedFreq = 1.5;
    const fuzzFreq = 4.0;
    
    const originXCss = Number.isFinite(anchorX) ? anchorX : 0;
    const originYCss = Number.isFinite(anchorY) ? anchorY : 0;

    const useSupersampling = dpPerCss < 2.5;
    const samples = useSupersampling 
      ? [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]
      : [[0, 0]];

    const applyDilateAlpha = (signedDist, radiusPx, softPx) => {
      if (radiusPx <= 0) return 0;
      const span = Math.max(1e-6, softPx * 2);
      const shifted = signedDist - radiusPx;
      const t = clamp01Fn((-shifted + softPx) / span);
      return t * t * (3 - 2 * t);
    };

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yCssBase = (y * invDp) - originYCss;
      
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        const xCssBase = (x * invDp) - originXCss;

        const insideDist = inside[i] || 0;
        const outsideDist = outside ? (outside[i] || 0) : 0;
        const signedDist = outsideDist > 0 ? outsideDist : -insideDist;

        if (signedDist > fuzzThickenRadiusPx + 2.0) continue;
        if (signedDist < -fuzzThickenRadiusPx - 2.0 && coverage[i] >= 0.99) continue;

        let accumAlpha = 0;

        for (let s = 0; s < samples.length; s++) {
          const offset = samples[s];
          const sampleXCss = xCssBase + (offset[0] * invDp) + 0.123;
          const sampleYCss = yCssBase + (offset[1] * invDp) + 0.123;

          const bleedVal = sampleSpeckValueNoiseFast(sampleXCss * bleedFreq, sampleYCss * bleedFreq, seedBleed);
          const effectiveRadius = fuzzThickenRadiusPx * (bleedVal * 1.3);

          const noiseVal = sampleSpeckValueNoiseFast(sampleXCss * fuzzFreq, sampleYCss * fuzzFreq, seedFuzz);
          const noiseSoft = 0.15;
          
          let noiseAlpha = clamp01Fn((noiseVal - (fuzzPatchFill - noiseSoft * 0.5)) / noiseSoft);
          noiseAlpha = 1.0 - (noiseAlpha * noiseAlpha * (3 - 2 * noiseAlpha));

          if (fuzzPatchFill < 0.999) {
             const bleedVisibility = Math.max(0, (bleedVal - 0.6) * 3.0); 
             noiseAlpha = Math.max(noiseAlpha, bleedVisibility);
          }
          
          if (noiseAlpha > 0.01 || fuzzPatchFill >= 0.999) {
            let fuzzAlpha = applyDilateAlpha(signedDist, effectiveRadius, fuzzSoftPx);
            if (fuzzPatchFill < 0.999) {
              fuzzAlpha *= noiseAlpha;
            }
            accumAlpha += fuzzAlpha;
          }
        }

        const finalFuzzAlpha = accumAlpha / samples.length;
        if (finalFuzzAlpha > 0) {
          const cov = Math.max(coverage[i], finalFuzzAlpha);
          coverage[i] = clamp01Fn(cov);
        }
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

  function applyEdgeFuzz(coverage, ctx) {
    const { w, h, params, seed, smul, alpha0, dm } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    const cfg = params.edgeFuzz;
    if (!params.enable.edgeFuzz || !cfg || (cfg.inBand <= 0 && cfg.outBand <= 0)) return;
    const smulSafe = Math.max(1e-6, smul || 1);
    const detailCss = getDetailDensityCss(ctx);
    const ns = max(2 / detailCss, ((cfg.scale || 2) * smulSafe) / detailCss);
    const fuzzTile = detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: ns,
      seed: seed ^ 0x0F0F0F0F,
    });
    const derived = ensureDistanceDerived(ctx);
    const insideNorm = derived?.inside;
    const outsideNorm = derived?.outside;
    const insideRaw = dm?.raw?.inside;
    const outsideRaw = dm?.raw?.outside;
    const distScale = smulSafe * dpPerCss;
    
    // Destructure config
    const inBand = cfg.inBand;
    const outBand = cfg.outBand;
    const mix = cfg.mix;
    const rough = cfg.rough;
    const opacity = cfg.opacity;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yCss = y * invDp;
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        let covF = 0;
        const a = alpha0[i] / 255;
        if (a > 0 && inBand > 0) {
          if (insideNorm) {
            covF = max(
              covF,
              clamp01Fn(1 - (insideNorm[i] / Math.max(inBand, DISTANCE_DERIVED_EPSILON))),
            );
          } else if (insideRaw) {
            covF = max(
              covF,
              clamp01Fn(
                1 - ((insideRaw[i] || 0) / (Math.max(inBand, DISTANCE_DERIVED_EPSILON) * distScale)),
              ),
            );
          }
        }
        if (a === 0 && outBand > 0) {
          if (outsideNorm) {
            covF = max(
              covF,
              clamp01Fn(1 - (outsideNorm[i] / Math.max(outBand, DISTANCE_DERIVED_EPSILON))),
            );
          } else if (outsideRaw && outsideRaw[i] > 0) {
            covF = max(
              covF,
              clamp01Fn(
                1 - ((outsideRaw[i] || 0) / (Math.max(outBand, DISTANCE_DERIVED_EPSILON) * distScale)),
              ),
            );
          }
        }
        if (covF > 0) {
          const xCss = x * invDp;
          const vNoise = fuzzTile.data[i];
          const vHash = fastHash2(
            floor(xCss * detailCss),
            floor(yCss * detailCss),
            seed ^ 0xF00DFACE,
          );
          const blend = mix;
          const n = vNoise * (1 - blend) + vHash * blend;
          const jitter = 1 + rough * ((n - 0.5) * 2);
          const o = clampFn(opacity * covF * jitter, 0, 0.75);
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
    const smulSafe = Math.max(1e-6, smul || 1);
    const derived = ensureDistanceDerived(ctx);
    const outsideNorm = derived?.outside;
    const outsideNormal = derived?.outsideNormal;
    const outsideRaw = dm?.raw?.outside;
    if (!params.enable.smudge || !s || s.strength <= 0 || (!outsideNorm && !outsideRaw)) return;

    const radiusCss = Math.max(0.0001, s.radius);
    const scaleDp = smulSafe * dpPerCss;

    const detailCss = getDetailDensityCss(ctx);
    const ns = Math.max(2 / detailCss, (s.scale * smulSafe) / detailCss);
    const theta = (s.dirDeg || 0) * (Math.PI / 180);
    const dir = [Math.cos(theta), Math.sin(theta)];
    const smudgeTile = detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: ns,
      seed: seed ^ 0xDEADC0DE,
    });

    // Destructure params
    const sFalloff = s.falloff;
    const sDensity = s.density;
    const sStrength = s.strength;
    const sSpread = s.spread;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yCss = y * invDp;
      
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        const outsideDepth = outsideNorm
          ? outsideNorm[i]
          : ((outsideRaw?.[i] || 0) / scaleDp);
        if (!(outsideDepth > 0)) continue;
        if (outsideDepth > radiusCss) continue;

        let band = Math.max(0, 1 - (outsideDepth / radiusCss));
        band = Math.pow(band, Math.max(0.0001, 1 + sFalloff));

        const xCss = x * invDp;
        const n = smudgeTile.data[i];
        const gate = Math.max(0, (n - (1 - sDensity)) * (1 / (sDensity + 1e-4)));

        let ndotl = 0;
        if (outsideNormal) {
          const nx = outsideNormal[i * 2];
          const ny = outsideNormal[i * 2 + 1];
          ndotl = max(0, nx * dir[0] + ny * dir[1]);
        } else if (outsideRaw) {
          const g = gradOutFn(outsideRaw, w, h, x, y);
          ndotl = max(0, dotFn(g, dir[0], dir[1]) / lenFn(g));
        }
        const dirW = Math.pow(ndotl, Math.max(0.01, 1 - sSpread) * 2 + 0.5);

        const sm = sStrength * band * gate * dirW;
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