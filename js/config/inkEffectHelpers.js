import { clamp } from '../utils/math.js';

// Shared helpers retained for future ink effects.
export const DEFAULT_HASH_WEIGHT = 0;

export function sanitizeSeed(value, fallback) {
  return Number.isFinite(value) ? (value >>> 0) : (fallback >>> 0);
}

export function mergeDirection(incoming, fallback) {
  const base = fallback && typeof fallback === 'object' ? fallback : { x: 1, y: 0 };
  const src = incoming && typeof incoming === 'object' ? incoming : {};
  const x = Number.isFinite(src.x) ? src.x : base.x;
  const y = Number.isFinite(src.y) ? src.y : base.y;
  return { x, y };
}

export function buildNoiseConfig(defaults, incoming, legacyOctave, legacyStrength) {
  const base = defaults || {};
  const src = incoming && typeof incoming === 'object' ? incoming : {};
  const legacy = legacyOctave && typeof legacyOctave === 'object' ? legacyOctave : {};
  const includeHash = 'hashWeight' in base || 'hashWeight' in src || 'hashWeight' in legacy;
  const weight = Number.isFinite(legacy.weight) ? Math.max(0, legacy.weight) : 0.5;
  const strengthFallback = legacyStrength != null
    ? legacyStrength * clamp(weight * 1.5, 0.05, 2)
    : Number.isFinite(base.strength) ? base.strength : 1;
  const hashFallback = Number.isFinite(base.hashWeight) ? clamp(base.hashWeight, 0, 1) : DEFAULT_HASH_WEIGHT;
  const strength = Number.isFinite(src.strength)
    ? src.strength
    : strengthFallback;
  const hashWeight = includeHash
    ? clamp(
        Number.isFinite(src.hashWeight)
          ? src.hashWeight
          : Number.isFinite(legacy.hashWeight)
            ? legacy.hashWeight
            : hashFallback,
        0,
        1,
      )
    : undefined;
  const noise = {
    scale: Number.isFinite(src.scale) ? src.scale : Number.isFinite(legacy.scale) ? legacy.scale : base.scale,
    strength,
    seed: sanitizeSeed(src.seed ?? legacy.seed, base.seed),
  };
  if (includeHash) {
    noise.hashWeight = hashWeight;
  }
  return noise;
}

export function buildChipConfig(defaults, incoming) {
  const base = defaults || {};
  const src = incoming && typeof incoming === 'object' ? incoming : {};
  return {
    enabled: src.enabled === false ? false : true,
    density: Number.isFinite(src.density) ? src.density : base.density,
    strength: Number.isFinite(src.strength) ? src.strength : base.strength,
    feather: Number.isFinite(src.feather) ? src.feather : base.feather,
    seed: sanitizeSeed(src.seed, base.seed),
  };
}

export function buildScratchConfig(defaults, incoming) {
  const base = defaults || {};
  const src = incoming && typeof incoming === 'object' ? incoming : {};
  return {
    enabled: src.enabled === false ? false : true,
    direction: mergeDirection(src.direction, base.direction),
    scale: Number.isFinite(src.scale) ? src.scale : base.scale,
    aspect: Number.isFinite(src.aspect) ? src.aspect : base.aspect,
    threshold: Number.isFinite(src.threshold) ? src.threshold : base.threshold,
    strength: Number.isFinite(src.strength) ? src.strength : base.strength,
    seed: sanitizeSeed(src.seed, base.seed),
  };
}

// TODO: Use these helpers when re-introducing texture, edge, or grain effects.
