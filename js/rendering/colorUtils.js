import { clamp } from '../utils/math.js';

export function parseColorToRgb(color) {
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
