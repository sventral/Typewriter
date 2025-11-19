const MM_PER_INCH = 25.4;

const RAW_PAPER_SIZES = Object.freeze({
  a4: {
    id: 'a4',
    label: 'A4',
    widthMm: 210,
    heightMm: 297,
  },
  letter: {
    id: 'letter',
    label: 'Letter',
    widthMm: 215.9,
    heightMm: 279.4,
  },
});

export const PAPER_SIZES = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_PAPER_SIZES).map(([key, value]) => {
      const widthMm = Number(value.widthMm) || 210;
      const heightMm = Number(value.heightMm) || 297;
      const widthIn = widthMm / MM_PER_INCH;
      const heightIn = heightMm / MM_PER_INCH;
      return [
        key,
        Object.freeze({
          ...value,
          widthMm,
          heightMm,
          widthIn,
          heightIn,
          aspectRatio: heightMm / widthMm,
        }),
      ];
    }),
  ),
);

export const DEFAULT_PAPER_SIZE = 'a4';

export function normalizePaperSizeId(value) {
  if (typeof value !== 'string') return DEFAULT_PAPER_SIZE;
  const normalized = value.trim().toLowerCase();
  return PAPER_SIZES[normalized] ? normalized : DEFAULT_PAPER_SIZE;
}

export function getPaperSize(id) {
  const normalized = normalizePaperSizeId(id);
  return PAPER_SIZES[normalized];
}

export function createPaperMetrics(paperId, pxPerMm) {
  const paper = getPaperSize(paperId);
  const safePxPerMm = Number.isFinite(pxPerMm) && pxPerMm > 0
    ? pxPerMm
    : 900 / paper.widthMm;
  const widthPx = safePxPerMm * paper.widthMm;
  const heightPx = safePxPerMm * paper.heightMm;
  return {
    id: paper.id,
    label: paper.label,
    widthMm: paper.widthMm,
    heightMm: paper.heightMm,
    widthIn: paper.widthIn,
    heightIn: paper.heightIn,
    aspectRatio: paper.aspectRatio,
    widthPx,
    heightPx,
    pxPerMm: safePxPerMm,
  };
}
