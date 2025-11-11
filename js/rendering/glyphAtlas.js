import { clamp } from '../utils/math.js';
import { createExperimentalGlyphProcessor } from './experimental/glyphProcessor.js';
import { computeInsideDistance, computeOutsideDistance } from './experimental/distanceMaps.js';

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
    isSafari,
    safariSupersampleThreshold,
    getInkEffectFactor,
    getInkSectionStrength,
    getInkSectionOrder,
    isInkSectionEnabled,
    getExperimentalEffectsConfig,
    getExperimentalQualitySettings,
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
  const ALT_VARIANTS = 9;
  const experimentalAtlases = new Map();
  const experimentalProcessorCache = new Map();
  window.atlasStats = { builds: 0, draws: 0, perInk: { b: 0, r: 0, w: 0 } };

  function rebuildAllAtlases() {
    experimentalAtlases.clear();
    experimentalProcessorCache.clear();
    window.atlasStats = { builds: 0, draws: 0, perInk: { b: 0, r: 0, w: 0 } };
  }

function djb2(str) {
  let h = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

  function hash2(ix, iy, seed) {
    let h = seed | 0;
    h ^= Math.imul(ix | 0, 0x9E3779B1);
    h ^= Math.imul((iy | 0) ^ 0x85EBCA77, 0xC2B2AE3D);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function valueNoise2D(x, y, scale, seed) {
    const gx = x / scale;
    const gy = y / scale;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const sx = smoothstep(gx - x0);
    const sy = smoothstep(gy - y0);
    const n00 = hash2(x0, y0, seed);
    const n10 = hash2(x1, y0, seed);
    const n01 = hash2(x0, y1, seed);
    const n11 = hash2(x1, y1, seed);
    const nx0 = n00 + (n10 - n00) * sx;
    const nx1 = n01 + (n11 - n01) * sx;
    return nx0 + (nx1 - nx0) * sy;
  }

  function tileableValueNoise2D(x, y, scale, seed, periodX, periodY) {
    if (!(periodX > 0) || !(periodY > 0)) {
      return valueNoise2D(x, y, scale, seed);
    }
    const wrapX = x - periodX;
    const wrapY = y - periodY;
    const blendX = clamp(x / periodX, 0, 1);
    const blendY = clamp(y / periodY, 0, 1);
    const n00 = valueNoise2D(x, y, scale, seed);
    const n10 = valueNoise2D(wrapX, y, scale, seed);
    const n01 = valueNoise2D(x, wrapY, scale, seed);
    const n11 = valueNoise2D(wrapX, wrapY, scale, seed);
    const nx0 = n00 + (n10 - n00) * blendX;
    const nx1 = n01 + (n11 - n01) * blendX;
    return nx0 + (nx1 - nx0) * blendY;
  }

  function tileableHash2(x, y, seed, periodX, periodY) {
    if (!(periodX > 0) || !(periodY > 0)) {
      return hash2(Math.floor(x), Math.floor(y), seed);
    }
    const wrapX = x - periodX;
    const wrapY = y - periodY;
    const blendX = clamp(x / periodX, 0, 1);
    const blendY = clamp(y / periodY, 0, 1);
    const h00 = hash2(Math.floor(x), Math.floor(y), seed);
    const h10 = hash2(Math.floor(wrapX), Math.floor(y), seed);
    const h01 = hash2(Math.floor(x), Math.floor(wrapY), seed);
    const h11 = hash2(Math.floor(wrapX), Math.floor(wrapY), seed);
    const hx0 = h00 + (h10 - h00) * blendX;
    const hx1 = h01 + (h11 - h01) * blendX;
    return hx0 + (hx1 - hx0) * blendY;
  }

  function randomOffset(seed, size, salt) {
    if (!(size > 0)) return 0;
    const mix = ((seed >>> 0) ^ (salt >>> 0)) >>> 0;
    const h = hash2(mix & 0xFFFF, (mix >>> 16) & 0xFFFF, mix ^ 0x9E3779B1);
    return Math.floor(h * size) % size;
  }

  function normalizeDirection(dir) {
    if (!dir) return { x: 1, y: 0 };
    const x = Number.isFinite(dir.x) ? dir.x : 1;
    const y = Number.isFinite(dir.y) ? dir.y : 0;
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
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

  function lightenHexColor(hex, factor) {
    if (typeof hex !== 'string' || !hex.startsWith('#')) return hex;
    const norm = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
    const num = Number.parseInt(norm.slice(1), 16);
    if (!Number.isFinite(num)) return hex;
    const r = (num >> 16) & 0xFF;
    const g = (num >> 8) & 0xFF;
    const b = num & 0xFF;
    const f = clamp(factor, 0, 1);
    const rn = Math.round(r + (255 - r) * f);
    const gn = Math.round(g + (255 - g) * f);
    const bn = Math.round(b + (255 - b) * f);
    return `rgb(${rn},${gn},${bn})`;
  }

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

  function createLegacyDistanceMapProviderFactory(imageData) {
    let cached = null;
    return () => {
      if (!cached) {
        cached = computeDistanceMaps(imageData);
      }
      return cached;
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
      enable.centerEdge = false;
      enable.ribbonBands = false;
      enable.rim = false;
    }
    if (!enable.toneCore) {
      enable.toneDynamics = false;
      enable.ribbonBands = false;
    }
    if (!sectionEnabled.expEdge) {
      enable.edgeFuzz = false;
    }
    if (!sectionEnabled.expGrain) {
      enable.grainSpeck = false;
    }
    if (!sectionEnabled.expDefects) {
      enable.dropouts = false;
      enable.punch = false;
      enable.smudge = false;
    }
    return params;
  }

  const EXPERIMENTAL_STAGE_PARAM_KEYS = Object.freeze({
    fill: [
      { path: 'enable.toneCore', section: 'expTone' },
      { path: 'enable.toneDynamics', section: 'expTone', require: 'enable.toneCore' },
      { path: 'ink.pressureMid', section: 'expTone', require: 'enable.toneDynamics' },
      { path: 'ink.pressureVar', section: 'expTone', require: 'enable.toneDynamics' },
      { path: 'ink.inkGamma', section: 'expTone', require: 'enable.toneDynamics' },
      { path: 'ink.toneJitter', section: 'expTone', require: 'enable.toneDynamics' },
      { path: 'noise.lfScale', section: 'expTone', require: 'enable.toneDynamics' },
      { path: 'noise.hfScale', section: 'expTone', require: 'enable.toneDynamics' },
      { path: 'enable.ribbonBands', section: 'expTone', require: 'enable.toneCore' },
      { path: 'ribbon.height', section: 'expTone', require: 'enable.ribbonBands' },
      { path: 'ribbon.position', section: 'expTone', require: 'enable.ribbonBands' },
      { path: 'ribbon.delta', section: 'expTone', require: 'enable.ribbonBands' },
      { path: 'ribbon.fade', section: 'expTone', require: 'enable.ribbonBands' },
      { path: 'ribbon.wobble', section: 'expTone', require: 'enable.ribbonBands' },
      { path: 'enable.rim', section: 'expEdge' },
      { path: 'ink.rim', section: 'expEdge', require: 'enable.rim' },
      { path: 'ink.rimCurve', section: 'expEdge', require: 'enable.rim' },
    ],
    centerEdge: [
      { path: 'enable.centerEdge', section: 'expTone' },
      { path: 'centerEdge.center', section: 'expTone', require: 'enable.centerEdge' },
      { path: 'centerEdge.edge', section: 'expTone', require: 'enable.centerEdge' },
    ],
    texture: [
      { path: 'enable.grainSpeck', section: 'expGrain' },
      { path: 'ink.mottling', section: 'expGrain', require: 'enable.grainSpeck' },
      { path: 'ink.speckDark', section: 'expGrain', require: 'enable.grainSpeck' },
      { path: 'ink.speckLight', section: 'expGrain', require: 'enable.grainSpeck' },
      { path: 'ink.speckGrayBias', section: 'expGrain', require: 'enable.grainSpeck' },
    ],
    dropouts: [
      { path: 'enable.dropouts', section: 'expDefects' },
      { path: 'dropouts.amount', section: 'expDefects', require: 'enable.dropouts' },
      { path: 'dropouts.width', section: 'expDefects', require: 'enable.dropouts' },
      { path: 'dropouts.scale', section: 'expDefects', require: 'enable.dropouts' },
      { path: 'dropouts.pinhole', section: 'expDefects', require: 'enable.dropouts' },
      { path: 'dropouts.streakDensity', section: 'expDefects', require: 'enable.dropouts' },
      { path: 'dropouts.pinholeWeight', section: 'expDefects', require: 'enable.dropouts' },
    ],
    punch: [
      { path: 'enable.punch', section: 'expDefects' },
      { path: 'punch.chance', section: 'expDefects', require: 'enable.punch' },
      { path: 'punch.count', section: 'expDefects', require: 'enable.punch' },
      { path: 'punch.rMin', section: 'expDefects', require: 'enable.punch' },
      { path: 'punch.rMax', section: 'expDefects', require: 'enable.punch' },
      { path: 'punch.edgeBias', section: 'expDefects', require: 'enable.punch' },
      { path: 'punch.soft', section: 'expDefects', require: 'enable.punch' },
      { path: 'punch.intensity', section: 'expDefects', require: 'enable.punch' },
    ],
    fuzz: [
      { path: 'enable.edgeFuzz', section: 'expEdge' },
      { path: 'edgeFuzz.opacity', section: 'expEdge', require: 'enable.edgeFuzz' },
      { path: 'edgeFuzz.inBand', section: 'expEdge', require: 'enable.edgeFuzz' },
      { path: 'edgeFuzz.outBand', section: 'expEdge', require: 'enable.edgeFuzz' },
      { path: 'edgeFuzz.rough', section: 'expEdge', require: 'enable.edgeFuzz' },
      { path: 'edgeFuzz.scale', section: 'expEdge', require: 'enable.edgeFuzz' },
      { path: 'edgeFuzz.mix', section: 'expEdge', require: 'enable.edgeFuzz' },
    ],
    smudge: [
      { path: 'enable.smudge', section: 'expDefects' },
      { path: 'smudge.strength', section: 'expDefects', require: 'enable.smudge' },
      { path: 'smudge.radius', section: 'expDefects', require: 'enable.smudge' },
      { path: 'smudge.falloff', section: 'expDefects', require: 'enable.smudge' },
      { path: 'smudge.scale', section: 'expDefects', require: 'enable.smudge' },
      { path: 'smudge.density', section: 'expDefects', require: 'enable.smudge' },
      { path: 'smudge.dirDeg', section: 'expDefects', require: 'enable.smudge' },
      { path: 'smudge.spread', section: 'expDefects', require: 'enable.smudge' },
    ],
  });

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
      const entries = EXPERIMENTAL_STAGE_PARAM_KEYS[stageId];
      if (!entries || !entries.length) {
        parts.push(stageId);
        return;
      }
      const stageParts = [];
      entries.forEach((entry, idx) => {
        if (entry.section && sectionEnabled && sectionEnabled[entry.section] === false) {
          return;
        }
        if (entry.require) {
          const prereq = getConfigValueAtPath(config, entry.require);
          if (!prereq) return;
        }
        const value = getConfigValueAtPath(config, entry.path);
        stageParts.push(`${idx}:${encodeExperimentalKeyValue(value)}`);
      });
      if (stageParts.length) {
        parts.push(`${stageId}[${stageParts.join(',')}]`);
      } else {
        parts.push(stageId);
      }
    });
    return parts.join('~');
  }

  const EXPERIMENTAL_SECTION_IDS = ['expTone', 'expEdge', 'expGrain', 'expDefects'];
  const EXPERIMENTAL_SECTION_STAGE_MAP = {
    expTone: ['fill', 'centerEdge'],
    expEdge: ['fuzz'],
    expGrain: ['texture'],
    expDefects: ['dropouts', 'punch', 'smudge'],
  };
  const QUALITY_DEFAULT = 100;
  const QUALITY_MIN = 0;
  const QUALITY_MAX = 200;
  const DETAIL_BASE_SCALE = 0.5;
  const DETAIL_MIN_SCALE = 0.05;
  const DETAIL_MAX_SCALE = 1;
  const STAGE_QUALITY_MIN = 0.05;
  const STAGE_QUALITY_MAX = 2;

  function buildDetailResolutionConfig(qualitySettings) {
    const stageScaleMap = new Map();
    const stageQualityMap = new Map();
    const quality = qualitySettings && typeof qualitySettings === 'object' ? qualitySettings : {};
    Object.entries(EXPERIMENTAL_SECTION_STAGE_MAP).forEach(([sectionId, stageIds]) => {
      if (!Array.isArray(stageIds)) return;
      const raw = Number(quality[sectionId]);
      const percent = clamp(Number.isFinite(raw) ? raw : QUALITY_DEFAULT, QUALITY_MIN, QUALITY_MAX);
      const factor = percent / QUALITY_DEFAULT;
      const stageScale = clamp(DETAIL_BASE_SCALE * factor, DETAIL_MIN_SCALE, DETAIL_MAX_SCALE);
      const qualityFactor = clamp(factor, STAGE_QUALITY_MIN, STAGE_QUALITY_MAX);
      stageIds.forEach(stageId => {
        stageScaleMap.set(stageId, stageScale);
        stageQualityMap.set(stageId, qualityFactor);
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
    signatureParts.sort();
    return {
      threshold: 2.5,
      scale: DETAIL_BASE_SCALE,
      stages: new Set(stageScaleMap.keys()),
      stageScaleMap,
      stageQualityMap,
      signature: signatureParts.join('|') || 'base',
    };
  }

  // Determine which experimental stages currently have any visible effect enabled.
  function getExperimentalStageActivity() {
    const cfg = getExperimentalEffectsConfigFn() || {};
    const enable = cfg.enable && typeof cfg.enable === 'object' ? cfg.enable : {};
    const sectionActive = getExperimentalSectionEnabledState();
    const hasPositive = (value, epsilon = 1e-3) => Number.isFinite(value) && Math.abs(value) > epsilon;

    const inkCfg = cfg.ink || {};
    const ribbonCfg = cfg.ribbon || {};
    const noiseCfg = cfg.noise || {};
    const centerEdgeCfg = cfg.centerEdge || {};
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
    const ribbonBandStrength = Number.isFinite(ribbonCfg.delta)
      ? ribbonCfg.delta
      : Number.isFinite(ribbonCfg.amp)
        ? ribbonCfg.amp
        : 0;
    const ribbonBandsActive = (
      !!enable.toneCore
      && !!enable.ribbonBands
      && sectionActive.expTone
      && Math.abs(ribbonBandStrength) > 1e-3
    );
    const toneCoreModulesActive = (
      toneDynamicsActive
      || ribbonBandsActive
      || (!!enable.rim && sectionActive.expTone && hasPositive(inkCfg.rim))
    );
    const toneCoreActive = toneCoreModulesActive;
    const centerEdgeActive = sectionActive.expTone
      && !!enable.centerEdge
      && (hasPositive(centerEdgeCfg.center) || hasPositive(centerEdgeCfg.edge));
    const textureActive = sectionActive.expGrain
      && !!enable.grainSpeck
      && (hasPositive(inkCfg.speckDark) || hasPositive(inkCfg.speckLight));
    const fuzzActive = sectionActive.expEdge
      && !!enable.edgeFuzz
      && hasPositive(edgeFuzzCfg.opacity)
      && (hasPositive(edgeFuzzCfg.inBand) || hasPositive(edgeFuzzCfg.outBand));
    const dropoutsActive = sectionActive.expDefects
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
      || textureActive
      || dropoutsActive
      || punchActive
      || fuzzActive
      || smudgeActive;
    return {
      fill: needsFill,
      dropouts: dropoutsActive,
      texture: textureActive,
      centerEdge: centerEdgeActive,
      punch: punchActive,
      fuzz: fuzzActive,
      smudge: smudgeActive,
    };
  }

  // Normalize the requested experimental section order while preserving fallbacks.
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

    if (stageActivity.fill && !seenStages.has('fill')) {
      stages.unshift('fill');
      seenStages.add('fill');
    }

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

    // BEGIN: config snapshot + hash (no name collisions)
    const baseExperimentalConfig = getExperimentalEffectsConfigFn() || {};
    const sectionEnabled = getExperimentalSectionEnabledState();
    const orderKey = hasExperimentalStages ? pipelineStages.join('-') : 'none';
    const stageSignature = buildExperimentalStageConfigSignature(pipelineStages, baseExperimentalConfig, sectionEnabled);
    const qualitySettings = getExperimentalQualitySettingsFn() || {};
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
    const CELL_H_CSS = Math.ceil(ASC + DESC + 2 * GLYPH_BLEED);
    const GUTTER_DP = 1;
    const GUTTER_CSS = GUTTER_DP / RENDER_SCALE;
    const cellW_draw_dp = Math.round(CELL_W_CSS * RENDER_SCALE);
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
    const safariSupersample = (isSafari && getStateZoomFn() >= safariSupersampleThreshold) ? 2 : 1;
    const sampleScale = Math.max(1, safariSupersample);
    const needsEffectsPipeline = effectsAllowed && overallStrength > 0 && hasExperimentalStages;
    const needsPipeline = needsEffectsPipeline || sampleScale > 1;

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
        const n = (variantIdx | 0) + 1;
        const adv = advCache[code] || (advCache[code] = Math.max(0.01, ctx.measureText(ch).width));
        const text = variantIdx ? ch.repeat(n) : ch;
        const destX_dp = col * cellW_pack_dp + GUTTER_DP;
        const destY_dp = row * cellH_pack_dp + GUTTER_DP;
        const snapFactor = RENDER_SCALE * (glyphCanvas ? sampleScale : 1);
        const baseLocalX = -(n - 1) * adv - SHIFT_EPS;
        const baseLocalY = ORIGIN_Y_CSS;
        const localXSnapped = Math.round(baseLocalX * snapFactor) / snapFactor;
        const localYSnapped = Math.round(baseLocalY * snapFactor) / snapFactor;

        if (glyphCtx) {
          const glyphSeed = (atlasSeed ^ Math.imul((code + 1) | 0, 0xC2B2AE3D)) >>> 0;
          glyphCtx.setTransform(1, 0, 0, 1, 0, 0);
          glyphCtx.globalCompositeOperation = 'source-over';
          glyphCtx.globalAlpha = 1;
          glyphCtx.clearRect(0, 0, glyphCanvas.width, glyphCanvas.height);
          glyphCtx.save();
          glyphCtx.setTransform(RENDER_SCALE * sampleScale, 0, 0, RENDER_SCALE * sampleScale, 0, 0);
          glyphCtx.fillStyle = COLORS[ink] || '#000';
          glyphCtx.font = `400 ${FONT_SIZE}px "${ACTIVE_FONT_NAME}"`;
          glyphCtx.textAlign = 'left';
          glyphCtx.textBaseline = 'alphabetic';
          glyphCtx.imageSmoothingEnabled = false;
          glyphCtx.beginPath();
          glyphCtx.rect(0, 0, CELL_W_CSS, CELL_H_CSS);
          glyphCtx.clip();
          glyphCtx.fillText(text, localXSnapped, localYSnapped);
          glyphCtx.restore();

          let glyphData = glyphCtx.getImageData(0, 0, glyphCanvas.width, glyphCanvas.height);
          const basePixels = glyphData.data;

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
              const fontPxRaw = getFontSizeFn() || FONT_SIZE || 48;
              const fontPx = Number.isFinite(fontPxRaw) && fontPxRaw > 0 ? fontPxRaw : 48;
              const supersample = clamp(
                Math.round(72 / Math.max(8, fontPx)),
                1,
                4,
              );
              params.smul = (fontPx / 72) * supersample;
              params.ink = { ...(params.ink || {}), colorRgb };
              const dpPerCss = Math.max(1e-6, (Number(RENDER_SCALE) || 1) * (Number(sampleScale) || 1));
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
              };
              const coverage = new Float32Array(glyphWidth * glyphHeight);
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
          ctx.beginPath();
          ctx.rect(packX_css + GUTTER_CSS, packY_css + GUTTER_CSS, CELL_W_CSS, CELL_H_CSS);
          ctx.clip();
          const x0 = packX_css + GUTTER_CSS + localXSnapped;
          const y0 = packY_css + GUTTER_CSS + localYSnapped;
          ctx.fillText(text, x0, y0);
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
      rectDpByCode,
    };
    experimentalAtlases.set(key, atlas);
    window.atlasStats.builds++;
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
    const RENDER_SCALE = getRenderScale();
    const dx_css = Math.round(x_css * RENDER_SCALE) / RENDER_SCALE;
    const dy_css = Math.round((baselineY_css - atlas.originY_css) * RENDER_SCALE) / RENDER_SCALE;
    const baseOpacity = clamp(((state.inkOpacity && typeof state.inkOpacity[ink] === 'number') ? state.inkOpacity[ink] : 100) / 100, 0, 1);
    const layerFalloff = Math.max(0.1, Math.min(1, 0.92 * Math.pow(0.92, totalLayers - 1 - layerIndex)));
    const finalAlpha = (ink === 'w') ? baseOpacity : baseOpacity * layerFalloff;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = finalAlpha;
    ctx.drawImage(atlas.canvas, rect.sx_dp, rect.sy_dp, rect.sw_dp, rect.sh_dp, dx_css, dy_css, atlas.cellW_css, atlas.cellH_css);
    window.atlasStats.draws++;
    window.atlasStats.perInk[ink] = (window.atlasStats.perInk[ink] || 0) + 1;
  }

  if (typeof context?.registerRendererApi === 'function') {
    context.registerRendererApi({ rebuildAllAtlases });
  }

  return { rebuildAllAtlases, drawGlyph };
}
