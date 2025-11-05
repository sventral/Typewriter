//js/rendering/experimental/stagePipeline.js

import {
  TAU,
  clamp,
  clamp01,
  noise2,
  edgeMask,
  ribbonShape,
  superellipseMask,
  gradOut,
  dot,
  len,
  getGammaLUT,
  getRimLUT,
  hash2,
  mulberry32,
  signOf,
} from './textureMath.js';

const { min, max, abs, floor, ceil, round, sin, cos, pow } = Math;

export const GLYPH_PIPELINE_ORDER = Object.freeze([
  'fill',
  'dropouts',
  'texture',
  'centerEdge',
  'punch',
  'fuzz',
  'smudge',
]);

export function createExperimentalStagePipeline(deps = {}) {
  const {
    clamp: clampFn = clamp,
    clamp01: clamp01Fn = clamp01,
    noise2: noise2Fn = noise2,
    edgeMask: edgeMaskFn = edgeMask,
    ribbonShape: ribbonShapeFn = ribbonShape,
    superellipseMask: superellipseMaskFn = superellipseMask,
    gradOut: gradOutFn = gradOut,
    dot: dotFn = dot,
    len: lenFn = len,
    getGammaLUT: getGamma = getGammaLUT,
    getRimLUT: getRim = getRimLUT,
    hash2: hash2Fn = hash2,
    mulberry32: mulberry32Factory = mulberry32,
    TAU: tauConst = TAU,
    sign: signFn = signOf,
  } = deps;

  function applyFillAdjustments(coverage, ctx) {
    const { w, h, alpha0, params, seed, gix, smul } = ctx;
    const lfScale = params.noise.lfScale * smul;
    const hfScale = params.noise.hfScale * smul;
    const periodPx = params.ribbon.period * smul;
    const gammaLUT = getGamma(params.ink.inkGamma);
    const rimLUT = getRim(params.ink.rimCurve);
    const toneCoreEn = !!params.enable.toneCore;
    const vBiasEn = !!params.enable.vBias;
    const rimEn = !!params.enable.rim;
    const rPhase = (params.ribbon.phase + (gix % 37) * 0.25) % tauConst;
    const rhythm = 1 + 0.08 * sin((gix % 23) / 23 * tauConst);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = alpha0[i] / 255;
        const e = edgeMaskFn(alpha0, w, h, x, y);
        const p = noise2Fn(x + gix * 13, y + gix * 7, lfScale, seed);
        const m = noise2Fn(x * 1.7 + seed, y * 1.3 - seed, hfScale, seed ^ 0xA5A5A5A5);
        const rBand = ribbonShapeFn(y, periodPx, params.ribbon.sharp, rPhase);
        let press = toneCoreEn ? params.ink.pressureMid + params.ink.pressureVar * (p - 0.5) * 2 : 1;
        press = clampFn(press, 0.05, 1.6);
        let cov = a * press;
        if (toneCoreEn) cov *= 1 + params.ink.toneJitter * ((m - 0.5) * 2);
        if (params.ribbon.amp > 0) cov *= 1 + params.ribbon.amp * ((rBand - 0.5) * 2);
        if (vBiasEn) {
          const vBiasNorm = y / (h - 1) - 0.5;
          const vb = vBiasNorm * (1 + 0.5 * signFn(vBiasNorm) * vBiasNorm * vBiasNorm);
          cov *= 1 + params.bias.vertical * (params.bias.amount || 0) * vb * 1.6;
        }
        cov *= 1 + 0 * rhythm + rhythm - 1;
        const rimBoost = rimLUT[(e * 255) | 0];
        if (rimEn) cov += params.ink.rim * rimBoost * (1 - cov);
        if (toneCoreEn) {
          const idx = (clamp01Fn(cov) * 255) | 0;
          cov = gammaLUT[idx];
        }
        coverage[i] = clamp01Fn(cov);
      }
    }
  }

  function applyDropoutsMask(coverage, ctx) {
    const { w, h, params, seed, smul, alpha0, dm } = ctx;
    if (!params.enable.dropouts || !params.dropouts || params.dropouts.amount <= 0) return;
    const inside = dm?.raw?.inside;
    const widthPx = max(0.0001, params.dropouts.width * smul);
    const dropScalePx = max(2, params.dropouts.scale * smul);
    const dropThr = 1 - clamp01Fn(params.dropouts.streakDensity);
    const dropPw = clamp01Fn(params.dropouts.pinholeWeight);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (alpha0[i] === 0) continue;
        const band = inside ? clamp01Fn(1 - ((inside[i] || 0) / widthPx)) : 0;
        const nlf = noise2Fn(x, y, dropScalePx, seed ^ 0x51F1F1F1);
        const streak = (nlf > dropThr ? 1 : 0) * band;
        const nhf = hash2Fn(x * 3 + 7, y * 3 + 11, seed ^ 0xC0FFEE00);
        const pinh = (nhf > 1 - params.dropouts.pinhole ? 1 : 0) * (1 - band);
        const gap = clamp01Fn((1 - dropPw) * streak + dropPw * pinh);
        const amt = min(2, params.dropouts.amount);
        coverage[i] = clamp01Fn(max(0, 1 - amt * gap) * coverage[i]);
      }
    }
  }

  function applyGrainSpeckTexture(coverage, ctx) {
    const { w, h, params, seed, alpha0 } = ctx;
    if (!params.enable.grainSpeck) return;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (alpha0[i] === 0) continue;
        const speckMask = hash2Fn(x, y, seed ^ 0xBEEFCAFE);
        const affect = (1 - params.ink.speckGrayBias) + params.ink.speckGrayBias * (1 - coverage[i]);
        let cov = coverage[i];
        cov = 1 - (1 - cov) * (1 - params.ink.speckDark * (speckMask > 0.85 ? affect : 0));
        cov *= 1 - params.ink.speckLight * (speckMask < 0.15 ? affect : 0);
        coverage[i] = clamp01Fn(cov);
      }
    }
  }

  function applyCenterEdgeShape(coverage, ctx) {
    const { w, h, params, alpha0, dm } = ctx;
    if (!params.enable.centerEdge || !params.centerEdge) return;
    const inside = dm?.raw?.inside;
    const maxInside = dm?.getMaxInside ? dm.getMaxInside() : 0;
    if (!inside || maxInside <= 0) return;
    const cK = params.centerEdge.center || 0;
    const eK = params.centerEdge.edge || 0;
    if (cK === 0 && eK === 0) return;
    for (let i = 0; i < w * h; i++) {
      if (alpha0[i] === 0) continue;
      const norm = (inside[i] || 0) / maxInside;
      let mod = 1;
      mod *= clampFn(1 + cK * norm, 0, 2);
      mod *= clampFn(1 - eK * (1 - norm), 0, 2);
      coverage[i] = clamp01Fn(coverage[i] * mod);
    }
  }

  function createPunchSet(ctx) {
    const { w, h, params, seed, dm, alpha0 } = ctx;
    if (!params.enable.punch || !params.punch || params.punch.intensity <= 0) return null;
    const inside = dm?.raw?.inside;
    const maxInside = dm?.getMaxInside ? dm.getMaxInside() : 0;
    const rng = mulberry32Factory((seed ^ 0xC71C71C7) >>> 0);
    const cnt = max(0, params.punch.count | 0);
    if (cnt <= 0) return null;
    const rmin = max(0.001, min(params.punch.rMin, params.punch.rMax));
    const rmax = max(rmin, params.punch.rMax);
    const b = clampFn(params.punch.edgeBias || 0, -1, 1);
    const mag = abs(b);
    const sgn = signFn(b);
    const baseScale = min(w, h);
    const sxN = baseScale / w;
    const syN = baseScale / h;

    const pickCenter = () => {
      for (let t = 0; t < 60; t++) {
        const cx = floor(rng() * w);
        const cy = floor(rng() * h);
        const i = cy * w + cx;
        if (alpha0[i] === 0) continue;
        if (mag > 0 && inside && maxInside > 0) {
          const norm = (inside[i] || 0) / (1e-6 + max(1, maxInside));
          const prefer = sgn > 0 ? 1 - norm : norm;
          const p = (1 - mag) + mag * prefer;
          if (rng() < p) return [cx / w, cy / h];
        } else {
          return [cx / w, cy / h];
        }
      }
      return [rng(), rng()];
    };

    const holes = [];
    for (let k = 0; k < cnt; k++) {
      const [cxN, cyN] = pickCenter();
      const r = rmin + rng() * (rmax - rmin);
      const anis = 0.8 + rng() * 0.4;
      const ax = r * sxN * anis;
      const ay = r * syN / anis;
      const rot = rng() * tauConst;
      const soft = (params.punch.soft || 0) * max(ax, ay);
      const minX = max(0, floor((cxN - ax - soft) * w));
      const maxX = min(w - 1, ceil((cxN + ax + soft) * w));
      const minY = max(0, floor((cyN - ay - soft) * h));
      const maxY = min(h - 1, ceil((cyN + ay + soft) * h));
      holes.push({ cx: cxN, cy: cyN, ax, ay, rot, soft, minX, maxX, minY, maxY });
    }
    return holes;
  }

  function applyPunchHolesMask(coverage, ctx, holes) {
    if (!holes || !holes.length) return;
    const { w, h, params, alpha0 } = ctx;
    const punchK = clampFn(params.punch?.intensity || 0, 0, 1.5);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (alpha0[i] === 0) continue;
        let hole = 0;
        for (const pf of holes) {
          if (x < pf.minX || x > pf.maxX || y < pf.minY || y > pf.maxY) continue;
          const nx = x / w - pf.cx;
          const ny = y / h - pf.cy;
          const v = superellipseMaskFn(nx, ny, pf.ax, pf.ay, pf.rot, 2);
          if (v < 1 + pf.soft) {
            const t = pf.soft > 0 ? clamp01Fn((1 + pf.soft - v) / pf.soft) : (v < 1 ? 1 : 0);
            if (t > hole) hole = t;
          }
        }
        if (hole > 0) {
          coverage[i] = clamp01Fn(max(0, coverage[i] * (1 - punchK * hole)));
        }
      }
    }
  }

  function applyEdgeFuzz(coverage, ctx) {
    const { w, h, params, seed, smul, alpha0, dm } = ctx;
    const cfg = params.edgeFuzz;
    if (!params.enable.edgeFuzz || !cfg || (cfg.inBand <= 0 && cfg.outBand <= 0)) return;
    const inside = dm?.raw?.inside;
    const outside = dm?.raw?.outside;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let covF = 0;
        const a = alpha0[i] / 255;
        if (a > 0 && cfg.inBand > 0 && inside) {
          covF = max(covF, clamp01Fn(1 - ((inside[i] || 0) / (cfg.inBand * smul))));
        }
        if (a === 0 && cfg.outBand > 0 && outside && outside[i] > 0) {
          covF = max(covF, clamp01Fn(1 - ((outside[i] || 0) / (cfg.outBand * smul))));
        }
        if (covF > 0) {
          const ns = max(2, (cfg.scale || 2) * smul);
          const vNoise = noise2Fn(x, y, ns, seed ^ 0x0F0F0F0F);
          const vHash = hash2Fn(x, y, seed ^ 0xF00DFACE);
          const blend = cfg.mix;
          const n = vNoise * (1 - blend) + vHash * blend;
          const jitter = 1 + cfg.rough * ((n - 0.5) * 2);
          const o = clampFn(cfg.opacity * covF * jitter, 0, 0.75);
          coverage[i] = 1 - (1 - coverage[i]) * (1 - clamp01Fn(o));
        }
      }
    }
  }

  function applySmudgeHalo(coverage, ctx) {
    const { w, h, alpha0, params, smul, seed, dm } = ctx;
    const s = params.smudge;
    const outside = dm?.raw?.outside;
    if (!params.enable.smudge || !s || s.strength <= 0 || !outside) return;
    const R = max(0.0001, s.radius * smul);
    if (R <= 0) return;
    const ns = max(2, s.scale * smul);
    const theta = (s.dirDeg || 0) * PI / 180;
    const dir = [cos(theta), sin(theta)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!(outside[i] > 0)) continue;
        let band = max(0, 1 - ((outside[i] || 0) / R));
        band = pow(band, max(0.0001, 1 + s.falloff));
        const n = noise2Fn(x, y, ns, seed ^ 0xDEADC0DE);
        const gate = max(0, (n - (1 - s.density)) * (1 / (s.density + 1e-4)));
        const g = gradOutFn(outside, w, h, x, y);
        const ndotl = max(0, dotFn(g, dir[0], dir[1]) / lenFn(g));
        const dirW = pow(ndotl, max(0.01, 1 - s.spread) * 2 + 0.5);
        const sm = s.strength * band * gate * dirW;
        if (alpha0[i] === 0) {
          coverage[i] = max(coverage[i], min(1, sm));
        }
      }
    }
  }

  const stageRegistry = {
    fill: applyFillAdjustments,
    dropouts: applyDropoutsMask,
    texture: applyGrainSpeckTexture,
    centerEdge: applyCenterEdgeShape,
    punch: (coverage, ctx) => {
      const holes = createPunchSet(ctx);
      applyPunchHolesMask(coverage, ctx, holes);
    },
    fuzz: applyEdgeFuzz,
    smudge: applySmudgeHalo,
  };

  const runPipeline = (coverage, ctx, order = GLYPH_PIPELINE_ORDER) => {
    for (const id of order) {
      const fn = stageRegistry[id];
      if (typeof fn === 'function') {
        fn(coverage, ctx);
      }
    }
  };

  return {
    stageRegistry,
    pipelineOrder: GLYPH_PIPELINE_ORDER,
    applyFillAdjustments,
    applyDropoutsMask,
    applyGrainSpeckTexture,
    applyCenterEdgeShape,
    applyPunchHolesMask,
    createPunchSet,
    applyEdgeFuzz,
    applySmudgeHalo,
    runPipeline,
  };
}

export function createExperimentalStageRegistry(deps = {}) {
  return createExperimentalStagePipeline(deps).stageRegistry;
}
