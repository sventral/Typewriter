const { max } = Math;

export function createTextureStage({
  clampFn,
  clamp01Fn,
  getStageQualityFromContext,
  getDetailDensityCss,
  sampleSpeckFieldFast,
  sampleSpeckValueNoiseFast,
  subpixelOffsets,
  supersampleOffsets,
}) {
  return function applyGrainSpeckTexture(coverage, ctx) {
    const { w, h, params, seed, alpha0 } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;

    const pEnable = params.enable || {};
    const pInk = params.ink || {};

    if (!pEnable.grainSpeck) return;

    const stageQuality = getStageQualityFromContext(ctx);
    const mottlingRaw = clampFn(pInk.mottling ?? 0, 0, 1.5);
    const t = mottlingRaw / 1.5;
    const freqScale = 0.4 + t * 2.4;
    const detailCss = getDetailDensityCss(ctx, 1.5 * freqScale);

    let sampleOffsets = subpixelOffsets;
    if (stageQuality < 1) {
      const subsetCount = Math.max(1, Math.round(sampleOffsets.length * stageQuality));
      sampleOffsets = subpixelOffsets.slice(0, subsetCount);
    } else if (stageQuality > 1) {
      const extraCount = Math.min(
        supersampleOffsets.length,
        Math.round((stageQuality - 1) * supersampleOffsets.length),
      );
      sampleOffsets = extraCount > 0
        ? subpixelOffsets.concat(supersampleOffsets.slice(0, extraCount))
        : subpixelOffsets;
    }

    const microNoiseWeight = clamp01Fn((stageQuality - 0.5) / 0.5);
    const sampleCount = sampleOffsets.length || 1;
    const invSampleCount = 1 / sampleCount;
    const speckSeed = seed ^ 0xbeefcafe;
    const microSeed = speckSeed ^ 0x7f4a7c15;

    const { speckDark = 0, speckLight = 0, speckGrayBias = 0 } = pInk;
    const darkGate = 0.85;
    const lightGate = 0.15;
    const invDarkSpan = 1 / (1 - darkGate);
    const invLightSpan = 1 / lightGate;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yBase = y * invDp;

      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        if (alpha0[i] === 0) continue;

        const xBase = x * invDp;
        let darkAccum = 0;
        let lightAccum = 0;

        for (let s = 0; s < sampleCount; s++) {
          const offset = sampleOffsets[s];
          const xCss = xBase + offset[0] * invDp;
          const yCss = yBase + offset[1] * invDp;
          const baseMask = sampleSpeckFieldFast(xCss, yCss, detailCss, speckSeed, stageQuality);
          let microPerturb = 0;
          if (microNoiseWeight > 0) {
            const microMask = sampleSpeckValueNoiseFast(
              xCss * detailCss * 3.37 + 5.71,
              yCss * detailCss * 3.17 - 2.9,
              microSeed,
            );
            microPerturb = (microMask - 0.5) * 0.7 * microNoiseWeight;
          }
          const combinedMask = clamp01Fn(baseMask + microPerturb);
          const speckMask = clamp01Fn((combinedMask - 0.5) * 1.6 + 0.5);
          if (speckMask > darkGate) {
            darkAccum += (speckMask - darkGate) * invDarkSpan;
          }
          if (speckMask < lightGate) {
            lightAccum += (lightGate - speckMask) * invLightSpan;
          }
        }

        const affect = (1 - speckGrayBias) + speckGrayBias * (1 - coverage[i]);
        const interior = clamp01Fn(alpha0[i] / 255);
        const edgeFade = clamp01Fn(interior * interior * 1.1);
        const darkFactor = speckDark * affect * edgeFade * clamp01Fn(darkAccum * invSampleCount * 2.2);
        const lightFactor = speckLight * affect * edgeFade * clamp01Fn(lightAccum * invSampleCount * 2);
        let cov = coverage[i];
        cov = 1 - (1 - cov) * (1 - darkFactor);
        cov *= 1 - lightFactor;
        coverage[i] = clamp01Fn(cov);
      }
    }
  };
}
