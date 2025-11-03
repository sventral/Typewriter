import { clamp } from '../utils/math.js';

export const INK_INTENSITY = {
  centerThicken: { defaultPct: 174, minPct: 0, maxPct: 200 },
  edgeThin: { defaultPct: 122, minPct: 0, maxPct: 200 },
};

export const INK_BLUR = {
  enabled: false,
  radiusPx: 1.2,
};

export function normalizeInkBlurConfig(config) {
  const defaults = INK_BLUR;
  const source = config && typeof config === 'object' ? config : {};
  const defaultEnabled = defaults && defaults.enabled === false ? false : true;
  const enabled = source.enabled === false ? false : defaultEnabled;
  const radiusSource = Number.isFinite(source.radiusPx) ? source.radiusPx : defaults.radiusPx;
  const radiusPx = clamp(Number.isFinite(radiusSource) ? radiusSource : 0, 0, 8);
  return {
    enabled,
    radiusPx,
  };
}

// TODO: Blur is the only ink effect exported here. Texture/edge/grain presets now
// live in js/config/legacyInkEffects.js and should reuse the helpers preserved in
// js/config/inkEffectHelpers.js when they return.
