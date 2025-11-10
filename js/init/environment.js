import { createDomRefs } from '../utils/domElements.js';
import { computeBaseMetrics } from '../config/metrics.js';

export const DEFAULT_CANVAS_DIMENSION_CAP = 8192;
const MIN_CANVAS_DIMENSION_CAP = 1024;
const CANVAS_DIMENSION_CANDIDATES = [
  16384,
  15360,
  14336,
  13312,
  12288,
  11000,
  9830,
  9216,
  8192,
  7168,
  6144,
  4096,
];

let cachedCanvasDimensionLimit = null;

export function detectCanvasDimensionLimit() {
  if (cachedCanvasDimensionLimit) return cachedCanvasDimensionLimit;
  const fallback = { width: DEFAULT_CANVAS_DIMENSION_CAP, height: DEFAULT_CANVAS_DIMENSION_CAP };
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    cachedCanvasDimensionLimit = fallback;
    return cachedCanvasDimensionLimit;
  }

  try {
    const probeCanvas = document.createElement('canvas');
    if (!probeCanvas || typeof probeCanvas.getContext !== 'function') {
      cachedCanvasDimensionLimit = fallback;
      return cachedCanvasDimensionLimit;
    }

    const probeDimension = (dimension) => {
      const other = dimension === 'width' ? 'height' : 'width';
      for (const size of CANVAS_DIMENSION_CANDIDATES) {
        try {
          probeCanvas.width = dimension === 'width' ? size : 1;
          probeCanvas.height = dimension === 'height' ? size : 1;
          const ctx = probeCanvas.getContext('2d');
          if (!ctx) continue;
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, 1, 1);
          ctx.getImageData(0, 0, 1, 1);
          if (probeCanvas[dimension] === size && probeCanvas[other] >= 1) {
            return size;
          }
        } catch (err) {
          continue;
        }
      }
      return fallback[dimension];
    };

    const widthLimit = probeDimension('width');
    const heightLimit = probeDimension('height');
    cachedCanvasDimensionLimit = {
      width: Math.max(MIN_CANVAS_DIMENSION_CAP, widthLimit || fallback.width),
      height: Math.max(MIN_CANVAS_DIMENSION_CAP, heightLimit || fallback.height),
    };
  } catch (err) {
    cachedCanvasDimensionLimit = fallback;
  }

  return cachedCanvasDimensionLimit;
}

export function createEnvironment() {
  const app = createDomRefs();
  const metrics = computeBaseMetrics(app);
  const canvasDimensionLimit = detectCanvasDimensionLimit();
  return { app, metrics, canvasDimensionLimit };
}
