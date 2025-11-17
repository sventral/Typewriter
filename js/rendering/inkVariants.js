export const ALT_VARIANT_COUNT = 9;

export function computeVariantIndex(altSeed = 0, pageIndex = 0, rowMu = 0, col = 0, variantCount = ALT_VARIANT_COUNT) {
  const count = Number.isInteger(variantCount) && variantCount > 1 ? variantCount : 1;
  if (count <= 1) {
    return 0;
  }
  let h = (Number.isFinite(altSeed) ? altSeed : 0) >>> 0;
  const pageTerm = Number.isFinite(pageIndex) ? pageIndex : 0;
  const rowTerm = Number.isFinite(rowMu) ? rowMu : 0;
  const colTerm = Number.isFinite(col) ? col : 0;
  h ^= Math.imul((pageTerm + 1) | 0, 0x9E3779B1);
  h ^= Math.imul((rowTerm + 0x10001) | 0, 0x85EBCA77);
  h ^= Math.imul((colTerm + 0x4001) | 0, 0xC2B2AE3D);
  h ^= (h >>> 16);
  return (h >>> 0) % count;
}
