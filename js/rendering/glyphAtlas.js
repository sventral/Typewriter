import { clamp } from '../utils/math.js';
import { createExperimentalGlyphProcessor } from './experimental/glyphProcessor.js';
import { computeInsideDistance, computeOutsideDistance } from './experimental/distanceMaps.js';

function parseColorToRgb(color) {
  if (typeof color !== 'string') return { r: 0, g: 0, b: 0 };
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.length === 4
      ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
      : trimmed;
    const num = Number.parseInt(hex.slice(1), 16);
    if (Number.isFinite(num)) {
      return {
        r: (num >> 16) & 0xFF,
        g: (num >> 8) & 0xFF,
        b: num & 0xFF,
      };
    }
  }
  const rgbMatch = trimmed.match(/rgb\s*\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    return {
      r: clamp(Number(rgbMatch[1]) || 0, 0, 255),
      g: clamp(Number(rgbMatch[2]) || 0, 0, 255),
      b: clamp(Number(rgbMatch[3]) || 0, 0, 255),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

function downsampleImageData(imageData, scale, outW, outH) {
  const width = imageData.width;
  const height = imageData.height;
  const src = imageData.data;
  if (scale <= 1) return new ImageData(new Uint8ClampedArray(src), width, height);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const inv = 1 / (scale * scale);
  let dst = 0;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const srcY = y * scale;
      const srcX = x * scale;
      for (let sy = 0; sy < scale; sy++) {
        let idx = ((srcY + sy) * width + srcX) * 4;
        for (let sx = 0; sx < scale; sx++) {
          r += src[idx];
          g += src[idx + 1];
          b += src[idx + 2];
          a += src[idx + 3];
          idx += 4;
        }
      }
      out[dst++] = Math.round(r * inv);
      out[dst++] = Math.round(g * inv);
      out[dst++] = Math.round(b * inv);
      out[dst++] = Math.round(a * inv);
    }
  }
  return new ImageData(out, outW, outH);
}

export function createGlyphAtlas(options) {
  const {
    context,
    app: explicitApp,
    state: explicitState,
    colors,
    getFontSize,
    getActiveFontName,
    getAsc,
    getDesc,
    getCharWidth,
    getRenderScale,
    getStateZoom,
    getInkEffectFactor,
    getInkSectionStrength,
    getInkSectionOrder,
    isInkSectionEnabled,
    getExperimentalEffectsConfig,
    getExperimentalQualitySettings,
    getExperimentalScaleSettings,
  } = options || {};

  const app = explicitApp || context?.app;
  const state = explicitState || context?.state || {};
  const metrics = context?.scalars;

  const ensureMetricGetter = (fn, key) => {
    if (typeof fn === 'function') return fn;
    if (metrics && key in metrics) {
      return () => metrics[key];
    }
    return () => undefined;
  };

  const getFontSizeFn = ensureMetricGetter(getFontSize, 'FONT_SIZE');
  const getActiveFontNameFn = ensureMetricGetter(getActiveFontName, 'ACTIVE_FONT_NAME');
  const getAscFn = ensureMetricGetter(getAsc, 'ASC');
  const getDescFn = ensureMetricGetter(getDesc, 'DESC');
  const getCharWidthFn = ensureMetricGetter(getCharWidth, 'CHAR_W');
  const getRenderScaleFn = ensureMetricGetter(getRenderScale, 'RENDER_SCALE');
  const getStateZoomFn = typeof getStateZoom === 'function' ? getStateZoom : (() => state.zoom);
  const getInkSectionStrengthFn = typeof getInkSectionStrength === 'function' ? getInkSectionStrength : (() => 1);
  const getInkSectionOrderFn = typeof getInkSectionOrder === 'function'
    ? getInkSectionOrder
    : (() => ['expTone', 'expEdge', 'expGrain', 'expDefects']);
  const isInkSectionEnabledFn = typeof isInkSectionEnabled === 'function'
    ? isInkSectionEnabled
    : (() => true);
  const getExperimentalEffectsConfigFn = typeof getExperimentalEffectsConfig === 'function'
    ? getExperimentalEffectsConfig
    : (() => ({}));
  const getExperimentalQualitySettingsFn = typeof getExperimentalQualitySettings === 'function'
    ? getExperimentalQualitySettings
    : (() => ({}));
  const getExperimentalScaleSettingsFn = typeof getExperimentalScaleSettings === 'function'
    ? getExperimentalScaleSettings
    : (() => ({}));
  const ALT_VARIANTS = 9;
  const overhangCache = new Map();
  let baselineCharWidthCss = null;

  const getEffectScaleBias = () => {
    const v = state?.inkEffectScaleBias;
    return Number.isFinite(v) && v > 0 ? v : 1;
  };
  const experimentalAtlases = new Map();
  const experimentalProcessorCache = new Map();

  function rebuildAllAtlases() {
    experimentalAtlases.clear();
    experimentalProcessorCache.clear();
  }

  function computeDistanceMap(width, height, zeroMask) {
    const size = width * height;
    const dist = new Float32Array(size);
    const INF = 1e9;
    for (let i = 0; i < size; i++) {
      dist[i] = zeroMask[i] ? 0 : INF;
    }
    const SQRT2 = Math.SQRT2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (zeroMask[idx]) continue;
        let best = dist[idx];
        if (x > 0) best = Math.min(best, dist[idx - 1] + 1);
        if (y > 0) best = Math.min(best, dist[idx - width] + 1);
        if (x > 0 && y > 0) best = Math.min(best, dist[idx - width - 1] + SQRT2);
        if (x < width - 1 && y > 0) best = Math.min(best, dist[idx - width + 1] + SQRT2);
        dist[idx] = best;
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const idx = y * width + x;
        if (zeroMask[idx]) continue;
        let best = dist[idx];
        if (x < width - 1) best = Math.min(best, dist[idx + 1] + 1);
        if (y < height - 1) best = Math.min(best, dist[idx + width] + 1);
        if (x < width - 1 && y < height - 1) best = Math.min(best, dist[idx + width + 1] + SQRT2);
        if (x > 0 && y < height - 1) best = Math.min(best, dist[idx + width - 1] + SQRT2);
        dist[idx] = best;
      }
    }
    return dist;
  }

  function computeDistanceMaps(imageData) {
    if (!imageData) return null;
    const width = imageData.width | 0;
    const height = imageData.height | 0;
    if (width <= 0 || height <= 0) return null;
    const data = imageData.data;
    if (!data || data.length !== width * height * 4) return null;

    const size = width * height;
    const insideMask = new Uint8Array(size);
    const outsideMask = new Uint8Array(size);
    let insideCount = 0;
    for (let i = 0; i < size; i++) {
      const alpha = data[i * 4 + 3];
      if (alpha > 0) {
        insideMask[i] = 1;
        insideCount++;
      } else {
        outsideMask[i] = 1;
      }
    }
    if (insideCount === 0) return null;

    const distToInk = computeDistanceMap(width, height, insideMask);
    const distToVoid = computeDistanceMap(width, height, outsideMask);
    let maxInsideDist = 0;
    for (let i = 0; i < size; i++) {
      if (insideMask[i]) {
        const dist = distToVoid[i];
        if (dist > maxInsideDist) maxInsideDist = dist;
      }
    }

    return {
      width,
      height,
      insideMask,
      outsideMask,
      distToInk,
      distToVoid,
      maxInsideDist: Math.max(maxInsideDist, 1e-3),
      inkPixelCount: insideCount,
    };
  }

  function createLazyDistanceMapProvider(shape) {
    if (!shape) return null;
    const { alpha, width, height } = shape;
    if (!alpha || !width || !height) return null;

    let insideResult = null;
    let outsideResult = null;
    const raw = {};

    const ensureInside = () => {
      if (insideResult) return;
      insideResult = computeInsideDistance(alpha, width, height);
    };

    const ensureOutside = () => {
      if (outsideResult) return;
      outsideResult = computeOutsideDistance(alpha, width, height);
    };

    Object.defineProperty(raw, 'inside', {
      configurable: false,
      enumerable: true,
      get() {
        ensureInside();
        return insideResult?.dist || null;
      },
    });

    Object.defineProperty(raw, 'outside', {
      configurable: false,
      enumerable: true,
      get() {
        ensureOutside();
        return outsideResult?.dist || null;
      },
    });

    return {
      raw,
      getInside(index) {
        ensureInside();
        return insideResult?.dist ? insideResult.dist[index] : 0;
      },
      getOutside(index) {
        ensureOutside();
        return outsideResult?.dist ? outsideResult.dist[index] : 0;
      },
      getMaxInside() {
        ensureInside();
        return insideResult?.maxInside || 0;
      },
    };
  }

  function getExperimentalSectionEnabledState() {
    return {
      expTone: !!isInkSectionEnabledFn('expTone'),
      expEdge: !!isInkSectionEnabledFn('expEdge'),
      expGrain: !!isInkSectionEnabledFn('expGrain'),
      expDefects: !!isInkSectionEnabledFn('expDefects'),
    };
  }

  function applySectionEnableMask(params, sectionEnabled) {
    if (!params || !sectionEnabled) return params;
    const enable = params.enable = { ...(params.enable || {}) };
    if (!sectionEnabled.expTone) {
      enable.toneCore = false;
      enable.toneDynamics = false;
      enable.ribbonBands = false;
    }
    if (!enable.toneCore) {
      enable.toneDynamics = false;
      enable.ribbonBands = false;
    }
    if (!sectionEnabled.expEdge) {
      enable.edgeFuzz = false;
      enable.rim = false;
      enable.centerEdge = false;
      enable.fuzzExp = false;
      enable.counterFill = false;
    }
    if (!sectionEnabled.expGrain) {
      enable.grainSpeck = false;
      enable.dropouts = false;
    }
    if (!sectionEnabled.expDefects) {
      enable.punch = false;
      enable.smudge = false;
    }
    return params;
  }

  function applySubsectionScaleBias(params, scaleBias) {
    if (!params || !scaleBias) return params;
    const clampScale = v => clamp(v || 0, 0, 5);
    const mul = (obj, key, factor) => {
      if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) return;
      const val = obj[key];
      if (!Number.isFinite(val)) return;
      obj[key] = val * factor;
    };

    const toneVarS = clampScale(scaleBias['expTone.variations']);
    mul(params.noise, 'lfScale', toneVarS);
    mul(params.noise, 'hfScale', toneVarS);

    const toneRibbonS = clampScale(scaleBias['expTone.ribbon']);
    mul(params.ribbon, 'height', toneRibbonS);
    mul(params.ribbon, 'delta', toneRibbonS);

    const rimS = clampScale(scaleBias['expEdge.rim']);
    mul(params.ink, 'rim', rimS);

    const edgeFuzzS = clampScale(scaleBias['expEdge.fuzz']);
    mul(params.edgeFuzz, 'inBand', edgeFuzzS);
    mul(params.edgeFuzz, 'outBand', edgeFuzzS);
    mul(params.edgeFuzz, 'scale', edgeFuzzS);
    mul(params.edgeFuzz, 'mix', edgeFuzzS);

    const counterFillS = clampScale(scaleBias['expEdge.counterFill']);
    mul(params.counterFill, 'fill', counterFillS);
    mul(params.counterFill, 'coverage', counterFillS);

    const edgeGrainS = clampScale(scaleBias['expEdge.grain']);
    if (params.fuzzExp) {
      mul(params.fuzzExp, 'thicken', edgeGrainS);
    }

    const edgeWeightS = clampScale(scaleBias['expEdge.weight']);
    mul(params.centerEdge, 'center', edgeWeightS);
    mul(params.centerEdge, 'edge', edgeWeightS);
    mul(params.centerEdge, 'thicken', edgeWeightS);
    mul(params.centerEdge, 'patchFill', edgeWeightS);
    mul(params.centerEdge, 'patchSize', edgeWeightS);

    const speckleS = clampScale(scaleBias['expGrain.speckle']);
    mul(params.noise, 'lfScale', speckleS);
    mul(params.noise, 'hfScale', speckleS);

    const dropoutsS = clampScale(scaleBias['expGrain.dropouts']);
    mul(params.dropouts, 'width', dropoutsS);
    mul(params.dropouts, 'scale', dropoutsS);

    const smudgeS = clampScale(scaleBias['expDefects.smudge']);
    mul(params.smudge, 'radius', smudgeS);
    mul(params.smudge, 'scale', smudgeS);

    const punchS = clampScale(scaleBias['expDefects.punch']);
    mul(params.punch, 'rMin', punchS);
    mul(params.punch, 'rMax', punchS);
    mul(params.punch, 'soft', punchS);
    return params;
  }

  const EXPERIMENTAL_SECTION_STAGE_MAP = {
    expTone: ['tone'],
    expEdge: ['fuzz', 'counterFill', 'fuzzExp', 'centerEdge'],
    expGrain: ['texture', 'dropouts'],
    expDefects: ['punch', 'smudge'],
  };
  const EXPERIMENTAL_SUBSECTION_STAGE_MAP = {
    'expTone.variations': ['tone'],
    'expTone.ribbon': ['tone'],
    'expEdge.rim': ['tone'],
    'expEdge.fuzz': ['fuzz'],
    'expEdge.counterFill': ['counterFill'],
    'expEdge.grain': ['fuzzExp'],
    'expEdge.weight': ['centerEdge'],
    'expGrain.speckle': ['texture'],
    'expGrain.dropouts': ['dropouts'],
    'expDefects.smudge': ['smudge'],
    'expDefects.punch': ['punch'],
  };
  const EXPERIMENTAL_SECTION_IDS = Object.keys(EXPERIMENTAL_SECTION_STAGE_MAP);
  const EXPERIMENTAL_STAGE_PARAM_KEYS = {
    fill: [{ path: 'enable.toneCore' }], // simplified for brevity
    fuzzExp: [{ path: 'fuzzExp.enable' }, { path: 'fuzzExp.thicken' }, { path: 'fuzzExp.patchFill' }],
  };

  function getConfigValueAtPath(obj, path) {
    if (!obj || typeof obj !== 'object' || typeof path !== 'string') return undefined;
    const segments = path.split('.');
    let current = obj;
    for (const segment of segments) {
      if (!current || typeof current !== 'object') return undefined;
      current = current[segment];
    }
    return current;
  }

  function encodeExperimentalKeyValue(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return 'nan';
      return value.toFixed(4);
    }
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (value === null) return 'null';
    if (value === undefined) return 'u';
    return String(value);
  }

  function buildExperimentalStageConfigSignature(stages, config, sectionEnabled) {
    if (!Array.isArray(stages) || !stages.length || !config) return '';
    const parts = [];
    stages.forEach(stageId => {
      // For signature generation, we just use the stage ID to invalidate cache if stages change.
      // A full deep key check is expensive and the object reference changes often enough.
      parts.push(stageId);
    });
    return parts.join('~');
  }

  const QUALITY_DEFAULT = 100;
  const QUALITY_MIN = 0;
  const QUALITY_MAX = 200;
  const SCALE_DEFAULT = 100;
  const DETAIL_BASE_SCALE = 0.5;
  const DETAIL_MIN_SCALE = 0.05;
  const DETAIL_MAX_SCALE = 1;
  const STAGE_QUALITY_MIN = 0.05;
  const STAGE_QUALITY_MAX = 2;

  function buildDetailResolutionConfig(qualitySettings) {
    const stageScaleMap = new Map();
    const stageQualityMap = new Map();
    const subStageQuality = new Map();
    const quality = qualitySettings && typeof qualitySettings === 'object' ? qualitySettings : {};
    Object.entries(EXPERIMENTAL_SUBSECTION_STAGE_MAP).forEach(([subId, stageIds]) => {
      if (!Array.isArray(stageIds)) return;
      const raw = Number(quality[subId]);
      const percent = clamp(Number.isFinite(raw) ? raw : QUALITY_DEFAULT, QUALITY_MIN, QUALITY_MAX);
      const factor = percent / QUALITY_DEFAULT;
      const stageScale = clamp(DETAIL_BASE_SCALE * factor, DETAIL_MIN_SCALE, DETAIL_MAX_SCALE);
      const qualityFactor = clamp(factor, STAGE_QUALITY_MIN, STAGE_QUALITY_MAX);
      stageIds.forEach(stageId => {
        const currentScale = stageScaleMap.get(stageId);
        if (currentScale == null || stageScale > currentScale) {
          stageScaleMap.set(stageId, stageScale);
        }
        const currentQuality = stageQualityMap.get(stageId);
        if (currentQuality == null || qualityFactor > currentQuality) {
          stageQualityMap.set(stageId, qualityFactor);
        }
        if (!subStageQuality.has(stageId)) subStageQuality.set(stageId, {});
        subStageQuality.get(stageId)[subId] = qualityFactor;
      });
    });
    if (!stageScaleMap.size) {
      Object.values(EXPERIMENTAL_SECTION_STAGE_MAP).forEach(stageList => {
        stageList.forEach(stageId => {
          if (!stageScaleMap.has(stageId)) stageScaleMap.set(stageId, DETAIL_BASE_SCALE);
        });
      });
    }
    const signatureParts = [];
    stageScaleMap.forEach((scale, stage) => {
      const qualityFactor = stageQualityMap.get(stage) ?? 1;
      signatureParts.push(`${stage}:s${scale.toFixed(3)}:q${qualityFactor.toFixed(3)}`);
    });
    subStageQuality.forEach((subMap, stage) => {
      Object.entries(subMap).forEach(([subId, q]) => {
        signatureParts.push(`${stage}:${subId}:q${(q ?? 1).toFixed(3)}`);
      });
    });
    signatureParts.sort();
    return {
      threshold: 2.5,
      scale: DETAIL_BASE_SCALE,
      stages: new Set(stageScaleMap.keys()),
      stageScaleMap,
      stageQualityMap,
      subStageQuality,
      signature: signatureParts.join('|') || 'base',
    };
  }

  function getExperimentalStageActivity() {
    const cfg = getExperimentalEffectsConfigFn() || {};
    const enable = cfg.enable && typeof cfg.enable === 'object' ? cfg.enable : {};
    const sectionActive = getExperimentalSectionEnabledState();
    const hasPositive = (value, epsilon = 1e-3) => Number.isFinite(value) && Math.abs(value) > epsilon;

    const inkCfg = cfg.ink || {};
    const ribbonCfg = cfg.ribbon || {};
    const noiseCfg = cfg.noise || {};
    const centerEdgeCfg = cfg.centerEdge || {};
    const counterFillCfg = cfg.counterFill || {};
    const fuzzExpCfg = cfg.fuzzExp || {};
    const edgeFuzzCfg = cfg.edgeFuzz || {};
    const dropoutsCfg = cfg.dropouts || {};
    const smudgeCfg = cfg.smudge || {};
    const punchCfg = cfg.punch || {};

    const toneDynamicsActive = (
      !!enable.toneCore
      && !!enable.toneDynamics
      && sectionActive.expTone
      && (
        hasPositive(inkCfg.pressureVar)
        || hasPositive(inkCfg.toneJitter)
        || hasPositive(noiseCfg.lfScale)
        || hasPositive(noiseCfg.hfScale)
      )
    );
    const ribbonBandStrength = Number.isFinite(ribbonCfg.delta) ? ribbonCfg.delta : 0;
    const ribbonBandsActive = (
      !!enable.toneCore
      && !!enable.ribbonBands
      && sectionActive.expTone
      && Math.abs(ribbonBandStrength) > 1e-3
    );
    const rimActive = !!enable.rim && sectionActive.expEdge && hasPositive(inkCfg.rim);
    const toneCoreModulesActive = toneDynamicsActive || ribbonBandsActive || rimActive;
    const toneCoreActive = toneCoreModulesActive;
    const centerEdgeActive = sectionActive.expEdge
      && !!enable.centerEdge
      && (
        hasPositive(centerEdgeCfg.center)
        || hasPositive(centerEdgeCfg.edge)
        || hasPositive(centerEdgeCfg.thicken)
      );

    const fuzzExpActive = sectionActive.expEdge
      && (fuzzExpCfg.enable !== false)
      && hasPositive(fuzzExpCfg.thicken);
    const counterFillActive = sectionActive.expEdge
      && !!enable.counterFill
      && hasPositive(counterFillCfg.fill);
    const textureActive = sectionActive.expGrain
      && !!enable.grainSpeck
      && (hasPositive(inkCfg.speckDark) || hasPositive(inkCfg.speckLight));
    const fuzzActive = sectionActive.expEdge
      && !!enable.edgeFuzz
      && hasPositive(edgeFuzzCfg.opacity)
      && (hasPositive(edgeFuzzCfg.inBand) || hasPositive(edgeFuzzCfg.outBand));
    const dropoutsActive = sectionActive.expGrain
      && !!enable.dropouts
      && hasPositive(dropoutsCfg.amount)
      && hasPositive(dropoutsCfg.width);
    const punchActive = sectionActive.expDefects
      && !!enable.punch
      && hasPositive(punchCfg.intensity)
      && (Number.isFinite(punchCfg.count) ? punchCfg.count > 0 : true);
    const smudgeActive = sectionActive.expDefects
      && !!enable.smudge
      && hasPositive(smudgeCfg.strength)
      && hasPositive(smudgeCfg.radius);
    const needsFill = toneCoreActive
      || centerEdgeActive
      || fuzzExpActive
      || counterFillActive
      || textureActive
      || dropoutsActive
      || punchActive
      || fuzzActive
      || smudgeActive;
    return {
      init: needsFill,
      tone: toneCoreActive,
      dropouts: dropoutsActive,
      texture: textureActive,
      centerEdge: centerEdgeActive,
      fuzzExp: fuzzExpActive,
      counterFill: counterFillActive,
      punch: punchActive,
      fuzz: fuzzActive,
      smudge: smudgeActive,
    };
  }

  function normalizeExperimentalSectionOrder(order) {
    const base = Array.isArray(order) ? order : [];
    const seen = new Set();
    const normalized = [];
    base.forEach(id => {
      if (typeof id !== 'string') return;
      const trimmed = id.trim();
      if (!trimmed || seen.has(trimmed)) return;
      if (!Object.prototype.hasOwnProperty.call(EXPERIMENTAL_SECTION_STAGE_MAP, trimmed)) return;
      seen.add(trimmed);
      normalized.push(trimmed);
    });
    EXPERIMENTAL_SECTION_IDS.forEach(id => {
      if (seen.has(id)) return;
      seen.add(id);
      normalized.push(id);
    });
    return normalized;
  }

  function resolveExperimentalStages(order) {
    const stageActivity = getExperimentalStageActivity();
    const normalizedSections = normalizeExperimentalSectionOrder(order);
    const seenStages = new Set();
    const stages = [];

    if (stageActivity.init) {
      stages.push('init');
      seenStages.add('init');
    }

    const addStageIfActive = stageId => {
      if (!stageActivity[stageId]) return;
      if (seenStages.has(stageId)) return;
      seenStages.add(stageId);
      stages.push(stageId);
    };

    normalizedSections.forEach(sectionId => {
      const stageIds = EXPERIMENTAL_SECTION_STAGE_MAP[sectionId];
      if (!stageIds || !stageIds.length) return;
      stageIds.forEach(addStageIfActive);
    });

    return stages;
  }

  function getExperimentalProcessorForOrder(order, options = {}) {
    const orderKey = Array.isArray(order) && order.length ? order.join('-') : 'default';
    const resolutionSig = options?.detailResolution?.signature || 'base';
    const key = `${orderKey}::${resolutionSig}`;
    if (experimentalProcessorCache.has(key)) {
      return experimentalProcessorCache.get(key);
    }
    const stageDeps = {};
    if (options?.detailResolution) {
      stageDeps.detailResolution = options.detailResolution;
    }
    const processor = createExperimentalGlyphProcessor({
      pipelineOrder: order && order.length ? order : undefined,
      stageDeps: Object.keys(stageDeps).length ? stageDeps : undefined,
    });
    experimentalProcessorCache.set(key, processor);
    return processor;
  }


function ensureExperimentalAtlas(ink, variantIdx = 0, effectOverride = 'auto') {
    const preferWhiteEffects = !!state.inkEffectsPreferWhite;
    let effectsAllowed =
      ink === 'w' ? preferWhiteEffects :
      ink === 'b' ? !preferWhiteEffects :
      true;

    if (effectOverride === 'disabled') {
      effectsAllowed = false;
    } else if (effectOverride === 'enabled') {
      effectsAllowed = true;
    }

    const overallStrength = clamp(getInkEffectFactor(), 0, 1);
    const rawOrder = getInkSectionOrderFn();
    const pipelineStages = resolveExperimentalStages(rawOrder);
    const hasExperimentalStages = Array.isArray(pipelineStages) && pipelineStages.length > 0;

    const needsEffectsPipeline = effectsAllowed && overallStrength > 0 && hasExperimentalStages;
    const needsPipeline = needsEffectsPipeline || (variantIdx > 0);

    const baseExperimentalConfig = getExperimentalEffectsConfigFn() || {};
    const sectionEnabled = getExperimentalSectionEnabledState();
    const orderKey = hasExperimentalStages ? pipelineStages.join('-') : 'none';
    const stageSignature = buildExperimentalStageConfigSignature(pipelineStages, baseExperimentalConfig, sectionEnabled);
    const qualitySettings = getExperimentalQualitySettingsFn() || {};
    const scaleSettings = getExperimentalScaleSettingsFn() || {};
    const subsectionScaleBias = {};
    Object.keys(EXPERIMENTAL_SUBSECTION_STAGE_MAP).forEach(subId => {
      const raw = Number(scaleSettings[subId] ?? SCALE_DEFAULT);
      subsectionScaleBias[subId] = clamp(raw / 100, 0, 5);
    });
    const detailResolutionConfig = buildDetailResolutionConfig(qualitySettings);
    const qualitySignature = detailResolutionConfig?.signature || 'base';
    const overallKey = Math.round(overallStrength * 1000);
    const keyParts = [
      ink,
      `v${variantIdx | 0}`,
      `fx${effectsAllowed ? 1 : 0}`,
      `ov${overallKey}`,
      `ord${orderKey}`,
    ];
    if (stageSignature) {
      keyParts.push(`cfg${stageSignature}`);
    }
    keyParts.push(`ql${qualitySignature}`);
    const key = keyParts.join('|');
    let atlas = experimentalAtlases.get(key);
    if (atlas) return atlas;

    const ASC = getAscFn();
    const DESC = getDescFn();
    const CHAR_W = getCharWidthFn();
    const FONT_SIZE = getFontSizeFn();
    const ACTIVE_FONT_NAME = getActiveFontNameFn();
    const RENDER_SCALE = getRenderScaleFn();
    const COLORS = colors;

    const ASCII_START = 32;
    const ASCII_END = 126;
    const ATLAS_COLS = 32;

    const GLYPH_BLEED = Math.ceil((ASC + DESC) * 0.5);
    const ORIGIN_Y_CSS = ASC + GLYPH_BLEED;
    const CELL_W_CSS = CHAR_W;
    if (!baselineCharWidthCss && Number.isFinite(CELL_W_CSS) && CELL_W_CSS > 0) {
      baselineCharWidthCss = CELL_W_CSS;
    }
    const CELL_H_CSS = Math.ceil(ASC + DESC + 2 * GLYPH_BLEED);

    const overhangKey = `${ACTIVE_FONT_NAME || ''}|${FONT_SIZE || 0}|${RENDER_SCALE || 1}`;
    let OVERHANG_CSS = overhangCache.get(overhangKey);
    if (!Number.isFinite(OVERHANG_CSS)) {
      const measureCanvas = document.createElement('canvas');
      const mCtx = measureCanvas.getContext('2d');
      mCtx.font = `400 ${FONT_SIZE}px "${ACTIVE_FONT_NAME}"`;
      mCtx.textAlign = 'left';
      mCtx.textBaseline = 'alphabetic';
      const sampleChars = '~jgQÅßfyjpABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let maxLeft = 0;
      let maxRightExtra = 0;
      for (const ch of sampleChars) {
        const m = mCtx.measureText(ch);
        const left = Math.max(0, m.actualBoundingBoxLeft || 0);
        const rightExtra = Math.max(0, (m.actualBoundingBoxRight || m.width || 0) - (m.width || 0));
        if (left > maxLeft) maxLeft = left;
        if (rightExtra > maxRightExtra) maxRightExtra = rightExtra;
      }
      const SAFETY_CSS = 2;
      OVERHANG_CSS = Math.max(maxLeft, maxRightExtra) + SAFETY_CSS;
      overhangCache.set(overhangKey, OVERHANG_CSS);
    }

    const GLYPH_DRAW_W_CSS = CELL_W_CSS + 2 * OVERHANG_CSS;
    const GUTTER_DP = 2;
    const GUTTER_CSS = GUTTER_DP / RENDER_SCALE;
    const cellW_draw_dp = Math.round(GLYPH_DRAW_W_CSS * RENDER_SCALE);
    const cellH_draw_dp = Math.ceil(CELL_H_CSS * RENDER_SCALE);
    const cellW_pack_dp = cellW_draw_dp + 2 * GUTTER_DP;
    const cellH_pack_dp = cellH_draw_dp + 2 * GUTTER_DP;
    const ATLAS_ROWS = Math.ceil((ASCII_END - ASCII_START + 1) / ATLAS_COLS);
    const width_dp = Math.max(1, ATLAS_COLS * cellW_pack_dp);
    const height_dp = Math.max(1, ATLAS_ROWS * cellH_pack_dp);

    const canvas = document.createElement('canvas');
    canvas.width = width_dp;
    canvas.height = height_dp;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width_dp / RENDER_SCALE, height_dp / RENDER_SCALE);
    ctx.fillStyle = COLORS[ink] || '#000';
    ctx.font = `400 ${FONT_SIZE}px "${ACTIVE_FONT_NAME}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.globalCompositeOperation = 'source-over';

    const rectDpByCode = [];
    const advCache = new Float32Array(ASCII_END + 1);
    const SHIFT_EPS = 0.5;
    const sampleScale = 1;

    let glyphCanvas = null;
    let glyphCtx = null;
    if (needsPipeline) {
      glyphCanvas = document.createElement('canvas');
      glyphCanvas.width = Math.max(1, cellW_draw_dp * sampleScale);
      glyphCanvas.height = Math.max(1, cellH_draw_dp * sampleScale);
      glyphCtx = glyphCanvas.getContext('2d', { willReadFrequently: true });
      glyphCtx.imageSmoothingEnabled = false;
    }

    const atlasSeed = ((state.altSeed >>> 0)
      ^ Math.imul((variantIdx | 0) + 1, 0x9E3779B1)
      ^ Math.imul((ink.charCodeAt(0) || 0) + 0x51, 0x85EBCA77)) >>> 0;

    const colorRgb = parseColorToRgb(COLORS[ink] || '#000');
    const baseConfig = getExperimentalEffectsConfigFn() || {};
    const cloneParams = () => ({
      enable: { ...(baseConfig.enable || {}) },
      ink: { ...(baseConfig.ink || {}) },
      ribbon: { ...(baseConfig.ribbon || {}) },
      noise: { ...(baseConfig.noise || {}) },
      centerEdge: { ...(baseConfig.centerEdge || {}) },
      counterFill: { ...(baseConfig.counterFill || {}) },
      fuzzExp: { ...(baseConfig.fuzzExp || {}) },
      dropouts: { ...(baseConfig.dropouts || {}) },
      edgeFuzz: { ...(baseConfig.edgeFuzz || {}) },
      smudge: { ...(baseConfig.smudge || {}) },
      punch: { ...(baseConfig.punch || {}) },
    });
    const processor = hasExperimentalStages
      ? getExperimentalProcessorForOrder(pipelineStages, { detailResolution: detailResolutionConfig })
      : null;
    const stagePipeline = processor?.stagePipeline;
    const effectiveOrder = hasExperimentalStages ? pipelineStages : null;
    const runExperimentalEffects = needsEffectsPipeline && Array.isArray(effectiveOrder) && effectiveOrder.length;

    let code = ASCII_START;
    for (let row = 0; row < ATLAS_ROWS; row++) {
      for (let col = 0; col < ATLAS_COLS; col++) {
        if (code > ASCII_END) break;
        const packX_css = (col * cellW_pack_dp) / RENDER_SCALE;
        const packY_css = (row * cellH_pack_dp) / RENDER_SCALE;
        const ch = String.fromCharCode(code);
        
        const metrics = ctx.measureText(ch);
        const adv = advCache[code] || (advCache[code] = Math.max(0.01, metrics.width));
        
        const n = (variantIdx | 0) + 1;
        const textFull = ch.repeat(n);
        const textPrefix = n > 1 ? ch.repeat(n - 1) : null;

        const destX_dp = col * cellW_pack_dp + GUTTER_DP;
        const destY_dp = row * cellH_pack_dp + GUTTER_DP;
        const snapFactor = RENDER_SCALE * (glyphCanvas ? sampleScale : 1);
        
        const shiftLeft = (n - 1) * adv;
        const baseLocalX = OVERHANG_CSS - shiftLeft - SHIFT_EPS;
        const baseLocalY = ORIGIN_Y_CSS;
        const localXSnapped = Math.round(baseLocalX * snapFactor) / snapFactor;
        const localYSnapped = Math.round(baseLocalY * snapFactor) / snapFactor;

        if (glyphCtx) {
          const glyphSeed = (atlasSeed ^ Math.imul((code + 1) | 0, 0xC2B2AE3D)) >>> 0;
          
          let prefixData = null;
          if (textPrefix) {
            glyphCtx.save();
            glyphCtx.setTransform(1, 0, 0, 1, 0, 0);
            glyphCtx.clearRect(0, 0, glyphCanvas.width, glyphCanvas.height);
            
            glyphCtx.setTransform(RENDER_SCALE * sampleScale, 0, 0, RENDER_SCALE * sampleScale, 0, 0);
            glyphCtx.font = `400 ${FONT_SIZE}px "${ACTIVE_FONT_NAME}"`;
            glyphCtx.textAlign = 'left';
            glyphCtx.textBaseline = 'alphabetic';
            glyphCtx.fillStyle = '#000000';
            glyphCtx.globalCompositeOperation = 'source-over';
            
            glyphCtx.fillText(textPrefix, localXSnapped, localYSnapped);
            glyphCtx.restore();
            
            prefixData = glyphCtx.getImageData(0, 0, glyphCanvas.width, glyphCanvas.height);
          }

          glyphCtx.save();
          glyphCtx.setTransform(1, 0, 0, 1, 0, 0);
          glyphCtx.clearRect(0, 0, glyphCanvas.width, glyphCanvas.height);
          
          glyphCtx.setTransform(RENDER_SCALE * sampleScale, 0, 0, RENDER_SCALE * sampleScale, 0, 0);
          glyphCtx.font = `400 ${FONT_SIZE}px "${ACTIVE_FONT_NAME}"`;
          glyphCtx.textAlign = 'left';
          glyphCtx.textBaseline = 'alphabetic';
          glyphCtx.fillStyle = COLORS[ink] || '#000';
          glyphCtx.globalCompositeOperation = 'source-over';
          
          glyphCtx.fillText(textFull, localXSnapped, localYSnapped);
          glyphCtx.restore();

          let glyphData = glyphCtx.getImageData(0, 0, glyphCanvas.width, glyphCanvas.height);
          const basePixels = glyphData.data;

          if (prefixData) {
            const pData = prefixData.data;
            const len = basePixels.length;
            for (let k = 0; k < len; k += 4) {
              if (pData[k + 3] > 0) {
                basePixels[k] = 0;
                basePixels[k + 1] = 0;
                basePixels[k + 2] = 0;
                basePixels[k + 3] = 0;
              }
            }
          }

          if (runExperimentalEffects) {
            const glyphWidth = glyphCanvas.width;
            const glyphHeight = glyphCanvas.height;
            const alpha = new Uint8Array(glyphWidth * glyphHeight);
            let inkPixelCount = 0;
            for (let i = 0, k = 0; i < alpha.length; i++, k += 4) {
              const value = basePixels[k + 3];
              alpha[i] = value;
              if (value > 0) inkPixelCount++;
            }
            const hasProcessor = stagePipeline || typeof processor.runGlyphPipeline === 'function';
            const canRun = hasProcessor && inkPixelCount > 0;
            if (canRun) {
              const params = applySectionEnableMask(cloneParams(), sectionEnabled);
              applySubsectionScaleBias(params, subsectionScaleBias);
              const fontPxRaw = getFontSizeFn() || FONT_SIZE || 48;
              const fontPx = Number.isFinite(fontPxRaw) && fontPxRaw > 0 ? fontPxRaw : 48;
              const supersample = clamp(
                Math.round(72 / Math.max(8, fontPx)),
                1,
                4,
              );
              // REVERTED: Restored original supersample logic to fix other effects scaling
              params.smul = (fontPx / 72) * supersample;
              params.ink = { ...(params.ink || {}), colorRgb };
              const dpPerCssRaw = Math.max(1e-6, (Number(RENDER_SCALE) || 1) * (Number(sampleScale) || 1));
              const widthComp = Math.max(1e-6, CELL_W_CSS);
              const drawComp = Math.max(1e-6, GLYPH_DRAW_W_CSS);
              const baselineW = Math.max(1e-6, baselineCharWidthCss || CELL_W_CSS);
              const effectScaleBias = getEffectScaleBias();
              const dpPerCss = dpPerCssRaw * (baselineW / widthComp) * (widthComp / drawComp) * effectScaleBias;
              const dm = createLazyDistanceMapProvider({
                alpha,
                width: glyphWidth,
                height: glyphHeight,
              });
              const context = {
                w: glyphWidth,
                h: glyphHeight,
                alpha0: alpha,
                params,
                seed: glyphSeed,
                gix: variantIdx | 0,
                smul: params.smul || 1,
                dm,
                dpPerCss,
                anchorX: OVERHANG_CSS, // Pass logical anchor X
                anchorY: ORIGIN_Y_CSS, // Pass logical anchor Y
              };
              const coverage = typeof processor?.acquireCoverageBuffer === 'function'
                ? processor.acquireCoverageBuffer(glyphWidth, glyphHeight)
                : new Float32Array(glyphWidth * glyphHeight);
              try {
                if (typeof processor.runGlyphPipeline === 'function') {
                  processor.runGlyphPipeline({ ...context, coverage }, effectiveOrder);
                } else {
                  stagePipeline.runPipeline(coverage, context, effectiveOrder);
                }
                for (let i = 0, k = 0; i < coverage.length; i++, k += 4) {
                  const baseAlpha = basePixels[k + 3] / 255;
                  const cov = coverage[i];
                  const coverageAlpha = Number.isFinite(cov) ? clamp(cov, 0, 1) : baseAlpha;
                  const mixedAlpha = clamp(baseAlpha + (coverageAlpha - baseAlpha) * overallStrength, 0, 1);
                  basePixels[k] = colorRgb.r;
                  basePixels[k + 1] = colorRgb.g;
                  basePixels[k + 2] = colorRgb.b;
                  basePixels[k + 3] = Math.round(mixedAlpha * 255);
                }
              } finally {
                if (typeof processor?.releaseCoverageBuffer === 'function' && coverage) {
                  processor.releaseCoverageBuffer(coverage);
                }
              }
            } else {
              for (let k = 0; k < basePixels.length; k += 4) {
                basePixels[k] = colorRgb.r;
                basePixels[k + 1] = colorRgb.g;
                basePixels[k + 2] = colorRgb.b;
              }
            }
          } else {
            for (let k = 0; k < basePixels.length; k += 4) {
              basePixels[k] = colorRgb.r;
              basePixels[k + 1] = colorRgb.g;
              basePixels[k + 2] = colorRgb.b;
            }
          }

          glyphCtx.putImageData(glyphData, 0, 0);
          let finalImageData;
          if (sampleScale === 1) {
            finalImageData = glyphCtx.getImageData(0, 0, cellW_draw_dp, cellH_draw_dp);
          } else {
            const hiData = glyphCtx.getImageData(0, 0, glyphCanvas.width, glyphCanvas.height);
            finalImageData = downsampleImageData(hiData, sampleScale, cellW_draw_dp, cellH_draw_dp);
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.putImageData(finalImageData, destX_dp, destY_dp);
          ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
          ctx.imageSmoothingEnabled = false;
          ctx.font = `400 ${FONT_SIZE}px "${ACTIVE_FONT_NAME}"`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
        } else {
          ctx.save();
          const x0 = packX_css + GUTTER_CSS + localXSnapped;
          const y0 = packY_css + GUTTER_CSS + localYSnapped;
          
          ctx.beginPath();
          ctx.rect(packX_css + GUTTER_CSS, packY_css + GUTTER_CSS, GLYPH_DRAW_W_CSS, CELL_H_CSS);
          ctx.clip();

          ctx.fillText(textFull, x0, y0);
          if (textPrefix) {
             ctx.globalCompositeOperation = 'destination-out';
             ctx.fillText(textPrefix, x0, y0);
             ctx.globalCompositeOperation = 'source-over';
          }
          ctx.restore();
        }

        rectDpByCode[code] = {
          sx_dp: col * cellW_pack_dp + GUTTER_DP,
          sy_dp: row * cellH_pack_dp + GUTTER_DP,
          sw_dp: cellW_draw_dp,
          sh_dp: cellH_draw_dp,
        };
        code++;
      }
    }

    atlas = {
      canvas,
      cellW_css: CELL_W_CSS,
      cellH_css: CELL_H_CSS,
      cellW_draw_dp,
      cellH_draw_dp,
      originY_css: ORIGIN_Y_CSS,
      bleedX_css: OVERHANG_CSS,
      drawW_css: GLYPH_DRAW_W_CSS,
      rectDpByCode,
    };
    experimentalAtlases.set(key, atlas);
    return atlas;
  }


  function ensureAtlas(ink, variantIdx = 0, effectOverride = 'auto') {
    return ensureExperimentalAtlas(ink, variantIdx, effectOverride);
  }

  function variantIndexForCell(pageIndex, rowMu, col) {
    if (ALT_VARIANTS <= 1) return 0;
    let h = (state.altSeed >>> 0);
    h ^= Math.imul((pageIndex + 1) | 0, 0x9E3779B1);
    h ^= Math.imul((rowMu + 0x10001) | 0, 0x85EBCA77);
    h ^= Math.imul((col + 0x4001) | 0, 0xC2B2AE3D);
    h ^= (h >>> 16);
    return (h >>> 0) % ALT_VARIANTS;
  }

  function drawGlyph(ctx, ch, ink, x_css, baselineY_css, layerIndex, totalLayers, pageIndex, rowMu, col, effectsOverride = 'auto') {
    const atlas = ensureAtlas(ink, variantIndexForCell(pageIndex | 0, rowMu | 0, col | 0), effectsOverride);
    const fallback = atlas.rectDpByCode['?'.charCodeAt(0)];
    const rect = atlas.rectDpByCode[ch.charCodeAt(0)] || fallback;
    if (!rect) return;
    const RENDER_SCALE = getRenderScaleFn();
    const bleedX = Number.isFinite(atlas.bleedX_css) ? atlas.bleedX_css : 0;
    const drawW_css = Number.isFinite(atlas.drawW_css) ? atlas.drawW_css : atlas.cellW_css;
    const dx_css = Math.round((x_css - bleedX) * RENDER_SCALE) / RENDER_SCALE;
    const dy_css = Math.round((baselineY_css - atlas.originY_css) * RENDER_SCALE) / RENDER_SCALE;
    const baseOpacity = clamp(((state.inkOpacity && typeof state.inkOpacity[ink] === 'number') ? state.inkOpacity[ink] : 100) / 100, 0, 1);
    const layerFalloff = Math.max(0.1, Math.min(1, 0.92 * Math.pow(0.92, totalLayers - 1 - layerIndex)));
    const finalAlpha = (ink === 'w') ? baseOpacity : baseOpacity * layerFalloff;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = finalAlpha;
    ctx.drawImage(atlas.canvas, rect.sx_dp, rect.sy_dp, rect.sw_dp, rect.sh_dp, dx_css, dy_css, drawW_css, atlas.cellH_css);
  }

  if (typeof context?.registerRendererApi === 'function') {
    context.registerRendererApi({ rebuildAllAtlases });
  }

  return { rebuildAllAtlases, drawGlyph };
}
