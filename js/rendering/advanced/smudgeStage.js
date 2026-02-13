const { max } = Math;

export function createSmudgeStage({
  getDetailDensityCss,
  detailNoiseCache,
  ensureDistanceDerived,
  gradOutFn,
  dotFn,
  lenFn,
}) {
  return function applySmudgeHalo(coverage, ctx) {
    const { w, h, alpha0, params, smul, seed, dm } = ctx;
    const dpPerCss = Math.max(1e-6, ctx?.dpPerCss || 1);
    const invDp = 1 / dpPerCss;
    const s = params.smudge;
    const smulSafe = Math.max(1e-6, smul || 1);
    const derived = ensureDistanceDerived(ctx);
    const outsideNorm = derived?.outside;
    const outsideNormal = derived?.outsideNormal;
    const outsideRaw = dm?.raw?.outside;
    if (!params.enable.smudge || !s || s.strength <= 0 || (!outsideNorm && !outsideRaw)) return;

    const radiusCss = Math.max(0.0001, s.radius);
    const scaleDp = smulSafe * dpPerCss;

    const detailCss = getDetailDensityCss(ctx);
    const ns = Math.max(2 / detailCss, (s.scale * smulSafe) / detailCss);
    const theta = (s.dirDeg || 0) * (Math.PI / 180);
    const dir = [Math.cos(theta), Math.sin(theta)];
    const smudgeTile = detailNoiseCache.getTile({
      detailCss,
      width: w,
      height: h,
      dpPerCss,
      scale: ns,
      seed: seed ^ 0xdeadc0de,
    });

    const { falloff, density, strength, spread } = s;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      const yCss = y * invDp;
      
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x;
        const outsideDepth = outsideNorm
          ? outsideNorm[i]
          : ((outsideRaw?.[i] || 0) / scaleDp);
        if (!(outsideDepth > 0)) continue;
        if (outsideDepth > radiusCss) continue;

        let band = Math.max(0, 1 - (outsideDepth / radiusCss));
        band = Math.pow(band, Math.max(0.0001, 1 + falloff));

        const xCss = x * invDp;
        const n = smudgeTile.data[i];
        const gate = Math.max(0, (n - (1 - density)) * (1 / (density + 1e-4)));

        let ndotl = 0;
        if (outsideNormal) {
          const nx = outsideNormal[i * 2];
          const ny = outsideNormal[i * 2 + 1];
          ndotl = max(0, nx * dir[0] + ny * dir[1]);
        } else if (outsideRaw) {
          const g = gradOutFn(outsideRaw, w, h, x, y);
          ndotl = max(0, dotFn(g, dir[0], dir[1]) / lenFn(g));
        }
        const dirW = Math.pow(ndotl, Math.max(0.01, 1 - spread) * 2 + 0.5);

        const sm = strength * band * gate * dirW;
        if (alpha0[i] === 0) {
          coverage[i] = Math.max(coverage[i], Math.min(1, sm));
        }
      }
    }
  };
}
