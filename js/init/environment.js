import { createDomRefs } from '../utils/domElements.js';
import { computeBaseMetrics } from '../config/metrics.js';

export const DEFAULT_CANVAS_DIMENSION_CAP = 8192;
const MIN_CANVAS_DIMENSION_CAP = 1024;
const CANVAS_DIMENSION_STORAGE_KEY = 'canvasDimensionLimit';
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

const scheduleIdle = (cb) => {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(cb);
  return setTimeout(cb, 0);
};

const readCachedCanvasLimit = () => {
  try {
    const sources = [];
    if (typeof sessionStorage !== 'undefined') sources.push(sessionStorage);
    if (typeof localStorage !== 'undefined') sources.push(localStorage);
    for (const storage of sources) {
      const raw = storage.getItem(CANVAS_DIMENSION_STORAGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (
        parsed
        && Number.isFinite(parsed.width)
        && Number.isFinite(parsed.height)
        && parsed.width >= MIN_CANVAS_DIMENSION_CAP
        && parsed.height >= MIN_CANVAS_DIMENSION_CAP
      ) {
        return {
          width: parsed.width,
          height: parsed.height,
        };
      }
    }
  } catch (err) {
    // ignore cache parse errors
  }
  return null;
};

const writeCachedCanvasLimit = (limit) => {
  if (!limit) return;
  try {
    const payload = JSON.stringify(limit);
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(CANVAS_DIMENSION_STORAGE_KEY, payload);
    if (typeof localStorage !== 'undefined') localStorage.setItem(CANVAS_DIMENSION_STORAGE_KEY, payload);
  } catch (err) {
    // ignore cache write errors
  }
};

export function detectCanvasDimensionLimit() {
  if (cachedCanvasDimensionLimit) return cachedCanvasDimensionLimit;
  const cached = readCachedCanvasLimit();
  if (cached) {
    cachedCanvasDimensionLimit = cached;
    return cachedCanvasDimensionLimit;
  }

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

    const probeDimension = (dimension, { stopAfterFirstFailure } = { stopAfterFirstFailure: false }) => {
      const other = dimension === 'width' ? 'height' : 'width';
      let lastSuccess = null;
      let nextIndex = CANVAS_DIMENSION_CANDIDATES.length;
      for (let i = 0; i < CANVAS_DIMENSION_CANDIDATES.length; i += 1) {
        const size = CANVAS_DIMENSION_CANDIDATES[i];
        try {
          probeCanvas.width = dimension === 'width' ? size : 1;
          probeCanvas.height = dimension === 'height' ? size : 1;
          // Hint frequent readbacks so Chrome avoids perf warning during probe loop
          const ctx = probeCanvas.getContext('2d', { willReadFrequently: true }) || probeCanvas.getContext('2d');
          if (!ctx) continue;
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, 1, 1);
          ctx.getImageData(0, 0, 1, 1);
          if (probeCanvas[dimension] === size && probeCanvas[other] >= 1) {
            lastSuccess = size;
            continue;
          }
        } catch (err) {
          if (stopAfterFirstFailure) {
            nextIndex = i + 1;
            break;
          }
          continue;
        }
        if (stopAfterFirstFailure) {
          nextIndex = i + 1;
          break;
        }
      }
      return { limit: lastSuccess, nextIndex };
    };

    const { limit: widthFirstPass, nextIndex: widthNextIndex } = probeDimension('width', { stopAfterFirstFailure: true });
    const { limit: heightFirstPass, nextIndex: heightNextIndex } = probeDimension('height', { stopAfterFirstFailure: true });

    const provisionalLimit = {
      width: Math.max(MIN_CANVAS_DIMENSION_CAP, widthFirstPass || MIN_CANVAS_DIMENSION_CAP),
      height: Math.max(MIN_CANVAS_DIMENSION_CAP, heightFirstPass || MIN_CANVAS_DIMENSION_CAP),
    };
    cachedCanvasDimensionLimit = provisionalLimit;

    const finalizeProbe = () => {
      try {
        const finishDimension = (dimension, startIndex, lastSuccess) => {
          const other = dimension === 'width' ? 'height' : 'width';
          let latestSuccess = lastSuccess;
          for (let i = startIndex; i < CANVAS_DIMENSION_CANDIDATES.length; i += 1) {
            const size = CANVAS_DIMENSION_CANDIDATES[i];
            try {
              probeCanvas.width = dimension === 'width' ? size : 1;
              probeCanvas.height = dimension === 'height' ? size : 1;
              const ctx = probeCanvas.getContext('2d', { willReadFrequently: true }) || probeCanvas.getContext('2d');
              if (!ctx) continue;
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, 1, 1);
              ctx.getImageData(0, 0, 1, 1);
              if (probeCanvas[dimension] === size && probeCanvas[other] >= 1) {
                latestSuccess = size;
              }
            } catch (err) {
              continue;
            }
          }
          return Math.max(MIN_CANVAS_DIMENSION_CAP, latestSuccess || MIN_CANVAS_DIMENSION_CAP);
        };

        const widthLimit = finishDimension('width', widthNextIndex, widthFirstPass);
        const heightLimit = finishDimension('height', heightNextIndex, heightFirstPass);

        cachedCanvasDimensionLimit = {
          width: widthLimit,
          height: heightLimit,
        };
        writeCachedCanvasLimit(cachedCanvasDimensionLimit);
      } catch (err) {
        // ignore async probe failures
      }
    };

    if (widthNextIndex < CANVAS_DIMENSION_CANDIDATES.length || heightNextIndex < CANVAS_DIMENSION_CANDIDATES.length) {
      scheduleIdle(finalizeProbe);
    } else {
      cachedCanvasDimensionLimit = {
        width: Math.max(MIN_CANVAS_DIMENSION_CAP, widthFirstPass || fallback.width),
        height: Math.max(MIN_CANVAS_DIMENSION_CAP, heightFirstPass || fallback.height),
      };
      writeCachedCanvasLimit(cachedCanvasDimensionLimit);
    }
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
