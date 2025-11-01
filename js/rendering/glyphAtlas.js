import { clamp } from '../utils/math.js';
import { normalizeInkTextureConfig } from '../config/inkConfig.js';

const DEFAULT_SECTION_ORDER = ['fill', 'texture', 'fuzz', 'bleed', 'grain'];

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
    getCenterThickenFactor: getCenterThickenFactorOpt,
    getEdgeThinFactor: getEdgeThinFactorOpt,
    getInkEffectFactor,
    getInkSectionStrength,
    getInkSectionOrder,
    isInkSectionEnabled,
    inkTextureConfig,
    edgeFuzzConfig,
    edgeBleedConfig,
    grainConfig,
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
  const getCenterThickenFactorFn = typeof getCenterThickenFactorOpt === 'function' ? getCenterThickenFactorOpt : (() => 1);
  const getEdgeThinFactorFn = typeof getEdgeThinFactorOpt === 'function' ? getEdgeThinFactorOpt : (() => 1);
  const getInkSectionOrderFn = typeof getInkSectionOrder === 'function'
    ? getInkSectionOrder
    : (() => DEFAULT_SECTION_ORDER);
  const ALT_VARIANTS = 9;
  const atlases = new Map();
  const grainBaseCache = new Map();
  const grainPageCache = new Map();
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

  function buildGrainBaseCanvas({
    width,
    height,
    oversample,
    seed,
    sArr,
    wArr,
    wHash,
    gamma,
    hashSeed,
    tilePeriodX = 0,
    tilePeriodY = 0,
    octSeeds = [],
  }) {
    const hiW = Math.max(1, Math.round(width * oversample));
    const hiH = Math.max(1, Math.round(height * oversample));
    const tileable = tilePeriodX > 0 && tilePeriodY > 0;
    const imageData = new ImageData(hiW, hiH);
    const data = imageData.data;
    const totalOctaves = Array.isArray(sArr) ? sArr.length : 0;
    let idx = 0;
    for (let y = 0; y < hiH; y++) {
      const sampleY = y / oversample;
      for (let x = 0; x < hiW; x++) {
        const sampleX = x / oversample;
        let v = 0;
        for (let i = 0; i < totalOctaves; i++) {
          const weight = Number.isFinite(wArr[i]) ? wArr[i] : 0;
          if (weight === 0) continue;
          const scale = Math.max(1e-3, sArr[i] || 1);
          const octaveSeed = (octSeeds[i] ?? octSeeds[octSeeds.length - 1] ?? 0) >>> 0;
          const noiseSeed = (seed ^ octaveSeed) >>> 0;
          const noise = tileable
            ? tileableValueNoise2D(sampleX, sampleY, scale, noiseSeed, tilePeriodX, tilePeriodY)
            : valueNoise2D(sampleX, sampleY, scale, noiseSeed);
          v += weight * noise;
        }
        if (wHash > 0) {
          const hashContribution = tileable
            ? tileableHash2(sampleX, sampleY, (seed ^ hashSeed) >>> 0, tilePeriodX, tilePeriodY)
            : hash2(x, y, (seed ^ hashSeed) >>> 0);
          v += wHash * hashContribution;
        }
        v = clamp(v, 0, 1);
        if (gamma !== 1) {
          v = Math.pow(v, gamma);
        }
        const alpha = Math.round(v * 255);
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = alpha;
        idx += 4;
      }
    }
    let finalData = imageData;
    if (oversample > 1) {
      finalData = downsampleImageData(imageData, oversample, width, height);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(finalData, 0, 0);
    return canvas;
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

  function createDistanceMapProvider(imageData) {
    let cached = null;
    return () => {
      if (!cached) {
        cached = computeDistanceMaps(imageData);
      }
      return cached;
    };
  }

  function generateNoiseField(width, height, dpPerCss, jitterX, jitterY, charWidth, noiseCfg, smoothing) {
    if (!noiseCfg || typeof noiseCfg !== 'object') return null;
    const scaleBase = Number.isFinite(noiseCfg.scale) ? noiseCfg.scale : 1;
    const scaleCss = Math.max(1e-3, charWidth * Math.max(0.01, scaleBase));
    const seed = (noiseCfg.seed >>> 0) || 0;
    const rawWeight = Number.isFinite(noiseCfg.hashWeight) ? clamp(noiseCfg.hashWeight, 0, 1) : 0;
    const includeHash = rawWeight > 0;
    const hashWeight = includeHash ? rawWeight : 0;
    const baseWeight = includeHash ? 1 - hashWeight : 1;
    const total = width * height;
    const raw = new Float32Array(total);
    let idx = 0;
    for (let y = 0; y < height; y++) {
      const yCss = (y / dpPerCss) + jitterY;
      for (let x = 0; x < width; x++) {
        const xCss = (x / dpPerCss) + jitterX;
        let value = valueNoise2D(xCss, yCss, scaleCss, seed);
        if (includeHash) {
          const hash = hash2(x, y, seed ^ 0x9E3779B1);
          value = value * baseWeight + hash * hashWeight;
        }
        raw[idx++] = value;
      }
    }

    const smoothAmt = clamp(Number.isFinite(smoothing) ? smoothing : 0, 0, 1);
    if (smoothAmt <= 0) return raw;

    const factor = Math.max(2, Math.round(1 + smoothAmt * 5));
    const sampleW = Math.max(1, Math.round(width / factor));
    const sampleH = Math.max(1, Math.round(height / factor));
    const low = new Float32Array(sampleW * sampleH);
    for (let sy = 0; sy < sampleH; sy++) {
      const sampleY = (sy + 0.5) * height / sampleH;
      const yCss = (sampleY / dpPerCss) + jitterY;
      for (let sx = 0; sx < sampleW; sx++) {
        const sampleX = (sx + 0.5) * width / sampleW;
        const xCss = (sampleX / dpPerCss) + jitterX;
        let value = valueNoise2D(xCss, yCss, scaleCss, seed);
        if (includeHash) {
          const hash = hash2(Math.floor(sampleX), Math.floor(sampleY), seed ^ 0x9E3779B1);
          value = value * baseWeight + hash * hashWeight;
        }
        low[sy * sampleW + sx] = value;
      }
    }

    const smooth = new Float32Array(total);
    for (let y = 0; y < height; y++) {
      const fy = ((y + 0.5) / height) * sampleH - 0.5;
      const y0 = Math.max(0, Math.floor(fy));
      const y1 = Math.min(sampleH - 1, y0 + 1);
      const ty = clamp(fy - y0, 0, 1);
      for (let x = 0; x < width; x++) {
        const fx = ((x + 0.5) / width) * sampleW - 0.5;
        const x0 = Math.max(0, Math.floor(fx));
        const x1 = Math.min(sampleW - 1, x0 + 1);
        const tx = clamp(fx - x0, 0, 1);
        const i00 = low[y0 * sampleW + x0];
        const i10 = low[y0 * sampleW + x1];
        const i01 = low[y1 * sampleW + x0];
        const i11 = low[y1 * sampleW + x1];
        const v0 = i00 + (i10 - i00) * tx;
        const v1 = i01 + (i11 - i01) * tx;
        smooth[y * width + x] = v0 + (v1 - v0) * ty;
      }
    }

    const mixA = 1 - smoothAmt;
    const mixB = smoothAmt;
    for (let i = 0; i < total; i++) {
      raw[i] = raw[i] * mixA + smooth[i] * mixB;
    }
    return raw;
  }

  function applyEdgeFuzz(imageData, options) {
    const {
      config,
      renderScale,
      sampleScale,
      color,
      baseSeed,
      overallStrength,
      sectionStrength,
    } = options || {};
    if (!config || !config.enabled) return;
    const combinedStrength = clamp((overallStrength || 0) * (sectionStrength || 0), 0, 1);
    if (combinedStrength <= 0) return;

    const centerThickenRaw = Number(getCenterThickenFactorFn());
    const edgeThinRaw = Number(getEdgeThinFactorFn());
    const centerThickenFactor = clamp(Number.isFinite(centerThickenRaw) ? centerThickenRaw : 1, 0, 2);
    const edgeThinFactor = clamp(Number.isFinite(edgeThinRaw) ? edgeThinRaw : 1, 0, 2);
    const centerThickenDelta = (centerThickenFactor - 1) * combinedStrength;
    const edgeThinDelta = (edgeThinFactor - 1) * combinedStrength;

    const totalBandCss = Math.max(0, Number(config.widthPx) || 0);
    if (totalBandCss <= 0) return;
    const dpPerCss = Math.max(1e-6, renderScale * sampleScale);
    const totalBandDp = totalBandCss * dpPerCss;
    if (totalBandDp <= 0) return;
    const inwardShare = clamp(Number(config.inwardShare ?? 0.5), 0, 1);
    const inwardDp = totalBandDp * inwardShare;
    const outwardDp = totalBandDp - inwardDp;
    if (inwardDp <= 0 && outwardDp <= 0) return;

    const width = imageData.width | 0;
    const height = imageData.height | 0;
    if (width <= 0 || height <= 0) return;
    const data = imageData.data;
    if (!data || data.length !== width * height * 4) return;

    const getDistanceMaps = options && typeof options.getDistanceMaps === 'function' ? options.getDistanceMaps : null;
    const maps = getDistanceMaps ? getDistanceMaps() : computeDistanceMaps(imageData);
    if (!maps || !maps.insideMask || !maps.distToInk || !maps.distToVoid || maps.inkPixelCount === 0) return;
    const { insideMask, distToInk, distToVoid } = maps;
    const rgb = parseColorToRgb(color);
    const baseOpacity = clamp(Number(config.opacity ?? 0.3), 0, 1) * combinedStrength;
    if (baseOpacity <= 0) return;
    const roughness = clamp(Number(config.roughness ?? 0.6), 0, 2);
    const frequencyCss = Math.max(1e-3, Number(config.frequency ?? 4));
    const noiseSeed = (baseSeed ^ (config.seed || 0)) >>> 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const inside = insideMask[idx] === 1;
        let coverage = 0;
        if (inside) {
          if (inwardDp <= 0) continue;
          const dist = distToVoid[idx];
          if (dist > inwardDp + 0.001) continue;
          coverage = 1 - clamp(dist / Math.max(inwardDp, 1e-3), 0, 1);
        } else {
          if (outwardDp <= 0) continue;
          const dist = distToInk[idx];
          if (dist <= 0) {
            coverage = 1;
          } else if (dist > outwardDp + 0.001) {
            continue;
          } else {
            coverage = 1 - clamp(dist / Math.max(outwardDp, 1e-3), 0, 1);
          }
        }
        if (coverage <= 0) continue;

        if (centerThickenDelta !== 0 && inside) {
          const normInside = clamp(distToVoid[idx] / maps.maxInsideDist, 0, 1);
          coverage *= clamp(1 + centerThickenDelta * normInside, 0, 2);
        }
        if (edgeThinDelta !== 0) {
          let edgeWeight;
          if (inside) {
            const normInside = clamp(distToVoid[idx] / maps.maxInsideDist, 0, 1);
            edgeWeight = 1 - normInside;
          } else if (outwardDp > 0) {
            const normOutside = clamp(distToInk[idx] / Math.max(outwardDp, 1e-3), 0, 1);
            edgeWeight = 1 - normOutside;
          } else {
            edgeWeight = 1;
          }
          coverage *= clamp(1 - edgeThinDelta * edgeWeight, 0, 2);
        }
        coverage = clamp(coverage, 0, 1);

        const xCss = x / dpPerCss;
        const yCss = y / dpPerCss;
        const coarseNoise = valueNoise2D(xCss, yCss, frequencyCss, noiseSeed);
        const speckleNoise = hash2(x, y, noiseSeed ^ 0x9E3779B1);
        const combinedNoise = (coarseNoise - 0.5) * 0.7 + (speckleNoise - 0.5) * 0.3;
        const jitter = clamp(1 + combinedNoise * roughness, 0, 2);
        const overlayAlpha = clamp(baseOpacity * coverage * jitter, 0, 1);
        if (overlayAlpha <= 0) continue;

        const baseIdx = idx * 4;
        const baseAlpha = data[baseIdx + 3] / 255;
        const outA = overlayAlpha + baseAlpha * (1 - overlayAlpha);
        const overlayR = rgb.r / 255;
        const overlayG = rgb.g / 255;
        const overlayB = rgb.b / 255;
        const baseR = data[baseIdx] / 255;
        const baseG = data[baseIdx + 1] / 255;
        const baseB = data[baseIdx + 2] / 255;
        let outR = overlayR * overlayAlpha + baseR * baseAlpha * (1 - overlayAlpha);
        let outG = overlayG * overlayAlpha + baseG * baseAlpha * (1 - overlayAlpha);
        let outB = overlayB * overlayAlpha + baseB * baseAlpha * (1 - overlayAlpha);
        if (outA > 1e-5) {
          outR /= outA;
          outG /= outA;
          outB /= outA;
        }
        data[baseIdx] = clamp(Math.round(outR * 255), 0, 255);
        data[baseIdx + 1] = clamp(Math.round(outG * 255), 0, 255);
        data[baseIdx + 2] = clamp(Math.round(outB * 255), 0, 255);
        data[baseIdx + 3] = clamp(Math.round(outA * 255), 0, 255);
      }
    }
  }

  function applyInkTexture(imageData, options) {
    const { config, renderScale, sampleScale, charWidth, seed, overallStrength, sectionStrength } = options || {};
    if (!config) return;
    const normalizedConfig = normalizeInkTextureConfig(config);
    if (!normalizedConfig || !normalizedConfig.enabled) return;
    const overall = clamp(Number.isFinite(overallStrength) ? overallStrength : getInkEffectFactor(), 0, 1);
    const section = clamp(Number.isFinite(sectionStrength) ? sectionStrength : getInkSectionStrengthFn('texture'), 0, 1);
    const combined = clamp(overall * section, 0, 1);
    if (combined <= 0) return;

    const centerThickenRaw = Number(getCenterThickenFactorFn());
    const edgeThinRaw = Number(getEdgeThinFactorFn());
    const centerThickenFactor = clamp(Number.isFinite(centerThickenRaw) ? centerThickenRaw : 1, 0, 2);
    const edgeThinFactor = clamp(Number.isFinite(edgeThinRaw) ? edgeThinRaw : 1, 0, 2);
    const centerThickenDelta = (centerThickenFactor - 1) * combined;
    const edgeThinDelta = (edgeThinFactor - 1) * combined;

    const data = imageData.data;
    const width = imageData.width | 0;
    const height = imageData.height | 0;
    if (!data || width <= 0 || height <= 0) return;

    const dpPerCss = Math.max(1e-6, renderScale * sampleScale);
    const jitterSeed = (seed ^ (normalizedConfig.jitterSeed || 0)) >>> 0;
    const jitterAmt = charWidth * 0.35;
    const jitterX = (hash2(1, 0, jitterSeed) - 0.5) * jitterAmt;
    const jitterY = (hash2(2, 0, jitterSeed) - 0.5) * jitterAmt;

    const smoothingAmt = clamp(Number(normalizedConfig.noiseSmoothing) || 0, 0, 1);
    const centerEdgeBias = clamp(Number(normalizedConfig.centerEdgeBias) || 0, -1, 1);
    const baseNoiseFloor = clamp(Number(normalizedConfig.noiseFloor) || 0, 0, 1);
    const noiseFloor = 1 - (1 - baseNoiseFloor) * combined;

    const coarseStrengthBase = Math.max(0, Number(normalizedConfig.coarseNoise?.strength) || 0);
    const fineStrengthBase = Math.max(0, Number(normalizedConfig.fineNoise?.strength) || 0);
    const coarseStrength = coarseStrengthBase * combined;
    const fineStrength = fineStrengthBase * combined;

    const coarseField = coarseStrength > 0
      ? generateNoiseField(width, height, dpPerCss, jitterX, jitterY, charWidth, normalizedConfig.coarseNoise, smoothingAmt)
      : null;
    const fineField = fineStrength > 0
      ? generateNoiseField(width, height, dpPerCss, jitterX, jitterY, charWidth, normalizedConfig.fineNoise, smoothingAmt * 0.6)
      : null;

    const needsBias = Math.abs(centerEdgeBias) > 1e-3;
    const getDistanceMaps = options && typeof options.getDistanceMaps === 'function' ? options.getDistanceMaps : null;
    const needsDistanceMaps = needsBias || Math.abs(centerThickenDelta) > 1e-6 || Math.abs(edgeThinDelta) > 1e-6;
    const maps = needsDistanceMaps && getDistanceMaps ? getDistanceMaps() : (needsBias ? getDistanceMaps?.() : null);
    const biasAvailable = !!(maps && maps.distToVoid && maps.maxInsideDist > 1e-6);
    const hasCenterEdgeTweaks = !!(maps && maps.insideMask && (Math.abs(centerThickenDelta) > 1e-6 || Math.abs(edgeThinDelta) > 1e-6));
    const biasUpperClamp = centerEdgeBias < 0 ? 1 + Math.min(0.3, -centerEdgeBias * 0.35) : 1;

    const chipCfg = normalizedConfig.chip || {};
    const chipEnabled = chipCfg.enabled !== false;
    const chipDensity = chipEnabled ? Math.max(0, chipCfg.density || 0) * combined : 0;
    const chipStrength = chipEnabled ? Math.max(0, chipCfg.strength || 0) * combined : 0;
    const chipFeather = Math.max(0.01, chipCfg.feather || 0.45);
    const chipSeed = (seed ^ (chipCfg.seed || 0)) >>> 0;

    const scratchCfg = normalizedConfig.scratch || {};
    const scratchEnabled = scratchCfg.enabled !== false;
    const scratchStrength = scratchEnabled ? Math.max(0, scratchCfg.strength || 0) * combined : 0;
    const baseScratchThreshold = clamp(Number.isFinite(scratchCfg.threshold) ? scratchCfg.threshold : 0.7, 0, 1 - 1e-3);
    const scratchThreshold = clamp(baseScratchThreshold + (1 - baseScratchThreshold) * (1 - combined), 0, 1 - 1e-3);
    const scratchScale = Math.max(1e-3, scratchCfg.scale || 1);
    const scratchAspect = Math.max(1e-3, scratchCfg.aspect || 0.25);
    const scratchSeed = (seed ^ (scratchCfg.seed || 0)) >>> 0;
    const scratchDir = normalizeDirection(scratchCfg.direction);

    const applyNoise = !!(coarseField || fineField || (biasAvailable && centerEdgeBias !== 0));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIdx = y * width + x;
        const idx = pixelIdx * 4;
        const alpha = data[idx + 3];
        if (alpha <= 0) continue;
        let a = alpha / 255;

        if (applyNoise) {
          let offset = 0;
          if (coarseField) offset += (0.5 - coarseField[pixelIdx]) * coarseStrength;
          if (fineField) offset += (0.5 - fineField[pixelIdx]) * fineStrength;
          if (biasAvailable) {
            const dist = maps.distToVoid[pixelIdx];
            const norm = clamp(dist / maps.maxInsideDist, 0, 1);
            offset += (0.5 - norm) * centerEdgeBias * 0.8;
          }
          if (offset !== 0 || noiseFloor < 1 || biasUpperClamp > 1) {
            const mod = clamp(1 - offset, noiseFloor, biasUpperClamp);
            a *= mod;
          }
        }

        if (hasCenterEdgeTweaks && maps.insideMask[pixelIdx]) {
          const norm = clamp(maps.distToVoid[pixelIdx] / maps.maxInsideDist, 0, 1);
          let modifier = 1;
          if (centerThickenDelta !== 0) {
            modifier *= clamp(1 + centerThickenDelta * norm, 0, 2);
          }
          if (edgeThinDelta !== 0) {
            const edgeWeight = 1 - norm;
            modifier *= clamp(1 - edgeThinDelta * edgeWeight, 0, 2);
          }
          if (modifier !== 1) {
            a *= modifier;
          }
        }

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
          const xCss = (x / dpPerCss) + jitterX;
          const yCss = (y / dpPerCss) + jitterY;
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
    const {
      config,
      color,
      baseSeed,
      overallStrength,
      sectionStrength,
      renderScale,
      sampleScale,
      charWidth,
      getDistanceMaps,
      imageData: providedImageData,
    } = options || {};
    const existingData = providedImageData || null;
    if (!config || !config.enabled) return { data: existingData, applied: false };
    const overall = clamp(Number.isFinite(overallStrength) ? overallStrength : getInkEffectFactor(), 0, 1);
    const section = clamp(Number.isFinite(sectionStrength) ? sectionStrength : getInkSectionStrengthFn('bleed'), 0, 1);
    const combined = clamp(overall * section, 0, 1);
    if (combined <= 0 || !isInkSectionEnabled('bleed')) return { data: existingData, applied: false };

    const widthCss = Math.max(0, Number(config.widthPx) || 0);
    if (widthCss <= 0) return { data: existingData, applied: false };
    const dpPerCss = Math.max(1e-6, (Number(renderScale) || 1) * (Number(sampleScale) || 1));
    const bleedWidthDp = widthCss * dpPerCss;
    if (bleedWidthDp <= 1e-3) return { data: existingData, applied: false };

    const provider = typeof getDistanceMaps === 'function' ? getDistanceMaps : null;
    const maps = provider ? provider() : null;
    if (!maps || !maps.distToInk || !maps.outsideMask) return { data: existingData, applied: false };
    const { width, height, distToInk, outsideMask } = maps;
    if (!width || !height) return { data: existingData, applied: false };

    const imageData = providedImageData || ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    if (!data || data.length !== width * height * 4) return { data: existingData, applied: false };

    const feather = Math.max(0.01, Number(config.feather) || 1);
    const baseIntensity = clamp(Number.isFinite(config.intensity) ? config.intensity : 0.22, 0, 1) * combined;
    if (baseIntensity <= 0) return { data: existingData, applied: false };
    const lightnessShift = clamp(Number(config.lightnessShift) || 0, 0, 1) * combined;
    const noiseRoughness = Math.max(0, Number(config.noiseRoughness) || 0);
    const noiseSeed = (baseSeed ^ (config.seed || 0)) >>> 0;
    const bleedColor = lightnessShift > 0 ? lightenHexColor(color, lightnessShift) : color;
    const bleedRgb = parseColorToRgb(bleedColor);

    const widthCssScaled = bleedWidthDp / dpPerCss;
    const charMetric = Number.isFinite(charWidth) && charWidth > 0 ? charWidth : widthCssScaled || 1;
    const coarseScaleCss = Math.max(0.05, (charMetric * 0.55) + (widthCssScaled * 0.75));
    const jitterSpanCss = widthCssScaled * 0.35;
    const jitterX = (hash2(17, 41, noiseSeed) - 0.5) * jitterSpanCss;
    const jitterY = (hash2(29, 11, noiseSeed ^ 0x9E3779B1) - 0.5) * jitterSpanCss;

    let applied = false;
    for (let y = 0; y < height; y++) {
      const yCss = (y / dpPerCss) + jitterY;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (outsideMask[idx] !== 1) continue;
        const dist = distToInk[idx];
        if (!Number.isFinite(dist) || dist <= 0 || dist > bleedWidthDp + 1) continue;
        let coverage = 1 - clamp(dist / Math.max(bleedWidthDp, 1e-3), 0, 1);
        if (coverage <= 0) continue;
        if (feather !== 1) {
          coverage = Math.pow(coverage, feather);
        }

        const xCss = (x / dpPerCss) + jitterX;
        const coarseNoise = valueNoise2D(xCss, yCss, coarseScaleCss, noiseSeed);
        const fineNoise = hash2(x, y, noiseSeed ^ 0xA5A5A5A5);
        const combinedNoise = (coarseNoise - 0.5) * 0.7 + (fineNoise - 0.5) * 0.3;
        const noiseMod = clamp(1 + combinedNoise * noiseRoughness, 0, 2);

        const srcAlpha = clamp(baseIntensity * coverage * noiseMod, 0, 1);
        if (srcAlpha <= 0) continue;

        const baseIdx = idx * 4;
        const destAlpha = data[baseIdx + 3] / 255;
        const outAlpha = destAlpha + srcAlpha * (1 - destAlpha);
        if (outAlpha <= 1e-6) continue;
        const invOutAlpha = 1 / outAlpha;

        const destR = data[baseIdx] / 255;
        const destG = data[baseIdx + 1] / 255;
        const destB = data[baseIdx + 2] / 255;

        const srcR = bleedRgb.r / 255;
        const srcG = bleedRgb.g / 255;
        const srcB = bleedRgb.b / 255;

        const outR = (destR * destAlpha + srcR * srcAlpha * (1 - destAlpha)) * invOutAlpha;
        const outG = (destG * destAlpha + srcG * srcAlpha * (1 - destAlpha)) * invOutAlpha;
        const outB = (destB * destAlpha + srcB * srcAlpha * (1 - destAlpha)) * invOutAlpha;

        data[baseIdx] = clamp(Math.round(outR * 255), 0, 255);
        data[baseIdx + 1] = clamp(Math.round(outG * 255), 0, 255);
        data[baseIdx + 2] = clamp(Math.round(outB * 255), 0, 255);
        data[baseIdx + 3] = clamp(Math.round(outAlpha * 255), 0, 255);
        applied = true;
      }
    }

    if (!providedImageData && applied) {
      ctx.putImageData(imageData, 0, 0);
    }
    return { data: imageData, applied };
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

    const overallStrength = clamp(getInkEffectFactor(), 0, 1);
    const textureSectionStrength = clamp(getInkSectionStrengthFn('texture'), 0, 1);
    const fuzzSectionStrength = clamp(getInkSectionStrengthFn('fuzz'), 0, 1);
    const bleedSectionStrength = clamp(getInkSectionStrengthFn('bleed'), 0, 1);
    const fuzzKey = (effectsAllowed && fuzzSectionStrength > 0 && isInkSectionEnabled('fuzz'))
      ? Math.round(fuzzSectionStrength * 100)
      : 0;
    const key = `${ink}|v${variantIdx | 0}|fx${effectsAllowed ? 1 : 0}|fz${fuzzKey}`;
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
    const EDGE_FUZZ = edgeFuzzConfig ? edgeFuzzConfig() : {};
    const EDGE_BLEED = edgeBleedConfig();

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

    const textureAllowed = INK_TEXTURE.enabled && effectsAllowed && textureSectionStrength > 0 && isInkSectionEnabled('texture');
    const useTexture = textureAllowed;
    const safariSupersample = (isSafari && getStateZoomFn() >= safariSupersampleThreshold) ? 2 : 1;
    const textureSupersample = useTexture ? Math.max(1, INK_TEXTURE.supersample | 0) : 1;
    const sampleScale = Math.max(safariSupersample, textureSupersample);
    const bleedEnabled = EDGE_BLEED.enabled
      && effectsAllowed
      && bleedSectionStrength > 0
      && isInkSectionEnabled('bleed')
      && (!Array.isArray(EDGE_BLEED.inks) || EDGE_BLEED.inks.includes(ink));
    const fuzzEnabled = EDGE_FUZZ.enabled
      && effectsAllowed
      && fuzzSectionStrength > 0
      && isInkSectionEnabled('fuzz')
      && (!Array.isArray(EDGE_FUZZ.inks) || EDGE_FUZZ.inks.includes(ink));
    const needsPipeline = useTexture || bleedEnabled || fuzzEnabled || sampleScale > 1;

    let glyphCanvas = null;
    let glyphCtx = null;
    if (needsPipeline) {
      glyphCanvas = document.createElement('canvas');
      glyphCanvas.width = Math.max(1, cellW_draw_dp * sampleScale);
      glyphCanvas.height = Math.max(1, cellH_draw_dp * sampleScale);
      glyphCtx = glyphCanvas.getContext('2d', { willReadFrequently: true });
      glyphCtx.imageSmoothingEnabled = false;
    }

    const atlasSeed = ((state.altSeed >>> 0) ^ Math.imul((variantIdx | 0) + 1, 0x9E3779B1) ^ Math.imul((ink.charCodeAt(0) || 0) + 0x51, 0x85EBCA77)) >>> 0;

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

          const sectionOrder = getInkSectionOrderFn();
          const pipelineOrder = Array.isArray(sectionOrder) && sectionOrder.length
            ? sectionOrder
            : DEFAULT_SECTION_ORDER;
          let glyphData = null;
          if (useTexture || fuzzEnabled || bleedEnabled) {
            glyphData = glyphCtx.getImageData(0, 0, glyphCanvas.width, glyphCanvas.height);
          }
          const distanceProvider = glyphData ? createDistanceMapProvider(glyphData) : null;
          let glyphDataDirty = false;
          for (const sectionId of pipelineOrder) {
            if (sectionId === 'texture') {
              if (useTexture && glyphData) {
                applyInkTexture(glyphData, {
                  config: INK_TEXTURE,
                  renderScale: RENDER_SCALE,
                  sampleScale,
                  charWidth: CHAR_W,
                  seed: glyphSeed,
                  overallStrength,
                  sectionStrength: textureSectionStrength,
                  getDistanceMaps: distanceProvider,
                });
                glyphDataDirty = true;
              }
              continue;
            }
            if (sectionId === 'fuzz') {
              if (fuzzEnabled && glyphData) {
                applyEdgeFuzz(glyphData, {
                  config: EDGE_FUZZ,
                  renderScale: RENDER_SCALE,
                  sampleScale,
                  color: COLORS[ink] || '#000',
                  baseSeed: glyphSeed,
                  overallStrength,
                  sectionStrength: fuzzSectionStrength,
                  getDistanceMaps: distanceProvider,
                });
                glyphDataDirty = true;
              }
              continue;
            }
            if (sectionId === 'bleed') {
              if (bleedEnabled) {
                if (!glyphData) {
                  glyphData = glyphCtx.getImageData(0, 0, glyphCanvas.width, glyphCanvas.height);
                }
                const result = applyEdgeBleed(glyphCtx, {
                  config: EDGE_BLEED,
                  color: COLORS[ink] || '#000',
                  baseSeed: glyphSeed,
                  overallStrength,
                  sectionStrength: bleedSectionStrength,
                  renderScale: RENDER_SCALE,
                  sampleScale,
                  charWidth: CHAR_W,
                  getDistanceMaps: distanceProvider,
                  imageData: glyphData,
                });
                if (result && result.data) {
                  glyphData = result.data;
                  if (result.applied) {
                    glyphDataDirty = true;
                  }
                }
              }
            }
          }
          if (glyphData && glyphDataDirty) {
            glyphCtx.putImageData(glyphData, 0, 0);
          }

          glyphCtx.setTransform(1, 0, 0, 1, 0, 0);
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
    atlas = { canvas, cellW_css: CELL_W_CSS, cellH_css: CELL_H_CSS, cellW_draw_dp, cellH_draw_dp, originY_css: ORIGIN_Y_CSS, rectDpByCode };
    atlases.set(key, atlas);
    window.atlasStats.builds++;
    return atlas;
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

  function ensureGrain(page) {
    const cfg = grainConfig();
    if (!cfg || cfg.enabled === false || !isInkSectionEnabled('grain')) return;
    const W = app.PAGE_W | 0;
    const H = app.PAGE_H | 0;
    if (!(W > 0) || !(H > 0)) return;

    const oversample = Math.max(1, Math.round(Number.isFinite(cfg.oversample) ? cfg.oversample : 2));
    const scaleControl = Number.isFinite(cfg.scale) ? clamp(cfg.scale, 0.1, 8) : 1;
    const gamma = Number.isFinite(cfg.gamma)
      ? Math.max(0.01, cfg.gamma)
      : Number.isFinite(cfg.post_gamma)
        ? Math.max(0.01, cfg.post_gamma)
        : 1;
    const wHash = clamp(cfg.pixel_hash_weight ?? 0.10, 0, 1);

    const CHAR_W = getCharWidth();
    const sBase = Math.max(1, CHAR_W * (cfg.base_scale_from_char_w || 0.05)) * scaleControl;
    const rels = Array.isArray(cfg.octave_rel_scales) && cfg.octave_rel_scales.length
      ? cfg.octave_rel_scales
      : [0.8, 1.2, 0.5];
    const wgts = Array.isArray(cfg.octave_weights) && cfg.octave_weights.length
      ? cfg.octave_weights
      : [0.42, 0.33, 0.15];
    const octSeedsRaw = (cfg.seeds && cfg.seeds.octave) || [0xA5A5A5A5, 0x5EEDFACE, 0x13579BDF];
    const hashSeed = (cfg.seeds && cfg.seeds.hash) || 0x5F356495;
    const sArr = rels.map(r => Math.max(1, sBase * r));
    const wArr = sArr.map((_, i) => Number.isFinite(wgts[i]) ? wgts[i] : 0);
    const octSeeds = sArr.map((_, i) => (octSeedsRaw[i] ?? octSeedsRaw[octSeedsRaw.length - 1] ?? 0) >>> 0);

    const tileCfg = cfg.tile && typeof cfg.tile === 'object' ? cfg.tile : null;
    const tileEnabled = !!(tileCfg && tileCfg.enabled);
    const tileSizeRaw = Number(tileCfg?.size);
    const tileSize = tileEnabled
      ? Math.max(32, Math.min(2048, Number.isFinite(tileSizeRaw) ? Math.round(tileSizeRaw) : 512))
      : 0;
    const reuseTile = tileEnabled ? tileCfg.reuse !== false : false;
    const sharedSeed = Number.isFinite(state.grainSeed) ? state.grainSeed >>> 0 : 0;
    const pageSeed = (state.grainSeed ^ ((page.index + 1) * 0x9E3779B1)) >>> 0;
    const baseTileSeed = tileEnabled
      ? (reuseTile ? (Number.isFinite(tileCfg?.seed) ? tileCfg.seed >>> 0 : sharedSeed) : pageSeed)
      : pageSeed;

    const baseKeyParts = [
      oversample,
      sArr.map(v => v.toFixed(4)).join(','),
      wArr.map(v => v.toFixed(4)).join(','),
      wHash.toFixed(4),
      gamma.toFixed(4),
      hashSeed >>> 0,
      octSeeds.map(n => n.toString(16)).join(','),
    ];

    if (tileEnabled) {
      const tileKey = ['tile', tileSize, ...baseKeyParts, baseTileSeed >>> 0].join('|');
      const offsetX = randomOffset(pageSeed, tileSize, 0xA53A5A5A);
      const offsetY = randomOffset(pageSeed ^ 0x5A5A5A5A, tileSize, 0xC1A551C5);
      const finalKey = ['tilePage', W, H, tileKey, offsetX, offsetY].join('|');
      if (page.grainCanvas && page.grainForSize && page.grainForSize.key === finalKey) return;

      let tileEntry = grainBaseCache.get(tileKey);
      if (!tileEntry) {
        const tileCanvas = buildGrainBaseCanvas({
          width: tileSize,
          height: tileSize,
          oversample,
          seed: baseTileSeed >>> 0,
          sArr,
          wArr,
          wHash,
          gamma,
          hashSeed: hashSeed >>> 0,
          tilePeriodX: tileSize,
          tilePeriodY: tileSize,
          octSeeds,
        });
        tileEntry = { canvas: tileCanvas };
        grainBaseCache.set(tileKey, tileEntry);
      }

      const finalKeyExists = grainPageCache.get(finalKey);
      if (!finalKeyExists) {
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = W;
        finalCanvas.height = H;
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.imageSmoothingEnabled = true;
        const pattern = finalCtx.createPattern(tileEntry.canvas, 'repeat');
        if (pattern) {
          finalCtx.save();
          finalCtx.translate(-offsetX, -offsetY);
          finalCtx.fillStyle = pattern;
          finalCtx.fillRect(offsetX, offsetY, W + tileSize, H + tileSize);
          finalCtx.restore();
        } else {
          for (let ty = -offsetY; ty < H + tileSize; ty += tileSize) {
            for (let tx = -offsetX; tx < W + tileSize; tx += tileSize) {
              finalCtx.drawImage(tileEntry.canvas, tx, ty);
            }
          }
        }
        grainPageCache.set(finalKey, { canvas: finalCanvas });
      }

      const cachedPage = grainPageCache.get(finalKey);
      page.grainCanvas = cachedPage.canvas;
      page.grainForSize = { w: W, h: H, key: finalKey };
      return;
    }

    const finalKey = ['page', W, H, ...baseKeyParts, pageSeed >>> 0].join('|');
    if (page.grainCanvas && page.grainForSize && page.grainForSize.key === finalKey) return;
    if (!grainPageCache.has(finalKey)) {
      const canvas = buildGrainBaseCanvas({
        width: W,
        height: H,
        oversample,
        seed: pageSeed >>> 0,
        sArr,
        wArr,
        wHash,
        gamma,
        hashSeed: hashSeed >>> 0,
        tilePeriodX: 0,
        tilePeriodY: 0,
        octSeeds,
      });
      grainPageCache.set(finalKey, { canvas });
    }
    const cached = grainPageCache.get(finalKey);
    page.grainCanvas = cached.canvas;
    page.grainForSize = { w: W, h: H, key: finalKey };
  }

  function invalidateGrainCache() {
    grainBaseCache.clear();
    grainPageCache.clear();
  }

  function grainAlpha() {
    if (!isInkSectionEnabled('grain')) return 0;
    const cfg = grainConfig();
    if (!cfg.enabled) return 0;
    const overall = clamp(getInkEffectFactor(), 0, 1);
    if (overall <= 0) return 0;
    const section = clamp(getInkSectionStrengthFn('grain'), 0, 1);
    if (section <= 0) return 0;
    const s = section;
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
    const cfg = grainConfig();
    const blendMode = (cfg && (cfg.blend_mode || cfg.composite_op)) || 'destination-out';
    const baseOpacity = clamp(Number.isFinite(cfg?.opacity) ? cfg.opacity : 1, 0, 1);
    const finalAlpha = clamp(a * baseOpacity, 0, 1);
    if (finalAlpha <= 0) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = blendMode;
    ctx.globalAlpha = finalAlpha;
    ctx.drawImage(page.grainCanvas, 0, sy, app.PAGE_W, sh, 0, sy, app.PAGE_W, sh);
    if (blendMode === 'destination-out') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, sy, app.PAGE_W, sh);
    }
    ctx.restore();
  }

  if (context?.setCallback) {
    context.setCallback('rebuildAllAtlases', rebuildAllAtlases);
    context.setCallback('invalidateGrainCache', invalidateGrainCache);
  }

  return { rebuildAllAtlases, drawGlyph, applyGrainOverlayOnRegion, invalidateGrainCache };
}
