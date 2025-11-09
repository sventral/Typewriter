import { clamp } from '../../utils/math.js';
import { parseColorToRgb } from '../colorUtils.js';
import { downsampleImageData } from '../imageUtils.js';
import { createExperimentalGlyphProcessor } from './glyphProcessor.js';
import { computeInsideDistance, computeOutsideDistance, createDistanceMapProvider } from './distanceMaps.js';
import { GLYPH_PIPELINE_ORDER as EXPERIMENTAL_STAGE_ORDER } from './stagePipeline.js';

const EXPERIMENTAL_SECTION_IDS = ['expTone', 'expEdge', 'expGrain', 'expDefects'];
const EXPERIMENTAL_SECTION_STAGE_MAP = {
  expTone: ['fill', 'centerEdge'],
  expEdge: ['fuzz'],
  expGrain: ['texture'],
  expDefects: ['dropouts', 'punch', 'smudge'],
};

const processorCache = new Map();

export function resolveExperimentalStages(order) {
  const sectionOrder = Array.isArray(order) ? order : [];
  const requestedStages = new Set();
  sectionOrder.forEach(id => {
    const stages = EXPERIMENTAL_SECTION_STAGE_MAP[id];
    if (!stages) return;
    stages.forEach(stage => requestedStages.add(stage));
  });
  EXPERIMENTAL_SECTION_IDS.forEach(id => {
    const stages = EXPERIMENTAL_SECTION_STAGE_MAP[id];
    if (!stages) return;
    stages.forEach(stage => requestedStages.add(stage));
  });
  const finalOrder = EXPERIMENTAL_STAGE_ORDER.filter(stage => requestedStages.has(stage));
  return finalOrder.length ? finalOrder : EXPERIMENTAL_STAGE_ORDER.slice();
}

function getExperimentalProcessorForOrder(order) {
  const key = Array.isArray(order) && order.length ? order.join('-') : 'default';
  if (processorCache.has(key)) {
    return processorCache.get(key);
  }
  const processor = createExperimentalGlyphProcessor({ pipelineOrder: order && order.length ? order : undefined });
  processorCache.set(key, processor);
  return processor;
}

function defaultCreateCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined' && document?.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('No canvas factory available for experimental atlas build.');
}

export function buildExperimentalAtlas({
  ink,
  variantIdx = 0,
  effectsAllowed = true,
  overallStrength = 0,
  pipelineStages = [],
  baseConfig = {},
  fontMetrics = {},
  renderScale = 1,
  sampleScale = 1,
  asciiStart = 32,
  asciiEnd = 126,
  altSeed = 0,
  inkColor = '#000',
  createCanvas = defaultCreateCanvas,
} = {}) {
  const ASC = Number.isFinite(fontMetrics.asc) ? fontMetrics.asc : 36;
  const DESC = Number.isFinite(fontMetrics.desc) ? fontMetrics.desc : 12;
  const CHAR_W = Number.isFinite(fontMetrics.charWidth) ? fontMetrics.charWidth : 24;
  const FONT_SIZE = Number.isFinite(fontMetrics.fontSize) ? fontMetrics.fontSize : 48;
  const ACTIVE_FONT_NAME = fontMetrics.fontName || 'TT2020StyleE';
  const RENDER_SCALE = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
  const colorRgb = parseColorToRgb(inkColor || '#000');

  const ASCII_START = asciiStart | 0;
  const ASCII_END = asciiEnd | 0;
  const ATLAS_COLS = 32;

  const GLYPH_BLEED = Math.ceil((ASC + DESC) * 0.5);
  const ORIGIN_Y_CSS = ASC + GLYPH_BLEED;
  const CELL_W_CSS = CHAR_W;
  const CELL_H_CSS = Math.ceil(ASC + DESC + 2 * GLYPH_BLEED);
  const GUTTER_DP = 1;
  const cellW_draw_dp = Math.round(CELL_W_CSS * RENDER_SCALE);
  const cellH_draw_dp = Math.ceil(CELL_H_CSS * RENDER_SCALE);
  const cellW_pack_dp = cellW_draw_dp + 2 * GUTTER_DP;
  const cellH_pack_dp = cellH_draw_dp + 2 * GUTTER_DP;
  const ATLAS_ROWS = Math.ceil((ASCII_END - ASCII_START + 1) / ATLAS_COLS);
  const width_dp = Math.max(1, ATLAS_COLS * cellW_pack_dp);
  const height_dp = Math.max(1, ATLAS_ROWS * cellH_pack_dp);

  const canvas = createCanvas(width_dp, height_dp);
  canvas.width = width_dp;
  canvas.height = height_dp;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to acquire 2D context for experimental atlas.');
  }
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width_dp / RENDER_SCALE, height_dp / RENDER_SCALE);
  ctx.fillStyle = inkColor || '#000';
  ctx.font = `400 ${FONT_SIZE}px "${ACTIVE_FONT_NAME}"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.globalCompositeOperation = 'source-over';

  const rectDpByCode = [];
  const advCache = new Float32Array(ASCII_END + 1);
  const SHIFT_EPS = 0.5;
  const effectiveSampleScale = Math.max(1, Math.round(sampleScale));

  let glyphCanvas = null;
  let glyphCtx = null;
  if (effectsAllowed || effectiveSampleScale > 1) {
    glyphCanvas = createCanvas(
      Math.max(1, cellW_draw_dp * effectiveSampleScale),
      Math.max(1, cellH_draw_dp * effectiveSampleScale),
    );
    glyphCanvas.width = Math.max(1, cellW_draw_dp * effectiveSampleScale);
    glyphCanvas.height = Math.max(1, cellH_draw_dp * effectiveSampleScale);
    glyphCtx = glyphCanvas.getContext('2d', { willReadFrequently: true });
    if (!glyphCtx) {
      throw new Error('Failed to acquire glyph context for experimental atlas.');
    }
    glyphCtx.imageSmoothingEnabled = false;
  }

  const atlasSeed = ((altSeed >>> 0)
    ^ Math.imul((variantIdx | 0) + 1, 0x9E3779B1)
    ^ Math.imul((ink?.charCodeAt?.(0) || 0) + 0x51, 0x85EBCA77)) >>> 0;

  const cloneParams = () => ({
    enable: { ...(baseConfig.enable || {}) },
    ink: { ...(baseConfig.ink || {}) },
    ribbon: { ...(baseConfig.ribbon || {}) },
    bias: { ...(baseConfig.bias || {}) },
    noise: { ...(baseConfig.noise || {}) },
    centerEdge: { ...(baseConfig.centerEdge || {}) },
    dropouts: { ...(baseConfig.dropouts || {}) },
    edgeFuzz: { ...(baseConfig.edgeFuzz || {}) },
    smudge: { ...(baseConfig.smudge || {}) },
    punch: { ...(baseConfig.punch || {}) },
  });

  const processor = getExperimentalProcessorForOrder(pipelineStages);
  const stagePipeline = processor?.stagePipeline;
  const effectiveOrder = Array.isArray(pipelineStages) && pipelineStages.length
    ? pipelineStages
    : [];

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
      const snapFactor = RENDER_SCALE * (glyphCanvas ? effectiveSampleScale : 1);
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
        glyphCtx.setTransform(RENDER_SCALE * effectiveSampleScale, 0, 0, RENDER_SCALE * effectiveSampleScale, 0, 0);
        glyphCtx.fillStyle = inkColor || '#000';
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

        if (effectsAllowed && overallStrength > 0 && Array.isArray(effectiveOrder) && effectiveOrder.length) {
          const glyphWidth = glyphCanvas.width;
          const glyphHeight = glyphCanvas.height;
          const alpha = new Uint8Array(glyphWidth * glyphHeight);
          for (let i = 0, k = 0; i < alpha.length; i++, k += 4) alpha[i] = basePixels[k + 3];
          const inside = computeInsideDistance(alpha, glyphWidth, glyphHeight);
          const outside = computeOutsideDistance(alpha, glyphWidth, glyphHeight);
          const canRun = !!(inside?.dist && outside?.dist && inside.maxInside > 0);
          if (canRun && (stagePipeline || typeof processor.runGlyphPipeline === 'function')) {
            const params = cloneParams();
            const fontPxRaw = FONT_SIZE;
            const fontPx = Number.isFinite(fontPxRaw) && fontPxRaw > 0 ? fontPxRaw : 48;
            const supersample = clamp(
              Math.round(72 / Math.max(8, fontPx)),
              1,
              4,
            );
            params.smul = (fontPx / 72) * supersample;
            params.ink = { ...(params.ink || {}), colorRgb };
            const dpPerCss = Math.max(1e-6, (Number(RENDER_SCALE) || 1) * (Number(effectiveSampleScale) || 1));
            const dm = createDistanceMapProvider({
              insideDist: inside.dist,
              outsideDist: outside.dist,
              maxInside: inside.maxInside,
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
        if (effectiveSampleScale === 1) {
          finalImageData = glyphCtx.getImageData(0, 0, cellW_draw_dp, cellH_draw_dp);
        } else {
          const hiData = glyphCtx.getImageData(0, 0, glyphCanvas.width, glyphCanvas.height);
          finalImageData = downsampleImageData(hiData, effectiveSampleScale, cellW_draw_dp, cellH_draw_dp);
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
        const gutterCss = GUTTER_DP / RENDER_SCALE;
        ctx.rect(packX_css + gutterCss, packY_css + gutterCss, CELL_W_CSS, CELL_H_CSS);
        ctx.clip();
        const x0 = packX_css + gutterCss + localXSnapped;
        const y0 = packY_css + gutterCss + localYSnapped;
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

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const imageData = ctx.getImageData(0, 0, width_dp, height_dp);

  return {
    width: width_dp,
    height: height_dp,
    imageData,
    rectDpByCode,
    cellW_css: CELL_W_CSS,
    cellH_css: CELL_H_CSS,
    cellW_draw_dp,
    cellH_draw_dp,
    originY_css: ORIGIN_Y_CSS,
    sampleScale: effectiveSampleScale,
  };
}
