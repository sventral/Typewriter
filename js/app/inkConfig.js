export const INK_EFFECT_CONFIG = {
  master: 100,
  texture: {
    enabled: true,
    master: 100,
    supersample: 2,
    noiseOctaves: [
      { scale: 0.68, weight: 0.54, seed: 0x9E3779B1 },
      { scale: 0.31, weight: 0.28, seed: 0x7F4A7C15 },
      { scale: 0.14, weight: 0.18, seed: 0x51A7C4D1 }
    ],
    noiseStrength: 0.86,
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
  },
  edgeBleed: {
    enabled: false,
    master: 100,
    inks: ['b', 'r'],
    passes: [
      { width: 0.65, alpha: 0.18, jitter: 0.42, jitterY: 0.26, lighten: 0.38, strokes: 2, seed: 0x13579BDF },
      { width: 1.1, alpha: 0.12, jitter: 0.75, jitterY: 0.45, lighten: 0.52, strokes: 1, seed: 0x2468ACE1 }
    ]
  },
  grain: {
    base_scale_from_char_w: 0.3,
    octave_rel_scales: [0.9, 1.5, 2.3, 3.8],
    octave_weights:   [0.42, 0.1, 0.23, 0.15],
    pixel_hash_weight: 0.05,
    post_gamma: 0.9,
    alpha: { max: 0.45, mix_pow: 0.7, low_pow: 0.4, min: 0.00 },
    seeds: { octave: [0xA5A5A5A5, 0x5EEDFACE, 0x13579BDF], hash: 0x5F356495 },
    composite_op: 'destination-out'
  }
};

export function cloneInkConfig(src = INK_EFFECT_CONFIG){
  if (typeof structuredClone === 'function'){
    return structuredClone(src);
  }
  return JSON.parse(JSON.stringify(src));
}
