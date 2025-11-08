import { noise2 as defaultNoise2 } from './textureMath.js';

const DEFAULT_MAX_ENTRIES_PER_DETAIL = 6;
const EPSILON = 1e-6;

const quantize = value => {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < EPSILON) return '0';
  return value.toFixed(6);
};

const normalizeDetailKey = detailCss => {
  if (!Number.isFinite(detailCss)) return 'detail:0';
  return `detail:${detailCss.toFixed(4)}`;
};

const composeTileKey = params => {
  const {
    width,
    height,
    dpPerCss,
    scale,
    seed,
    xMul = 1,
    yMul = 1,
    xOffset = 0,
    yOffset = 0,
  } = params;
  return [
    width | 0,
    height | 0,
    quantize(dpPerCss),
    quantize(scale),
    seed >>> 0,
    quantize(xMul),
    quantize(yMul),
    quantize(xOffset),
    quantize(yOffset),
  ].join('|');
};

const createTileData = (noise2Fn, params) => {
  const {
    width,
    height,
    dpPerCss,
    scale,
    seed,
    xMul = 1,
    yMul = 1,
    xOffset = 0,
    yOffset = 0,
  } = params;

  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const safeDp = Math.max(EPSILON, Number.isFinite(dpPerCss) ? dpPerCss : 1);
  const safeScale = Math.max(EPSILON, Number.isFinite(scale) ? scale : 1);
  const invDp = 1 / safeDp;
  const data = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xCss = x * invDp;
      const yCss = y * invDp;
      const sampleX = xCss * xMul + xOffset;
      const sampleY = yCss * yMul + yOffset;
      data[i] = noise2Fn(sampleX, sampleY, safeScale, seed);
    }
  }

  return Object.freeze({
    width: w,
    height: h,
    data,
    scale: safeScale,
    seed,
    dpPerCss: safeDp,
    xMul,
    yMul,
    xOffset,
    yOffset,
  });
};

export function createDetailNoiseCache(options = {}) {
  const {
    noise2: noise2Override,
    maxEntriesPerDetail = DEFAULT_MAX_ENTRIES_PER_DETAIL,
  } = options;

  const noise2Fn = typeof noise2Override === 'function' ? noise2Override : defaultNoise2;
  const buckets = new Map();
  let tick = 0;
  let hits = 0;
  let misses = 0;

  const getBucket = detailCss => {
    const key = normalizeDetailKey(detailCss);
    if (!buckets.has(key)) {
      buckets.set(key, new Map());
    }
    return buckets.get(key);
  };

  const evictLRU = bucket => {
    if (!bucket || bucket.size <= maxEntriesPerDetail) return;
    let oldestKey = null;
    let oldestTick = Infinity;
    for (const [key, entry] of bucket.entries()) {
      if (entry.lastUsed < oldestTick) {
        oldestTick = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      bucket.delete(oldestKey);
    }
  };

  const getTile = params => {
    const bucket = getBucket(params.detailCss);
    const tileKey = composeTileKey(params);
    const entry = bucket.get(tileKey);
    if (entry) {
      hits += 1;
      entry.lastUsed = ++tick;
      return entry.tile;
    }
    misses += 1;
    const tile = createTileData(noise2Fn, params);
    bucket.set(tileKey, { tile, lastUsed: ++tick });
    evictLRU(bucket);
    return tile;
  };

  const clear = () => {
    buckets.clear();
    tick = 0;
    hits = 0;
    misses = 0;
  };

  const stats = () => {
    let size = 0;
    for (const bucket of buckets.values()) {
      size += bucket.size;
    }
    return {
      hits,
      misses,
      size,
      buckets: buckets.size,
    };
  };

  return Object.freeze({
    getTile,
    clear,
    stats,
  });
}

export const globalDetailNoiseCache = createDetailNoiseCache();
