import { clamp01 } from './textureMath.js';
import { createDistanceMapProvider } from './distanceMaps.js';
import { createExperimentalStagePipeline, GLYPH_PIPELINE_ORDER } from './stagePipeline.js';

const { round } = Math;

export function createExperimentalGlyphProcessor(options = {}) {
  const {
    stageDeps,
    pipelineOrder: customOrder,
    imageDataFactory,
    distanceMapFactory = createDistanceMapProvider,
    stagePipelineFactory = createExperimentalStagePipeline,
  } = options;

  const stagePipeline = stagePipelineFactory(stageDeps);
  const pipelineOrder = Array.isArray(customOrder) && customOrder.length
    ? customOrder
    : stagePipeline.pipelineOrder || GLYPH_PIPELINE_ORDER;

  const makeImageData = typeof imageDataFactory === 'function'
    ? imageDataFactory
    : (data, width, height) => new ImageData(data, width, height);

  const coveragePool = new Map();

  const acquireCoverageBuffer = (w, h) => {
    const safeW = Number.isFinite(w) ? Math.max(0, Math.trunc(w)) : 0;
    const safeH = Number.isFinite(h) ? Math.max(0, Math.trunc(h)) : 0;
    const area = safeW * safeH;
    if (!area) return new Float32Array(0);
    const stack = coveragePool.get(area);
    if (stack && stack.length) {
      const buffer = stack.pop();
      buffer.fill(0);
      return buffer;
    }
    return new Float32Array(area);
  };

  const releaseCoverageBuffer = buffer => {
    if (!buffer || typeof buffer.length !== 'number') return;
    const area = buffer.length;
    if (!area) return;
    let stack = coveragePool.get(area);
    if (!stack) {
      stack = [];
      coveragePool.set(area, stack);
    }
    stack.push(buffer);
  };

  const ensureDistanceMap = shape => {
    if (!shape) return null;
    if (shape.distanceMapProvider) return shape.distanceMapProvider;
    return distanceMapFactory(shape);
  };

  const processGlyph = (shape, seed, gix, charCode, params) => {
    if (!shape) throw new Error('Glyph shape is required');
    const { w, h, alpha, img } = shape;
    if (!img || !img.data) throw new Error('Glyph shape is missing source image data');
    const output = makeImageData(new Uint8ClampedArray(img.data), w, h);
    const pixels = output.data;
    const dm = ensureDistanceMap(shape);
    const smul = params?.smul ?? 1;
    const context = {
      w,
      h,
      alpha0: alpha,
      params,
      seed,
      gix,
      smul,
      dm,
    };
    const coverage = acquireCoverageBuffer(w, h);
    try {
      stagePipeline.runPipeline(coverage, context, pipelineOrder);
      for (let i = 0, k = 0; i < w * h; i++, k += 4) {
        pixels[k] = 12;
        pixels[k + 1] = 12;
        pixels[k + 2] = 12;
        pixels[k + 3] = round(clamp01(coverage[i]) * 255);
      }
      return output;
    } finally {
      releaseCoverageBuffer(coverage);
    }
  };

  return {
    stagePipeline,
    pipelineOrder,
    processGlyph,
    acquireCoverageBuffer,
    releaseCoverageBuffer,
  };
}
