import { clamp } from '../utils/math.js';

const DEFAULT_HASH_WEIGHT = 0;

const sanitizeSeed = (value, fallback) => (Number.isFinite(value) ? (value >>> 0) : (fallback >>> 0));

const mergeDirection = (incoming, fallback) => {
  const base = fallback && typeof fallback === 'object' ? fallback : { x: 1, y: 0 };
  const src = incoming && typeof incoming === 'object' ? incoming : {};
  const x = Number.isFinite(src.x) ? src.x : base.x;
  const y = Number.isFinite(src.y) ? src.y : base.y;
  return { x, y };
};

const buildNoiseConfig = (defaults, incoming, legacyOctave, legacyStrength) => {
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
    ? clamp(Number.isFinite(src.hashWeight) ? src.hashWeight : Number.isFinite(legacy.hashWeight) ? legacy.hashWeight : hashFallback, 0, 1)
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
};

const buildChipConfig = (defaults, incoming) => {
  const base = defaults || {};
  const src = incoming && typeof incoming === 'object' ? incoming : {};
  return {
    enabled: src.enabled === false ? false : true,
    density: Number.isFinite(src.density) ? src.density : base.density,
    strength: Number.isFinite(src.strength) ? src.strength : base.strength,
    feather: Number.isFinite(src.feather) ? src.feather : base.feather,
    seed: sanitizeSeed(src.seed, base.seed),
  };
};

const buildScratchConfig = (defaults, incoming) => {
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
};

export const INK_TEXTURE = {
  enabled: true,
  supersample: 2,
  coarseNoise: { scale: 0.68, strength: 1.2, seed: 0x9E3779B1 },
  fineNoise: { scale: 0.18, strength: 0.9, seed: 0x7F4A7C15, hashWeight: 0.32 },
  noiseSmoothing: 0.35,
  centerEdgeBias: 0.18,
  noiseFloor: 0.34,
  chip: { enabled: true, density: 0.017, strength: 0.88, feather: 0.45, seed: 0xC13579BD },
  scratch: {
    enabled: true,
    direction: { x: 0.72, y: -0.46 },
    scale: 1.05,
    aspect: 0.28,
    threshold: 0.66,
    strength: 0.24,
    seed: 0xDEADC0DE
  },
  jitterSeed: 0x8BADF00D
};

export function normalizeInkTextureConfig(config) {
  const defaults = INK_TEXTURE;
  const source = config && typeof config === 'object' ? config : {};
  const legacyOctaves = Array.isArray(source.noiseOctaves) ? source.noiseOctaves : [];
  const legacyStrength = Number.isFinite(source.noiseStrength) ? Math.max(0, source.noiseStrength) : null;
  const coarseNoise = buildNoiseConfig(defaults.coarseNoise, source.coarseNoise, legacyOctaves[0], legacyStrength);
  const fineNoise = buildNoiseConfig(
    defaults.fineNoise,
    source.fineNoise,
    legacyOctaves[2] || legacyOctaves[1] || legacyOctaves[0],
    legacyStrength
  );
  const noiseSmoothing = Number.isFinite(source.noiseSmoothing)
    ? clamp(source.noiseSmoothing, 0, 1)
    : Number.isFinite(source.smoothing)
      ? clamp(source.smoothing, 0, 1)
      : defaults.noiseSmoothing;
  const centerEdgeBias = Number.isFinite(source.centerEdgeBias)
    ? clamp(source.centerEdgeBias, -1, 1)
    : Number.isFinite(source.edgeBias)
      ? clamp(source.edgeBias, -1, 1)
      : defaults.centerEdgeBias;
  const noiseFloor = Number.isFinite(source.noiseFloor)
    ? clamp(source.noiseFloor, 0, 1)
    : defaults.noiseFloor;
  const chip = buildChipConfig(defaults.chip, source.chip);
  const scratch = buildScratchConfig(defaults.scratch, source.scratch);
  const jitterSeed = sanitizeSeed(source.jitterSeed, defaults.jitterSeed);

  return {
    enabled: source.enabled !== false,
    supersample: Math.max(1, (Number.isFinite(source.supersample) ? source.supersample : defaults.supersample) | 0),
    coarseNoise,
    fineNoise,
    noiseSmoothing,
    centerEdgeBias,
    noiseFloor,
    chip,
    scratch,
    jitterSeed,
  };
}

export const EDGE_FUZZ = {
  enabled: true,
  inks: ['b', 'r'],
  widthPx: 1.64,
  inwardShare: 0.55,
  roughness: 2.85,
  frequency: 0.2,
  opacity: 0.38,
  seed: 0x7F4A7C15,
};

export const EDGE_BLEED = {
  enabled: true,
  inks: ['b', 'r'],
  passes: [
    { width: 0.25, alpha: 0.18, jitter: 0.22, jitterY: 0.26, lighten: 0.08, strokes: 1, seed: 324508639 },
    { width: 0.21, alpha: 0.12, jitter: 0.75, jitterY: 0.45, lighten: 0.952, strokes: 1, seed: 610839777 }
  ]
};

export const GRAIN_CFG = {
  enabled: true,
  base_scale_from_char_w: 0.64,
  octave_rel_scales: [0.9, 1.5, 2.3, 3.8],
  octave_weights: [0.42, 0.1, 0.23, 0.15],
  pixel_hash_weight: 0,
  post_gamma: 0.9,
  alpha: { max: 0.45, mix_pow: 0.7, low_pow: 0.4, min: 0.0 },
  seeds: { octave: [2779096485, 1592654542, 324508639], hash: 1597334677 },
  composite_op: 'destination-out'
};

