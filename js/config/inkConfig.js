import { clamp } from '../utils/math.js';

const DEFAULT_HASH_WEIGHT = 0;

export const INK_INTENSITY = {
  centerThicken: { defaultPct: 91, minPct: 0, maxPct: 200 },
  edgeThin: { defaultPct: 122, minPct: 0, maxPct: 200 },
};

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
  coarseNoise: { scale: 0.528, strength: 2.72, seed: 0x9E3779B1 },
  fineNoise: { scale: 0.018, strength: 2.9, seed: 0x7F4A7C15, hashWeight: 0 },
  noiseSmoothing: 0.135,
  centerEdgeBias: 0.518,
  noiseFloor: 0.34,
  chip: { enabled: true, density: 0.17, strength: 0.08, feather: 1.05, seed: 0xC13579BD },
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

const EDGE_FUZZ_DEFAULTS = {
  enabled: true,
  inks: ['b', 'r'],
  widths: { inwardPx: 0.052, outwardPx: 0.288 },
  baseOpacity: 0.6,
  direction: { angleDeg: 0 },
  noise: { frequency: 0.2, roughness: 0.85 },
  seed: 0x7F4A7C15,
};

const sanitizeWidths = (source, defaults) => {
  const fallback = defaults && typeof defaults === 'object' ? defaults : { inwardPx: 0, outwardPx: 0 };
  const widthsSrc = source && typeof source === 'object' && typeof source.widths === 'object' ? source.widths : {};
  const legacyTotal = Number.isFinite(source?.widthPx) ? Math.max(0, source.widthPx) : null;
  const legacyShareRaw = Number.isFinite(source?.inwardShare) ? source.inwardShare : null;
  const legacyShare = legacyShareRaw != null ? clamp(legacyShareRaw, 0, 1) : null;
  let inward = Number.isFinite(widthsSrc.inwardPx) ? widthsSrc.inwardPx : null;
  let outward = Number.isFinite(widthsSrc.outwardPx) ? widthsSrc.outwardPx : null;
  if (!Number.isFinite(inward) && Number.isFinite(source?.inwardWidthPx)) {
    inward = source.inwardWidthPx;
  }
  if (!Number.isFinite(outward) && Number.isFinite(source?.outwardWidthPx)) {
    outward = source.outwardWidthPx;
  }
  if (!Number.isFinite(inward) && legacyTotal != null) {
    const share = legacyShare != null ? legacyShare : 0.5;
    inward = legacyTotal * share;
  }
  if (!Number.isFinite(outward) && legacyTotal != null) {
    const inwardForOut = Number.isFinite(inward) ? inward : legacyTotal * (legacyShare != null ? legacyShare : 0.5);
    outward = legacyTotal - inwardForOut;
  }
  if (!Number.isFinite(inward)) inward = fallback.inwardPx;
  if (!Number.isFinite(outward)) outward = fallback.outwardPx;
  return {
    inwardPx: Math.max(0, Number.isFinite(inward) ? inward : 0),
    outwardPx: Math.max(0, Number.isFinite(outward) ? outward : 0),
  };
};

const sanitizeDirection = (source, defaults) => {
  const fallback = defaults && typeof defaults === 'object' ? defaults : { angleDeg: 0 };
  const src = source && typeof source === 'object' && typeof source.direction === 'object'
    ? source.direction
    : (source && typeof source === 'object' ? source : {});
  let angle = Number.isFinite(src.angleDeg) ? src.angleDeg : null;
  if (!Number.isFinite(angle) && Number.isFinite(source?.directionAngleDeg)) {
    angle = source.directionAngleDeg;
  }
  if (!Number.isFinite(angle) && Number.isFinite(src.angle)) {
    angle = src.angle;
  }
  if (!Number.isFinite(angle) && Number.isFinite(src.x) && Number.isFinite(src.y)) {
    const len = Math.hypot(src.x, src.y);
    if (len > 1e-6) {
      angle = (Math.atan2(src.y, src.x) * 180) / Math.PI;
    }
  }
  if (!Number.isFinite(angle) && Number.isFinite(source?.directionAngle)) {
    angle = source.directionAngle;
  }
  if (!Number.isFinite(angle)) {
    angle = Number.isFinite(fallback.angleDeg) ? fallback.angleDeg : 0;
  }
  if (!Number.isFinite(angle)) angle = 0;
  const normalized = angle % 360;
  return { angleDeg: Number.isFinite(normalized) ? normalized : 0 };
};

const sanitizeNoise = (source, defaults) => {
  const fallback = defaults && typeof defaults === 'object' ? defaults : { frequency: 0.2, roughness: 0.85 };
  const src = source && typeof source === 'object' && typeof source.noise === 'object'
    ? source.noise
    : (source && typeof source === 'object' ? source : {});
  const frequencyRaw = Number.isFinite(src.frequency)
    ? src.frequency
    : Number.isFinite(source?.noiseFrequency)
      ? source.noiseFrequency
      : Number.isFinite(source?.frequency)
        ? source.frequency
        : fallback.frequency;
  const roughnessRaw = Number.isFinite(src.roughness)
    ? src.roughness
    : Number.isFinite(source?.noiseRoughness)
      ? source.noiseRoughness
      : Number.isFinite(source?.roughness)
        ? source.roughness
        : fallback.roughness;
  return {
    frequency: Math.max(1e-4, Math.abs(Number.isFinite(frequencyRaw) ? frequencyRaw : fallback.frequency || 0.2)),
    roughness: clamp(Number.isFinite(roughnessRaw) ? roughnessRaw : fallback.roughness || 0.85, 0, 4),
  };
};

const sanitizeInks = (source, defaults) => {
  if (Array.isArray(source)) return source.slice();
  if (Array.isArray(defaults)) return defaults.slice();
  return [];
};

const sanitizeBaseOpacity = (source, defaults) => {
  const fallback = Number.isFinite(defaults) ? defaults : 0.4;
  const raw = Number.isFinite(source?.baseOpacity)
    ? source.baseOpacity
    : Number.isFinite(source?.opacity)
      ? source.opacity
      : fallback;
  return clamp(Number.isFinite(raw) ? raw : fallback, 0, 2);
};

function buildEdgeFuzzConfig(config, defaults = EDGE_FUZZ_DEFAULTS) {
  const base = defaults && typeof defaults === 'object' ? defaults : EDGE_FUZZ_DEFAULTS;
  const source = config && typeof config === 'object' ? config : {};
  const widths = sanitizeWidths(source, base.widths);
  const direction = sanitizeDirection(source, base.direction);
  const noise = sanitizeNoise(source, base.noise);
  const inks = sanitizeInks(source.inks, base.inks);
  const baseOpacity = sanitizeBaseOpacity(source, base.baseOpacity);
  const seed = sanitizeSeed(source.seed, base.seed);
  return {
    enabled: source.enabled !== false,
    inks,
    widths,
    baseOpacity,
    direction,
    noise,
    seed,
  };
}

export function normalizeEdgeFuzzConfig(config) {
  return buildEdgeFuzzConfig(config, EDGE_FUZZ);
}

export const EDGE_FUZZ = buildEdgeFuzzConfig(EDGE_FUZZ_DEFAULTS);

export const EDGE_BLEED = {
  enabled: false,
  inks: ['b', 'r'],
  passes: [
    { width: 0.25, alpha: 0.18, jitter: 0.22, jitterY: 0.16, lighten: 0.08, strokes: 2, seed: 324508639 },
    { width: 0.21, alpha: 0.192, jitter: 0.05, jitterY: 0.145, lighten: 0.052, strokes: 1, seed: 610839777 }
  ]
};

export const GRAIN_CFG = {
  enabled: false,
  base_scale_from_char_w: 0.94,
  octave_rel_scales: [0.29, 1.5, 2.3, 3.8],
  octave_weights: [0.22, 0.061, 0.23, 0.25],
  pixel_hash_weight: 0,
  post_gamma: 0.9,
  alpha: { max: 0.45, mix_pow: 0.7, low_pow: 0.4, min: 0.0 },
  seeds: { octave: [2779096485, 1592654542, 324508639], hash: 1597334677 },
  composite_op: 'destination-out'
};

