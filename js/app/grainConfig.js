export const GRAIN_CFG = {
  base_scale_from_char_w: 0.32,
  octave_rel_scales: [0.85, 1.32, 2.15, 3.45],
  octave_weights:   [0.42, 0.16, 0.24, 0.10],
  pixel_hash_weight: 0.045,
  fine_hash_weight: 0.14,
  post_gamma: 0.88,
  detail: {
    fine_scale: 0.46,
    fine_weight: 0.32,
    scratch_scale: 2.4,
    scratch_weight: 0.18,
    hash_scale: 3.05,
    hash_weight: 0.1,
    speckle_density: 0.028,
    speckle_strength: 0.78,
    speckle_gamma: 1.22,
    dropout_density: 0.0013,
    dropout_strength: 0.62,
    dropout_scale: 4.3,
    hole_density: 0.0005,
    hole_strength: 0.9
  },
  alpha: { max: 0.68, mix_pow: 0.72, low_pow: 0.42, min: 0.02 },
  seeds: {
    octave: [0xA5A5A5A5, 0x5EEDFACE, 0x13579BDF, 0x89ABCDEF],
    hash: 0x5F356495,
    detail: 0xC0DEC0DE,
    speckle: 0x9E3779B1,
    dropout: 0xDEADBEEF,
    holes: 0x7F4A7C15,
    edge: 0x1F2E3D4C
  },
  composite_op: 'destination-out',
  edge: {
    enable: true,
    blur_px: 0.75,
    feather_px: 1.25,
    jitter_px: 0.45,
    strength_scale: 0.9,
    opacity_scale: 1,
    alpha: { max: 0.32, mix_pow: 0.68, low_pow: 0.36, min: 0 },
    composite_op: 'destination-out',
    mask: {
      scale: 0.68,
      fine_scale: 0.42,
      fine_weight: 0.38,
      hash_scale: 2.55,
      hash_weight: 0.22,
      power: 1.18,
      dropout_density: 0.018,
      dropout_strength: 0.6
    }
  }
};

