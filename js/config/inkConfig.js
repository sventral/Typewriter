export const INK_TEXTURE = {
  enabled: true,
  supersample: 2,
  noiseOctaves: [
    { scale: 0.68, weight: 0.54, seed: 0x9E3779B1 },
    { scale: 0.31, weight: 0.28, seed: 0x7F4A7C15 },
    { scale: 0.14, weight: 0.18, seed: 0x51A7C4D1 }
  ],
  noiseStrength: 1.86,
  noiseFloor: 0.34,
  chip: { density: 0.017, strength: 0.88, feather: 0.45, seed: 0xC13579BD },
  scratch: {
    direction: { x: 0.72, y: -0.46 },
    scale: 1.05,
    aspect: 0.28,
    threshold: 0.66,
    strength: 0.24,
    seed: 0xDEADC0DE
  },
  jitterSeed: 0x8BADF00D
};

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

