import { clamp01 as clamp01Default } from './textureMath.js';

const { max, floor, imul } = Math;

export const SPECK_NOISE_OCTAVES = Object.freeze([
  { freq: 0.75, weight: 0.28, offsetX: 17.31, offsetY: -9.41, salt: 0x13579bdf },
  { freq: 1, weight: 0.46, offsetX: -3.77, offsetY: 11.09, salt: 0x2468ace1 },
  { freq: 1.92, weight: 0.26, offsetX: 6.51, offsetY: 4.22, salt: 0x9e3779b9 },
]);

export const SPECK_NOISE_WEIGHT_SUM = 1.0;

export const SPECK_SUBPIXEL_OFFSETS = Object.freeze([
  [0.1666667, 0.1666667],
  [0.6666667, 0.1666667],
  [0.1666667, 0.6666667],
  [0.6666667, 0.6666667],
]);

export const SPECK_SUPERSAMPLE_OFFSETS = Object.freeze([
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
]);

export function createTextureKernels({ clamp01 = clamp01Default } = {}) {
  const fastHash2 = (x, y, seed) => {
    let h = imul(x, 374761393) ^ imul(y, 668265263) ^ seed;
    h = (h ^ (h >>> 13)) >>> 0;
    h = imul(h, 1274126177) >>> 0;
    return (h >>> 0) / 4294967296;
  };

  const sampleSpeckValueNoiseFast = (x, y, seed) => {
    const xi = floor(x);
    const yi = floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);

    const h00 = fastHash2(xi, yi, seed);
    const h10 = fastHash2(xi + 1, yi, seed);
    const h01 = fastHash2(xi, yi + 1, seed);
    const h11 = fastHash2(xi + 1, yi + 1, seed);

    const nx0 = h00 + (h10 - h00) * sx;
    const nx1 = h01 + (h11 - h01) * sx;
    return nx0 + (nx1 - nx0) * sy;
  };

  const sampleSpeckFieldFast = (xCss, yCss, detailCss, seed, quality) => {
    const freq0 = max(0.0001, detailCss * 0.75);
    let accum = sampleSpeckValueNoiseFast(
      xCss * freq0 + 17.31,
      yCss * freq0 - 9.41,
      seed ^ 0x13579bdf,
    ) * 0.28;

    if (quality >= 0.4) {
      const freq1 = max(0.0001, detailCss);
      accum += sampleSpeckValueNoiseFast(
        xCss * freq1 - 3.77,
        yCss * freq1 + 11.09,
        seed ^ 0x2468ace1,
      ) * 0.46;
    }

    if (quality >= 0.8) {
      const freq2 = max(0.0001, detailCss * 1.92);
      accum += sampleSpeckValueNoiseFast(
        xCss * freq2 + 6.51,
        yCss * freq2 + 4.22,
        seed ^ 0x9e3779b9,
      ) * 0.26;
    }

    return clamp01((accum - 0.5) * 1.25 + 0.5);
  };

  return {
    fastHash2,
    sampleSpeckValueNoiseFast,
    sampleSpeckFieldFast,
  };
}
