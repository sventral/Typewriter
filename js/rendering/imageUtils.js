import { clamp } from '../utils/math.js';

export function downsampleImageData(imageData, scale, outW, outH) {
  const width = imageData.width;
  const height = imageData.height;
  const src = imageData.data;
  if (scale <= 1) {
    return new ImageData(new Uint8ClampedArray(src), width, height);
  }
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

export function lightenHexColor(hex, factor) {
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
