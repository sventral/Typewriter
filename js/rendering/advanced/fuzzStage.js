const { max, floor, ceil } = Math;

export function createFuzzStages({
  clampFn,
  clamp01Fn,
  sampleSpeckValueNoiseFast,
  getStageQualityFromContext,
  getDetailDensityCss,
  detailNoiseCache,
  ensureDistanceDerived,
  fastHash2,
  distanceEpsilon,
}) {
  const applyExperimentalFuzz = (coverage, ctx) => {
    const { w, h, params, alpha0, dm, seed, anchorX, anchorY } = ctx;
    const fuzzExp = params.fuzzExp || {};
    const fuzzEnabled = fuzzExp.enable !== false;
    const fuzzThicken = fuzzEnabled ? (fuzzExp.thicken || 0) : 0;
    const fuzzPatchFill = fuzzEnabled ? clampFn(fuzzExp.patchFill ?? 1, 0, 1) : 0;
    const hasFuzz = fuzzEnabled && Math.abs(fuzzThicken) > 1e-6;
    if (!hasFuzz) return;

    const inside = dm?.raw?.inside;
    const outside = dm?.raw?.outside;
    const maxInside = dm?.getMaxInside ? dm.getMaxInside() : 0;
    if (!inside || maxInside <= 0) return;

    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    const stageQuality = getStageQualityFromContext(ctx);

    const fuzzThickenRadiusPx = (Math.max(0, fuzzThicken) * 0.75 + 0.12) * dpPerCss;
    
    const softnessBase = 0.35 + 0.35 / Math.max(0.4, stageQuality + 0.4);
    const fuzzSoftPx = softnessBase * 1.35;
    const seedFuzz = (seed ^ 0xf077f00d) >>> 0;
    const seedBleed = seedFuzz ^ 0x12345;

    const bleedFreq = 1.5;
    const fuzzFreq = 4.0;
    
    const originXCss = Number.isFinite(anchorX) ? anchorX : 0;
    const originYCss = Number.isFinite(anchorY) ? anchorY : 0;

    const useSupersampling = dpPerCss < 2.5;
    const samples = useSupersampling 
      ? [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]
      : [[0, 0]];

    const applyDilateAlpha = (signedDist, radiusPx, softPx) => {
      if (radiusPx <= 0) return 0;
      const span = Math.max(1e-6, softPx * 2);
      const shifted = signedDist - radiusPx;
      const t = clamp01Fn((-shifted + softPx) / span);
      return t * t * (3 - 2 * t);
    };

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yCssBase = (y * invDp) - originYCss;
      
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        const xCssBase = (x * invDp) - originXCss;

        const insideDist = inside[i] || 0;
        const outsideDist = outside ? (outside[i] || 0) : 0;
        const signedDist = outsideDist > 0 ? outsideDist : -insideDist;

        if (signedDist > fuzzThickenRadiusPx + 2.0) continue;
        if (signedDist < -fuzzThickenRadiusPx - 2.0 && coverage[i] >= 0.99) continue;

        let accumAlpha = 0;

        for (let s = 0; s < samples.length; s++) {
          const offset = samples[s];
          const sampleXCss = xCssBase + (offset[0] * invDp) + 0.123;
          const sampleYCss = yCssBase + (offset[1] * invDp) + 0.123;

          const bleedVal = sampleSpeckValueNoiseFast(sampleXCss * bleedFreq, sampleYCss * bleedFreq, seedBleed);
          const effectiveRadius = fuzzThickenRadiusPx * (bleedVal * 1.3);

          const noiseVal = sampleSpeckValueNoiseFast(sampleXCss * fuzzFreq, sampleYCss * fuzzFreq, seedFuzz);
          const noiseSoft = 0.15;
          
          let noiseAlpha = clamp01Fn((noiseVal - (fuzzPatchFill - noiseSoft * 0.5)) / noiseSoft);
          noiseAlpha = 1.0 - (noiseAlpha * noiseAlpha * (3 - 2 * noiseAlpha));

          if (fuzzPatchFill < 0.999) {
             const bleedVisibility = Math.max(0, (bleedVal - 0.6) * 3.0); 
             noiseAlpha = Math.max(noiseAlpha, bleedVisibility);
          }
          
          if (noiseAlpha > 0.01 || fuzzPatchFill >= 0.999) {
            let fuzzAlpha = applyDilateAlpha(signedDist, effectiveRadius, fuzzSoftPx);
            if (fuzzPatchFill < 0.999) {
              fuzzAlpha *= noiseAlpha;
            }
            accumAlpha += fuzzAlpha;
          }
        }

        const finalFuzzAlpha = accumAlpha / samples.length;
        if (finalFuzzAlpha > 0) {
          const cov = Math.max(coverage[i], finalFuzzAlpha);
          coverage[i] = clamp01Fn(cov);
        }
      }
    }
  };

  const applyEdgeFuzz = (coverage, ctx) => {
    const { w, h, params, seed, smul, alpha0, dm } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    const cfg = params.edgeFuzz;
    if (!params.enable.edgeFuzz || !cfg || (cfg.inBand <= 0 && cfg.outBand <= 0)) return;
    const smulSafe = Math.max(1e-6, smul || 1);
    const detailCss = getDetailDensityCss(ctx);
    const ns = max(2 / detailCss, ((cfg.scale || 2) * smulSafe) / detailCss);
    const fuzzTile = detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: ns,
      seed: seed ^ 0x0f0f0f0f,
    });
    const derived = ensureDistanceDerived(ctx);
    const insideNorm = derived?.inside;
    const outsideNorm = derived?.outside;
    const insideRaw = dm?.raw?.inside;
    const outsideRaw = dm?.raw?.outside;
    const distScale = smulSafe * dpPerCss;
    
    const { inBand, outBand, mix, rough, opacity } = cfg;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yCss = y * invDp;
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        let covF = 0;
        const a = alpha0[i] / 255;
        if (a > 0 && inBand > 0) {
          if (insideNorm) {
            covF = max(
              covF,
              clamp01Fn(1 - (insideNorm[i] / Math.max(inBand, distanceEpsilon))),
            );
          } else if (insideRaw) {
            covF = max(
              covF,
              clamp01Fn(
                1 - ((insideRaw[i] || 0) / (Math.max(inBand, distanceEpsilon) * distScale)),
              ),
            );
          }
        }
        if (a === 0 && outBand > 0) {
          if (outsideNorm) {
            covF = max(
              covF,
              clamp01Fn(1 - (outsideNorm[i] / Math.max(outBand, distanceEpsilon))),
            );
          } else if (outsideRaw && outsideRaw[i] > 0) {
            covF = max(
              covF,
              clamp01Fn(
                1 - ((outsideRaw[i] || 0) / (Math.max(outBand, distanceEpsilon) * distScale)),
              ),
            );
          }
        }
        if (covF > 0) {
          const xCss = x * invDp;
          const vNoise = fuzzTile.data[i];
          const vHash = fastHash2(
            floor(xCss * detailCss),
            floor(yCss * detailCss),
            seed ^ 0xf00dface,
          );
          const n = vNoise * (1 - mix) + vHash * mix;
          const jitter = 1 + rough * ((n - 0.5) * 2);
          const o = clampFn(opacity * covF * jitter, 0, 0.75);
          coverage[i] = 1 - (1 - coverage[i]) * (1 - clamp01Fn(o));
        }
      }
    }
  };

  return { applyExperimentalFuzz, applyEdgeFuzz };
}
