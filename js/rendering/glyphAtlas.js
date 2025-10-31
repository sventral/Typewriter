import { clamp } from '../utils/math.js';

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
    isInkSectionEnabled,
    inkTextureConfig,
    edgeBleedConfig,
    grainConfig,
    getPowderEffectStrength,
    getTextureEffectStrength,
    getFuzzEffectStrength,
    getBleedEffectStrength,
    getTextureVoidsBias,
    powderConfig,
    fuzzConfig,
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
  const getPowderStrengthFn = typeof getPowderEffectStrength === 'function' ? getPowderEffectStrength : () => 0;
  const getTextureStrengthFn = typeof getTextureEffectStrength === 'function' ? getTextureEffectStrength : () => 0;
  const getFuzzStrengthFn = typeof getFuzzEffectStrength === 'function' ? getFuzzEffectStrength : () => 0;
  const getBleedStrengthFn = typeof getBleedEffectStrength === 'function' ? getBleedEffectStrength : () => 0;
  const getTextureVoidsBiasFn = typeof getTextureVoidsBias === 'function' ? getTextureVoidsBias : () => 0;
  const getPowderConfig = typeof powderConfig === 'function' ? powderConfig : () => ({ enabled: false });
  const getFuzzConfig = typeof fuzzConfig === 'function' ? fuzzConfig : () => ({ enabled: false });
  const ALT_VARIANTS = 9;
  const atlases = new Map();
  window.atlasStats = { builds: 0, draws: 0, perInk: { b: 0, r: 0, w: 0 } };

  function rebuildAllAtlases() {
    atlases.clear();
    window.atlasStats = { builds: 0, draws: 0, perInk: { b: 0, r: 0, w: 0 } };
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
    return nx0 + (nx1 - n00) * sy;
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

const COLOR_CACHE = new Map();

function parseColorToRGB(color) {
  if (!color) return { r: 0, g: 0, b: 0 };
  if (COLOR_CACHE.has(color)) return COLOR_CACHE.get(color);
  let r = 0;
  let g = 0;
  let b = 0;
  if (typeof color === 'string') {
    const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      if (hex.length === 3) {
        r = Number.parseInt(hex[0] + hex[0], 16);
        g = Number.parseInt(hex[1] + hex[1], 16);
        b = Number.parseInt(hex[2] + hex[2], 16);
      } else {
        r = Number.parseInt(hex.slice(0, 2), 16);
        g = Number.parseInt(hex.slice(2, 4), 16);
        b = Number.parseInt(hex.slice(4, 6), 16);
      }
    } else {
      const rgbMatch = color.match(/rgba?\(([^)]+)\)/i);
      if (rgbMatch) {
        const parts = rgbMatch[1].split(',').map(part => Number.parseFloat(part.trim()));
        if (parts.length >= 3) {
          r = clamp(Math.round(parts[0]), 0, 255);
          g = clamp(Math.round(parts[1]), 0, 255);
          b = clamp(Math.round(parts[2]), 0, 255);
        }
      }
    }
  }
  const parsed = { r, g, b };
  COLOR_CACHE.set(color, parsed);
  return parsed;
}

function distanceTransform(mask, width, height, invert = false) {
  const size = width * height;
  const dist = new Float32Array(size);
  const INF = 1e9;
  for (let i = 0; i < size; i++) {
    const filled = mask[i] > 0;
    dist[i] = (!invert && filled) || (invert && !filled) ? INF : 0;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let best = dist[idx];
      if (best > 0) {
        if (x > 0) best = Math.min(best, dist[idx - 1] + 1);
        if (y > 0) {
          best = Math.min(best, dist[idx - width] + 1);
          if (x > 0) best = Math.min(best, dist[idx - width - 1] + Math.SQRT2);
          if (x < width - 1) best = Math.min(best, dist[idx - width + 1] + Math.SQRT2);
        }
      }
      dist[idx] = best;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const idx = y * width + x;
      let best = dist[idx];
      if (x < width - 1) best = Math.min(best, dist[idx + 1] + 1);
      if (y < height - 1) {
        best = Math.min(best, dist[idx + width] + 1);
        if (x > 0) best = Math.min(best, dist[idx + width - 1] + Math.SQRT2);
        if (x < width - 1) best = Math.min(best, dist[idx + width + 1] + Math.SQRT2);
      }
      dist[idx] = best;
    }
  }
  return dist;
}

function buildDistanceInfo(imageData) {
  if (!imageData) return null;
  const { width, height, data } = imageData;
  const size = width * height;
  const mask = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    mask[i] = data[i * 4 + 3] > 0 ? 1 : 0;
  }
  return {
    mask,
    inside: distanceTransform(mask, width, height, false),
    outside: distanceTransform(mask, width, height, true),
    width,
    height,
  };
}

function applyPowderEffect(imageData, distanceInfo, options) {
  const { data, width, height } = imageData || {};
  if (!data || !distanceInfo) return;
  const strength = clamp(Number(options?.strength) || 0, 0, 2);
  if (strength <= 0) return;
  const inside = distanceInfo.inside;
  const mask = distanceInfo.mask;
  const renderScale = Math.max(1e-3, options?.renderScale || 1);
  const charWidth = Math.max(1e-3, options?.charWidth || 1);
  const baseScale = Math.max(1e-3, charWidth * Math.max(0.05, options?.grainScale || 1));
  const falloff = Math.max(0.25, options?.edgeFalloff || 1.5);
  const coherence = clamp(Number(options?.coherence) || 0, 0, 1);
  const seed = options?.seed >>> 0;
  const coarseSeed = seed ^ 0xC2B2AE3D;
  const jitterSeed = seed ^ 0x9E3779B1;
  const invRender = 1 / renderScale;
  for (let y = 0; y < height; y++) {
    const yCss = y * invRender;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      const pixelIndex = idx * 4;
      const alpha = data[pixelIndex + 3];
      if (alpha <= 0) continue;
      const distPx = inside[idx];
      const distCss = distPx * invRender;
      if (distCss >= falloff) continue;
      const edgeWeight = 1 - clamp(distCss / falloff, 0, 1);
      if (edgeWeight <= 0) continue;
      const xCss = x * invRender;
      const noiseA = valueNoise2D(xCss, yCss, baseScale, seed);
      const noiseB = valueNoise2D(xCss, yCss, baseScale * 0.6, coarseSeed);
      const granular = noiseA * (1 - coherence) + noiseB * coherence;
      const jitter = hash2(x, y, jitterSeed);
      const voidBias = 0.42 - coherence * 0.12;
      const drop = Math.max(0, granular - voidBias) + 0.15 * (jitter - 0.5);
      const modulation = clamp(1 - strength * edgeWeight * drop, 0.25, 1);
      data[pixelIndex + 3] = Math.round(alpha * modulation);
      if (modulation < 1) {
        const lighten = (1 - modulation) * 0.22;
        data[pixelIndex] = Math.round(data[pixelIndex] + (255 - data[pixelIndex]) * lighten);
        data[pixelIndex + 1] = Math.round(data[pixelIndex + 1] + (255 - data[pixelIndex + 1]) * lighten);
        data[pixelIndex + 2] = Math.round(data[pixelIndex + 2] + (255 - data[pixelIndex + 2]) * lighten);
      }
    }
  }
}

function generateFuzzImageData(distanceInfo, options) {
  if (!distanceInfo) return null;
  const strength = clamp(Number(options?.strength) || 0, 0, 2);
  const cfg = options?.config || {};
  if (!cfg.enabled || strength <= 0) return null;
  const width = distanceInfo.width;
  const height = distanceInfo.height;
  const mask = distanceInfo.mask;
  const inside = distanceInfo.inside;
  const outside = distanceInfo.outside;
  const renderScale = Math.max(1e-3, options?.renderScale || 1);
  const invRender = 1 / renderScale;
  const charWidth = Math.max(1e-3, options?.charWidth || 1);
  const totalWidth = Math.max(0.05, cfg.fuzzWidthPx || 1.2);
  const inwardShare = clamp(Number(cfg.fuzzInwardShare) || 0.5, 0, 1);
  const inwardWidth = totalWidth * inwardShare;
  const outwardWidth = totalWidth - inwardWidth;
  const baseOpacity = clamp(Number(cfg.fuzzOpacity) || 0.6, 0, 1) * strength;
  if (baseOpacity <= 0) return null;
  const roughness = clamp(Number(cfg.fuzzRoughness) || 0.6, 0, 1);
  const frequency = Math.max(0.2, Number(cfg.fuzzFrequency) || 1);
  const baseScale = Math.max(1e-3, charWidth * frequency);
  const seed = options?.seed >>> 0;
  const coarseSeed = seed ^ 0x85EBCA77;
  const jitterSeed = seed ^ 0xA5A5A5A5;
  const { r, g, b } = options?.color || { r: 0, g: 0, b: 0 };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const yCss = y * invRender;
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixIdx = idx * 4;
      const isInside = mask[idx] > 0;
      const distCss = isInside ? inside[idx] * invRender : outside[idx] * invRender;
      let band = 0;
      if (isInside) {
        if (distCss <= inwardWidth) band = 1 - distCss / Math.max(inwardWidth, 1e-3);
      } else if (distCss <= outwardWidth) {
        band = 1 - distCss / Math.max(outwardWidth, 1e-3);
      }
      if (band <= 0) continue;
      const shapedBand = Math.pow(clamp(band, 0, 1), 0.75);
      const xCss = x * invRender;
      const coarse = valueNoise2D(xCss, yCss, baseScale * 0.6, coarseSeed);
      const fine = valueNoise2D(xCss, yCss, baseScale, seed);
      const jitter = hash2(x, y, jitterSeed);
      const noise = fine * (1 - roughness) + coarse * roughness;
      const mod = clamp(0.55 + 0.35 * noise + 0.2 * (jitter - 0.5), 0, 1);
      const alpha = clamp(baseOpacity * shapedBand * mod, 0, 1);
      if (alpha <= 0.01) continue;
      data[pixIdx] = r;
      data[pixIdx + 1] = g;
      data[pixIdx + 2] = b;
      data[pixIdx + 3] = Math.round(alpha * 255);
    }
  }
  return new ImageData(data, width, height);
}

function quantizeEffectLevel(value, steps = 4) {
  const clamped = clamp(Number(value) || 0, 0, 1);
  return Math.round(clamped * steps);
}

function applyInkTexture(imageData, options) {
  const { config, renderScale, sampleScale, charWidth, seed, strength, voidsBias } = options || {};
  if (!config || !config.enabled) return;
  const effectStrength = clamp(Number(strength) || 0, 0, 2);
  if (effectStrength <= 0) return;
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  if (!data || !width || !height) return;

  const dpPerCss = Math.max(1e-6, renderScale * sampleScale);
  const jitterSeed = (seed ^ (config.jitterSeed || 0)) >>> 0;
  const jitterAmt = charWidth * 0.35;
  const jitterX = (hash2(1, 0, jitterSeed) - 0.5) * jitterAmt;
  const jitterY = (hash2(2, 0, jitterSeed) - 0.5) * jitterAmt;

  const octaves = Array.isArray(config.noiseOctaves) ? config.noiseOctaves : [];
  let weightSum = 0;
  for (let i = 0; i < octaves.length; i++) weightSum += Math.max(0, octaves[i].weight || 0);
  const baseNoiseStrength = Number.isFinite(config.noiseStrength) ? config.noiseStrength : 0;
  const noiseStrength = baseNoiseStrength * effectStrength;
  const baseNoiseFloor = clamp(Number.isFinite(config.noiseFloor) ? config.noiseFloor : 0, 0, 1);
  const noiseFloor = 1 - (1 - baseNoiseFloor) * clamp(effectStrength, 0, 1);
  const combinedBias = clamp(((Number(config.textureVoidsBias) || 0) + (Number(voidsBias) || 0)) * 0.35, -0.35, 0.35);
  const biasCenter = 0.5 + combinedBias;

  const chipCfg = config.chip || {};
  const chipDensity = Math.max(0, chipCfg.density || 0) * effectStrength;
  const chipStrength = Math.max(0, chipCfg.strength || 0) * effectStrength;
  const chipFeather = Math.max(0.01, chipCfg.feather || 0.45);
  const chipSeed = (seed ^ (chipCfg.seed || 0)) >>> 0;

  const scratchCfg = config.scratch || {};
  const scratchStrength = Math.max(0, scratchCfg.strength || 0) * effectStrength;
  const baseScratchThreshold = clamp(Number.isFinite(scratchCfg.threshold) ? scratchCfg.threshold : 0.7, 0, 1 - 1e-3);
  const scratchThreshold = clamp(baseScratchThreshold + (1 - baseScratchThreshold) * (1 - clamp(effectStrength, 0, 1)), 0, 1 - 1e-3);
  const scratchScale = Math.max(1e-3, scratchCfg.scale || 1);
  const scratchAspect = Math.max(1e-3, scratchCfg.aspect || 0.25);
  const scratchSeed = (seed ^ (scratchCfg.seed || 0)) >>> 0;
  const scratchDir = normalizeDirection(scratchCfg.direction);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const alpha = data[idx + 3];
        if (alpha <= 0) continue;
        let a = alpha / 255;
        const xCss = (x / dpPerCss) + jitterX;
        const yCss = (y / dpPerCss) + jitterY;

        let noiseVal = 0.5;
        if (octaves.length && weightSum > 0) {
          let accum = 0;
          for (let i = 0; i < octaves.length; i++) {
            const oct = octaves[i];
            const scaleCss = Math.max(1e-3, charWidth * Math.max(0.01, oct.scale || 1));
            const w = Math.max(0, oct.weight || 0);
            if (w <= 0) continue;
            const oSeed = (seed ^ (oct.seed || 0)) >>> 0;
            accum += w * valueNoise2D(xCss, yCss, scaleCss, oSeed);
          }
          noiseVal = accum / weightSum;
        }

        const mod = clamp(1 - (biasCenter - noiseVal) * noiseStrength, noiseFloor, 1);
        a *= mod;

        if (chipDensity > 0 && chipStrength > 0) {
          const chipNoise = hash2(x, y, chipSeed);
          if (chipNoise < chipDensity) {
            const t = chipNoise / Math.max(chipDensity, 1e-6);
            const falloff = Math.pow(1 - t, chipFeather);
            a *= Math.max(0, 1 - chipStrength * falloff);
            if (chipNoise < chipDensity * 0.12) a *= 0.05;
          }
        }

        if (scratchStrength > 0) {
          const proj = xCss * scratchDir.x + yCss * scratchDir.y;
          const ortho = xCss * (-scratchDir.y) + yCss * scratchDir.x;
          const scratchVal = valueNoise2D(proj * scratchScale, ortho * scratchAspect, scratchSeed);
          if (scratchVal > scratchThreshold) {
            const t = (scratchVal - scratchThreshold) / Math.max(1e-6, 1 - scratchThreshold);
            a *= Math.max(0, 1 - t * scratchStrength);
          }
        }

        data[idx + 3] = Math.round(clamp(a, 0, 1) * 255);
      }
    }
  }

function applyEdgeBleed(ctx, options) {
  const { config, text, x, y, color, baseSeed, strength } = options || {};
  if (!config || !config.enabled || !text) return;
  const intensity = clamp(Number(strength) || 0, 0, 1);
  if (intensity <= 0) return;
  const passes = Array.isArray(config.passes) ? config.passes : [];
  if (!passes.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      const strokes = Math.max(1, pass.strokes | 0);
      const jitterBase = Number.isFinite(pass.jitter) ? pass.jitter : 0;
      const jitter = jitterBase * intensity;
      const jitterYBase = Number.isFinite(pass.jitterY) ? pass.jitterY : jitterBase;
      const jitterY = jitterYBase * intensity;
      const width = Math.max(0.01, pass.width || 0.5);
      const alpha = clamp((pass.alpha ?? 0.12) * intensity, 0, 1);
      const lighten = clamp((pass.lighten ?? 0.4) * intensity, 0, 1);
      const strokeColor = lightenHexColor(color, lighten);
      ctx.lineWidth = width;
      ctx.strokeStyle = strokeColor;
      for (let s = 0; s < strokes; s++) {
        const localSeed = (baseSeed ^ Math.imul((i + 1) * 0x45D9F3B, (s + 1))) ^ (pass.seed || 0);
        const ox = (hash2((s + 1) * 17, (i + 3) * 131, localSeed) - 0.5) * jitter;
        const oy = (hash2((s + 4) * 23, (i + 5) * 151, localSeed ^ 0x9E3779B1) - 0.5) * jitterY;
        const alphaJitter = alpha * (0.75 + 0.25 * hash2((s + 7) * 29, (i + 11) * 37, localSeed ^ 0xA5A5A5A5));
        ctx.globalAlpha = clamp(alphaJitter, 0, 1);
        ctx.strokeText(text, x + ox, y + oy);
      }
    }
    ctx.restore();
  }

  function ensureAtlas(ink, variantIdx = 0, effectOverride = 'auto') {
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

    const powderLevel = (effectsAllowed && powderEnabled) ? quantizeEffectLevel(Math.min(1, powderStrength)) : 0;
    const textureLevel = (effectsAllowed && textureEnabled) ? quantizeEffectLevel(Math.min(1, textureStrength)) : 0;
    const fuzzLevel = (effectsAllowed && fuzzEnabled) ? 1 : 0;
    const key = `${ink}|v${variantIdx | 0}|fx${effectsAllowed ? 1 : 0}|p${powderLevel}|t${textureLevel}|f${fuzzLevel}`;
    let atlas = atlases.get(key);
    if (atlas) return atlas;

    const ASC = getAscFn();
    const DESC = getDescFn();
    const CHAR_W = getCharWidthFn();
    const FONT_SIZE = getFontSizeFn();
    const ACTIVE_FONT_NAME = getActiveFontNameFn();
    const RENDER_SCALE = getRenderScaleFn();
    const COLORS = colors;
    const INK_TEXTURE = inkTextureConfig();
    const EDGE_BLEED = edgeBleedConfig();
    const POWDER_CFG = getPowderConfig();
    const FUZZ_CFG = getFuzzConfig();
    const textureVoidsBias = clamp(Number((INK_TEXTURE && INK_TEXTURE.textureVoidsBias) || 0) + getTextureVoidsBiasFn(), -1, 1);
    const powderStrengthBase = getPowderStrengthFn();
    const textureStrengthBase = getTextureStrengthFn();
    const fuzzStrengthBase = getFuzzStrengthFn();
    const bleedStrengthBase = getBleedStrengthFn();
    const powderStrength = clamp((POWDER_CFG?.powderStrength || 0) * powderStrengthBase, 0, 2);
    const textureStrength = clamp((INK_TEXTURE?.textureStrength || 1) * textureStrengthBase, 0, 2);
    const fuzzStrength = clamp(fuzzStrengthBase, 0, 1);
    const bleedStrength = clamp(bleedStrengthBase, 0, 1);

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

    const powderEnabled = effectsAllowed && POWDER_CFG?.enabled !== false && powderStrength > 0;
    const textureEnabled = INK_TEXTURE?.enabled && effectsAllowed && textureStrength > 0;
    const fuzzEnabled = effectsAllowed && FUZZ_CFG?.enabled !== false && fuzzStrength > 0;
    const safariSupersample = (isSafari && getStateZoomFn() >= safariSupersampleThreshold) ? 2 : 1;
    const textureSupersample = textureEnabled ? Math.max(1, INK_TEXTURE.supersample | 0) : 1;
    const sampleScale = Math.max(safariSupersample, textureSupersample);
    const bleedEnabled = EDGE_BLEED.enabled && bleedStrength > 0 && effectsAllowed && (!Array.isArray(EDGE_BLEED.inks) || EDGE_BLEED.inks.includes(ink));
    const needsPipeline = textureEnabled || bleedEnabled || sampleScale > 1 || powderEnabled || fuzzEnabled;

    let glyphCanvas = null;
    let glyphCtx = null;
    let fuzzCanvas = null;
    let fuzzCtx = null;
    if (needsPipeline) {
      glyphCanvas = document.createElement('canvas');
      glyphCanvas.width = Math.max(1, cellW_draw_dp * sampleScale);
      glyphCanvas.height = Math.max(1, cellH_draw_dp * sampleScale);
      glyphCtx = glyphCanvas.getContext('2d', { willReadFrequently: true });
      glyphCtx.imageSmoothingEnabled = false;
    }
    if (fuzzEnabled) {
      fuzzCanvas = document.createElement('canvas');
      fuzzCanvas.width = width_dp;
      fuzzCanvas.height = height_dp;
      fuzzCtx = fuzzCanvas.getContext('2d');
      fuzzCtx.setTransform(1, 0, 0, 1, 0, 0);
      fuzzCtx.clearRect(0, 0, width_dp, height_dp);
    }

    const atlasSeed = ((state.altSeed >>> 0) ^ (state.grainSeed >>> 0) ^ Math.imul((variantIdx | 0) + 1, 0x9E3779B1) ^ Math.imul((ink.charCodeAt(0) || 0) + 0x51, 0x85EBCA77)) >>> 0;

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
        const snapFactor = RENDER_SCALE * (needsPipeline ? sampleScale : 1);
        const baseLocalX = -(n - 1) * adv - SHIFT_EPS;
        const baseLocalY = ORIGIN_Y_CSS;
        const localXSnapped = Math.round(baseLocalX * snapFactor) / snapFactor;
        const localYSnapped = Math.round(baseLocalY * snapFactor) / snapFactor;
        if (needsPipeline) {
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

          let hiData = null;
          if (powderEnabled || textureEnabled || fuzzEnabled) {
            hiData = glyphCtx.getImageData(0, 0, glyphCanvas.width, glyphCanvas.height);
          }
          let distanceInfo = null;
          if ((powderEnabled || fuzzEnabled) && hiData) {
            distanceInfo = buildDistanceInfo(hiData);
          }
          if (powderEnabled && distanceInfo) {
            applyPowderEffect(hiData, distanceInfo, {
              strength: powderStrength,
              grainScale: POWDER_CFG?.powderGrainScale || 1,
              edgeFalloff: POWDER_CFG?.powderEdgeFalloff || 1.6,
              coherence: POWDER_CFG?.powderCoherence || 0.5,
              renderScale: RENDER_SCALE * sampleScale,
              charWidth: CHAR_W,
              seed: glyphSeed,
            });
          }
          if (textureEnabled && hiData) {
            applyInkTexture(hiData, {
              config: INK_TEXTURE,
              renderScale: RENDER_SCALE,
              sampleScale,
              charWidth: CHAR_W,
              seed: glyphSeed,
              strength: textureStrength,
              voidsBias: textureVoidsBias,
            });
          }
          if ((powderEnabled || textureEnabled) && hiData) {
            glyphCtx.putImageData(hiData, 0, 0);
          }

          if (bleedEnabled) {
            glyphCtx.save();
            glyphCtx.setTransform(RENDER_SCALE * sampleScale, 0, 0, RENDER_SCALE * sampleScale, 0, 0);
            glyphCtx.font = `400 ${FONT_SIZE}px "${ACTIVE_FONT_NAME}"`;
            glyphCtx.textAlign = 'left';
            glyphCtx.textBaseline = 'alphabetic';
            applyEdgeBleed(glyphCtx, {
              config: EDGE_BLEED,
              text,
              x: localXSnapped,
              y: localYSnapped,
              color: COLORS[ink] || '#000',
              baseSeed: glyphSeed,
              strength: bleedStrength,
            });
            glyphCtx.restore();
          }

          const finalHiData = glyphCtx.getImageData(0, 0, glyphCanvas.width, glyphCanvas.height);
          let fuzzImageData = null;
          if (fuzzEnabled && distanceInfo) {
            const inkColor = parseColorToRGB(COLORS[ink] || '#000');
            fuzzImageData = generateFuzzImageData(distanceInfo, {
              config: FUZZ_CFG,
              strength: fuzzStrength,
              renderScale: RENDER_SCALE * sampleScale,
              charWidth: CHAR_W,
              seed: glyphSeed,
              color: inkColor,
            });
          }

          let finalImageData;
          if (sampleScale === 1) {
            finalImageData = finalHiData;
          } else {
            finalImageData = downsampleImageData(finalHiData, sampleScale, cellW_draw_dp, cellH_draw_dp);
            if (fuzzImageData) {
              fuzzImageData = downsampleImageData(fuzzImageData, sampleScale, cellW_draw_dp, cellH_draw_dp);
            }
          }

          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.putImageData(finalImageData, destX_dp, destY_dp);
          ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
          ctx.imageSmoothingEnabled = false;
          ctx.font = `400 ${FONT_SIZE}px "${ACTIVE_FONT_NAME}"`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';

          if (fuzzEnabled && fuzzImageData && fuzzCtx) {
            fuzzCtx.putImageData(fuzzImageData, destX_dp, destY_dp);
          }
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
    atlas = { canvas, fuzzCanvas, cellW_css: CELL_W_CSS, cellH_css: CELL_H_CSS, cellW_draw_dp, cellH_draw_dp, originY_css: ORIGIN_Y_CSS, rectDpByCode };
    atlases.set(key, atlas);
    window.atlasStats.builds++;
    return atlas;
  }

  function variantIndexForCell(pageIndex, rowMu, col) {
    if (ALT_VARIANTS <= 1) return 0;
    let h = ((state.altSeed ^ state.grainSeed) >>> 0);
    h ^= Math.imul((pageIndex + 1) | 0, 0x9E3779B1);
    h ^= Math.imul((rowMu + 0x10001) | 0, 0x85EBCA77);
    h ^= Math.imul((col + 0x4001) | 0, 0xC2B2AE3D);
    h ^= (h >>> 16);
    return (h >>> 0) % ALT_VARIANTS;
  }

  function drawGlyph(ctx, ch, ink, x_css, baselineY_css, layerIndex, totalLayers, pageIndex, rowMu, col, effectsOverride = 'auto') {
    let overrideMode = effectsOverride;
    let allowFuzz = true;
    if (effectsOverride && typeof effectsOverride === 'object') {
      overrideMode = effectsOverride.mode ?? 'auto';
      if (effectsOverride.allowFuzz === false) allowFuzz = false;
    }
    const atlas = ensureAtlas(ink, variantIndexForCell(pageIndex | 0, rowMu | 0, col | 0), overrideMode);
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
    if (allowFuzz && atlas.fuzzCanvas) {
      ctx.drawImage(atlas.fuzzCanvas, rect.sx_dp, rect.sy_dp, rect.sw_dp, rect.sh_dp, dx_css, dy_css, atlas.cellW_css, atlas.cellH_css);
    }
    window.atlasStats.draws++;
    window.atlasStats.perInk[ink] = (window.atlasStats.perInk[ink] || 0) + 1;
  }

  function ensureGrain(page) {
    const cfg = grainConfig();
    if (!cfg.enabled || !isInkSectionEnabled('grain')) return;
    const W = app.PAGE_W | 0;
    const H = app.PAGE_H | 0;
    if (page.grainCanvas && page.grainForSize.w === W && page.grainForSize.h === H) return;
    const seed = (state.grainSeed ^ ((page.index + 1) * 0x9E3779B1)) >>> 0;
    const cnv = document.createElement('canvas');
    cnv.width = W;
    cnv.height = H;
    const ctx = cnv.getContext('2d');
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const CHAR_W = getCharWidth();
    const sBase = Math.max(1, CHAR_W * (cfg.base_scale_from_char_w || 0.05));
    const rels = cfg.octave_rel_scales || [0.8, 1.2, 0.5];
    const wgts = cfg.octave_weights || [0.42, 0.33, 0.15];
    const octSeeds = (cfg.seeds && cfg.seeds.octave) || [0xA5A5A5A5, 0x5EEDFACE, 0x13579BDF];
    const sArr = rels.map(r => Math.max(1, sBase * r));
    const wArr = wgts.slice(0, sArr.length);
    const wHash = cfg.pixel_hash_weight ?? 0.10;
    const postGamma = cfg.post_gamma || 1.0;
    const hashSeed = (cfg.seeds && cfg.seeds.hash) || 0x5F356495;
    let p = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (let i = 0; i < sArr.length; i++) {
          v += (wArr[i] || 0) * valueNoise2D(x, y, sArr[i], seed ^ (octSeeds[i] || 0));
        }
        v += wHash * hash2(x, y, seed ^ hashSeed);
        v = Math.min(1, Math.max(0, v));
        if (postGamma !== 1) v = Math.pow(v, postGamma);
        data[p + 3] = (v * 255) | 0;
        p += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
    page.grainCanvas = cnv;
    page.grainForSize = { w: W, h: H };
  }

  function grainAlpha() {
    if (!isInkSectionEnabled('grain')) return 0;
    const cfg = grainConfig();
    if (!cfg.enabled) return 0;
    const overall = clamp(getInkEffectFactor(), 0, 1);
    if (overall <= 0) return 0;
    const s = clamp((state.grainPct || 0) / 100, 0, 1);
    if (s <= 0) return 0;
    const mixPow = clamp(cfg.alpha?.mix_pow ?? 0.45, 0, 1);
    const lowPow = Math.max(0.01, cfg.alpha?.low_pow ?? 0.55);
    const eased = mixPow * Math.pow(s, lowPow) + (1 - mixPow) * s;
    const aMin = clamp(cfg.alpha?.min ?? 0, 0, 1);
    const aMax = clamp(cfg.alpha?.max ?? 0.4, 0, 1);
    const alpha = clamp(aMin + eased * (aMax - aMin), 0, 1);
    return clamp(alpha * overall, 0, 1);
  }

  function applyGrainOverlayOnRegion(page, y_css, h_css) {
    const a = grainAlpha();
    if (a <= 0 || h_css <= 0) return;
    ensureGrain(page);
    const { ctx } = page;
    if (!ctx) return;
    const sy = Math.max(0, Math.floor(y_css));
    const sh = Math.max(0, Math.min(app.PAGE_H - sy, Math.ceil(h_css)));
    if (sh <= 0) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = a;
    ctx.drawImage(page.grainCanvas, 0, sy, app.PAGE_W, sh, 0, sy, app.PAGE_W, sh);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, sy, app.PAGE_W, sh);
    ctx.restore();
  }

  if (context?.setCallback) {
    context.setCallback('rebuildAllAtlases', rebuildAllAtlases);
  }

  return { rebuildAllAtlases, drawGlyph, applyGrainOverlayOnRegion };
}
