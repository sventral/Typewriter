import { clamp } from '../utils/math.js';

const DEFAULTS = Object.freeze({
  noiseFloor: 0.05,
  minorFloor: 0.5,
  dominanceRatio: 1.35,
  lockRatioCap: 8,
  snapResponsiveness: 0.4,
  releaseDecay: 0.18,
  idleDecay: 0.08,
  releaseFloor: 0.015,
  crossAxisSuppression: 0.85,
});

function lerp(current, target, factor) {
  return current + (target - current) * factor;
}

// Biases wheel deltas toward the current dominant axis so vertical scrolls stay steady
// while still permitting sideways input when it becomes intentional.
export function createWheelAxisStabilizer(config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  let lockAxis = 'neutral';
  let lockStrength = 0;

  const decayTowardZero = (rate) => {
    lockStrength = lerp(lockStrength, 0, rate);
    if (lockStrength <= cfg.releaseFloor) {
      lockStrength = 0;
      lockAxis = 'neutral';
    }
  };

  const dominanceToStrength = (ratio) => {
    if (!Number.isFinite(ratio) || ratio <= cfg.dominanceRatio) {
      return 0;
    }
    const span = Math.max(cfg.lockRatioCap - cfg.dominanceRatio, 1);
    const normalized = (Math.min(ratio, cfg.lockRatioCap) - cfg.dominanceRatio) / span;
    return clamp(normalized, 0, 1);
  };

  function filter(rawDx, rawDy) {
    let dx = Number.isFinite(rawDx) ? rawDx : 0;
    let dy = Number.isFinite(rawDy) ? rawDy : 0;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const majorAxis = absY >= absX ? 'vertical' : 'horizontal';
    const major = Math.max(absX, absY);
    const minor = Math.min(absX, absY);

    if (major <= cfg.noiseFloor) {
      decayTowardZero(cfg.idleDecay);
      return { dx, dy, axis: lockAxis, strength: lockStrength };
    }

    const ratio = major / Math.max(minor, cfg.minorFloor);
    const dominance = dominanceToStrength(ratio);

    if (dominance > 0) {
      if (lockAxis !== majorAxis) {
        lockAxis = majorAxis;
      }
      lockStrength = clamp(lerp(lockStrength, dominance, cfg.snapResponsiveness), 0, 1);
    } else {
      const mismatchPenalty = lockAxis !== majorAxis ? cfg.releaseDecay * 1.25 : cfg.releaseDecay;
      decayTowardZero(mismatchPenalty);
    }

    if (lockAxis === 'vertical' && lockStrength > 0) {
      const suppression = cfg.crossAxisSuppression * lockStrength;
      dx *= clamp(1 - suppression, 0, 1);
    } else if (lockAxis === 'horizontal' && lockStrength > 0) {
      const suppression = cfg.crossAxisSuppression * lockStrength;
      dy *= clamp(1 - suppression, 0, 1);
    }

    return { dx, dy, axis: lockAxis, strength: lockStrength };
  }

  function reset(axis = 'neutral') {
    lockAxis = axis === 'horizontal' || axis === 'vertical' ? axis : 'neutral';
    lockStrength = 0;
  }

  return {
    filter,
    reset,
    getState: () => ({ axis: lockAxis, strength: lockStrength }),
  };
}
