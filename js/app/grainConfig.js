export const GRAIN_CFG = {
  base_scale_from_char_w: 0.3,
  octave_rel_scales: [0.9, 1.5, 2.3, 3.8],
  octave_weights:   [0.42, 0.1, 0.23, 0.15],
  pixel_hash_weight: 0.05,
  post_gamma: 0.9,
  alpha: { max: 0.7, mix_pow: 0.7, low_pow: 0.4, min: 0.00 },
  seeds: { octave: [0xA5A5A5A5, 0x5EEDFACE, 0x13579BDF], hash: 0x5F356495 },
  composite_op: 'destination-out'
};

