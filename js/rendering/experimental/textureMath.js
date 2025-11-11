const { min, max, abs, floor, sin, cos, PI, hypot, imul, pow, sign } = Math;

export const TAU = PI * 2;

export const clamp = (value, minValue, maxValue) => {
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
};

export const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);

export const mulberry32 = seed => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = imul(state ^ (state >>> 15), 1 | state);
    t ^= t + imul(t ^ (t >>> 7), 61 | state);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const hash2 = (x, y, seed) => {
  let h = x * 374761393 ^ y * 668265263 ^ seed;
  h = (h ^ (h >>> 13)) >>> 0;
  h = imul(h, 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
};

export const noise2 = (x, y, scale, seed) => {
  const xi = floor(x / scale);
  const yi = floor(y / scale);
  const xf = x / scale - xi;
  const yf = y / scale - yi;
  const h00 = hash2(xi, yi, seed);
  const h10 = hash2(xi + 1, yi, seed);
  const h01 = hash2(xi, yi + 1, seed);
  const h11 = hash2(xi + 1, yi + 1, seed);
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const nx0 = h00 * (1 - sx) + h10 * sx;
  const nx1 = h01 * (1 - sx) + h11 * sx;
  return nx0 * (1 - sy) + nx1 * sy;
};

export const edgeMask = (alpha, w, h, x, y) => {
  const i = y * w + x;
  const aL = x > 0 ? alpha[i - 1] : 0;
  const aR = x < w - 1 ? alpha[i + 1] : 0;
  const aU = y > 0 ? alpha[i - w] : 0;
  const aD = y < h - 1 ? alpha[i + w] : 0;
  const g = abs(aL - aR) + abs(aU - aD);
  return min(1, g / 255);
};

export const superellipseMask = (nx, ny, ax, ay, rot, powN) => {
  const c = cos(rot);
  const s = sin(rot);
  const rx = (nx * c - ny * s) / ax;
  const ry = (nx * s + ny * c) / ay;
  return pow(abs(rx), powN) + pow(abs(ry), powN);
};

export const gradOut = (dist, w, h, x, y) => {
  const i = y * w + x;
  const dx = (x > 0 ? dist[i - 1] : dist[i]) - (x < w - 1 ? dist[i + 1] : dist[i]);
  const dy = (y > 0 ? dist[i - w] : dist[i]) - (y < h - 1 ? dist[i + w] : dist[i]);
  return [dx, dy];
};

export const dot = (vector, bx, by) => vector[0] * bx + vector[1] * by;

export const len = vector => hypot(vector[0], vector[1]) || 1;

const LUT_CACHE = {
  gamma: new Map(),
  rim: new Map(),
};

const mkGamma = gamma => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    lut[i] = pow(t, gamma);
  }
  return lut;
};

const mkRim = curve => {
  const k = max(0.4, curve);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    lut[i] = pow(t, 1 / k);
  }
  return lut;
};

export const getGammaLUT = gamma => {
  const key = gamma.toFixed(3);
  if (!LUT_CACHE.gamma.has(key)) {
    LUT_CACHE.gamma.set(key, mkGamma(gamma));
  }
  return LUT_CACHE.gamma.get(key);
};

export const getRimLUT = curve => {
  const key = curve.toFixed(3);
  if (!LUT_CACHE.rim.has(key)) {
    LUT_CACHE.rim.set(key, mkRim(curve));
  }
  return LUT_CACHE.rim.get(key);
};

export const signOf = value => sign(value);
