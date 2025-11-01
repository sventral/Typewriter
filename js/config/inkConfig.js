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

export const EDGE_FUZZ = {
  enabled: true,
  inks: ['b', 'r'],
  widthPx: 0.34,
  inwardShare: 0.15,
  roughness: 0.85,
  frequency: 0.2,
  opacity: 0.38,
  seed: 0x7F4A7C15,
};

const EDGE_BLEED_DEFAULTS = {
  enabled: false,
  inks: ['b', 'r'],
  widthPx: 0.32,
  feather: 1.18,
  lightnessShift: 0.08,
  noiseRoughness: 0.24,
  intensity: 0.22,
  seed: 0xC13579BD,
};

export function normalizeEdgeBleedConfig(config) {
  const base = EDGE_BLEED_DEFAULTS;
  const source = config && typeof config === 'object' ? config : {};
  const passes = Array.isArray(source.passes) ? source.passes.filter(pass => pass && typeof pass === 'object') : [];
  const average = values => {
    if (!values.length) return null;
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  };

  const normalized = {
    enabled: source.enabled !== false,
    inks: Array.isArray(source.inks) ? source.inks.filter(ink => typeof ink === 'string' && ink.length) : base.inks.slice(),
    widthPx: Number.isFinite(source.widthPx) ? Math.max(0, source.widthPx) : base.widthPx,
    feather: Number.isFinite(source.feather) ? Math.max(0.01, source.feather) : base.feather,
    lightnessShift: Number.isFinite(source.lightnessShift) ? clamp(source.lightnessShift, 0, 1) : base.lightnessShift,
    noiseRoughness: Number.isFinite(source.noiseRoughness) ? Math.max(0, source.noiseRoughness) : base.noiseRoughness,
    intensity: Number.isFinite(source.intensity) ? clamp(source.intensity, 0, 1) : base.intensity,
    seed: sanitizeSeed(source.seed, base.seed),
  };

  if (!normalized.inks.length) {
    normalized.inks = base.inks.slice();
  }

  if (passes.length) {
    const widths = passes
      .map(pass => Number(pass.width))
      .filter(value => Number.isFinite(value) && value > 0);
    const lightens = passes
      .map(pass => Number(pass.lighten))
      .filter(value => Number.isFinite(value));
    const jitters = passes
      .map(pass => {
        const jx = Number(pass.jitter);
        const jy = Number(pass.jitterY);
        if (Number.isFinite(jx) && Number.isFinite(jy)) return Math.max(jx, jy);
        if (Number.isFinite(jx)) return jx;
        if (Number.isFinite(jy)) return jy;
        return NaN;
      })
      .filter(value => Number.isFinite(value));
    const alphas = passes
      .map(pass => Number(pass.alpha))
      .filter(value => Number.isFinite(value));

    const widthAvg = average(widths);
    const lightenAvg = average(lightens);
    const jitterAvg = average(jitters);
    const alphaAvg = average(alphas);

    if (Number.isFinite(widthAvg)) normalized.widthPx = Math.max(0, widthAvg);
    if (Number.isFinite(lightenAvg)) normalized.lightnessShift = clamp(lightenAvg, 0, 1);
    if (Number.isFinite(jitterAvg)) normalized.noiseRoughness = Math.max(0, jitterAvg);
    if (Number.isFinite(alphaAvg)) normalized.intensity = clamp(alphaAvg, 0, 1);
  }

  return normalized;
}

export const EDGE_BLEED = normalizeEdgeBleedConfig(EDGE_BLEED_DEFAULTS);

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

