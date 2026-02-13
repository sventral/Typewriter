const { max, min, floor } = Math;

export function createDropoutsStage({
  clampFn,
  clamp01Fn,
  getStageQualityFromContext,
  getDetailDensityCss,
  detailNoiseCache,
  fastHash2,
}) {
  return function applyDropoutsMask(coverage, ctx) {
    const { w, h, params, seed, smul, alpha0, dm } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;

    const pDrop = params.dropouts || {};
    const pEnable = params.enable || {};

    if (!pEnable.dropouts || !pDrop || pDrop.amount <= 0) return;

    const stageQuality = getStageQualityFromContext(ctx);
    const detailCss = getDetailDensityCss(ctx);
    const inside = dm?.raw?.inside;
    const widthPx = max(0.0001, pDrop.width * smul * dpPerCss);
    const dropScalePx = max(2 / detailCss, (pDrop.scale * smul) / detailCss);
    const dropThr = 1 - clamp01Fn(pDrop.streakDensity);
    const dropPw = clamp01Fn(pDrop.pinholeWeight);
    const dropoutHashDensity = max(0.1, 3 * stageQuality);
    const dropAmount = min(2, pDrop.amount);
    const dropPinhole = pDrop.pinhole;

    const dropoutTile = detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: dropScalePx,
      seed: seed ^ 0x51f1f1f1,
    });

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yCss = y * invDp;

      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        if (alpha0[i] === 0) continue;

        const band = inside ? clamp01Fn(1 - ((inside[i] || 0) / widthPx)) : 0;
        const xCss = x * invDp;
        const nlf = dropoutTile.data[i];
        const streak = (nlf > dropThr ? 1 : 0) * band;
        const nhf = fastHash2(
          floor(xCss * detailCss * dropoutHashDensity + 7),
          floor(yCss * detailCss * dropoutHashDensity + 11),
          seed ^ 0xc0ffee00,
        );
        const pinh = (nhf > 1 - dropPinhole ? 1 : 0) * (1 - band);
        const gap = clamp01Fn((1 - dropPw) * streak + dropPw * pinh);
        coverage[i] = clamp01Fn(max(0, 1 - dropAmount * gap) * coverage[i]);
      }
    }
  };
}
