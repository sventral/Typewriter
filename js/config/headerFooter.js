import { clamp } from '../utils/math.js';

export const PAGE_NUMBER_TOKEN = '§§§';
const MAX_OFFSET_LINES = 2000;

const createEmptyBlock = () => ({
  left: '',
  center: '',
  right: '',
  offsetLines: 0,
});

export function createDefaultHeaderFooterSettings() {
  return {
    header: createEmptyBlock(),
    footer: createEmptyBlock(),
    useCustomMargins: false,
    customMarginLeftPx: null,
    customMarginRightPx: null,
    startPageNumber: 1,
    startPageNumberEnabled: false,
  };
}

function sanitizeBlock(raw) {
  return {
    left: typeof raw?.left === 'string' ? raw.left : '',
    center: typeof raw?.center === 'string' ? raw.center : '',
    right: typeof raw?.right === 'string' ? raw.right : '',
    offsetLines: clamp(
      Math.max(0, Math.round(Number(raw?.offsetLines ?? 0))),
      0,
      MAX_OFFSET_LINES,
    ),
  };
}

export function sanitizeHeaderFooterSettings(raw, { pageWidth } = {}) {
  const base = createDefaultHeaderFooterSettings();
  const maxPx = Number.isFinite(pageWidth) && pageWidth > 0
    ? pageWidth
    : Number.POSITIVE_INFINITY;
  const marginLeft = Number.isFinite(raw?.customMarginLeftPx)
    ? clamp(raw.customMarginLeftPx, 0, maxPx)
    : null;
  const marginRight = Number.isFinite(raw?.customMarginRightPx)
    ? clamp(raw.customMarginRightPx, 0, maxPx)
    : null;
  const startPage = clamp(
    Math.max(1, Math.round(Number(
      raw?.startPageNumber ?? raw?.numberingStartPage ?? 1,
    ))),
    1,
    100000,
  );
  return {
    ...base,
    header: sanitizeBlock(raw?.header),
    footer: sanitizeBlock(raw?.footer),
    useCustomMargins: raw?.useCustomMargins === true,
    customMarginLeftPx: marginLeft,
    customMarginRightPx: marginRight,
    startPageNumber: startPage,
    startPageNumberEnabled: raw?.startPageNumberEnabled === true
      || raw?.numberingStartEnabled === true,
  };
}

export function resolvePageNumberForIndex(pageIndex, settings = {}) {
  const pageNum = Number.isFinite(pageIndex) ? pageIndex + 1 : null;
  if (!pageNum) return null;
  const enabled = settings.startPageNumberEnabled === true;
  const startAt = enabled ? settings.startPageNumber || 1 : 1;
  if (pageNum < startAt) return null;
  return pageNum;
}

export function applyPageNumberToken(template, pageNumber) {
  if (typeof template !== 'string') return '';
  const replacement = pageNumber == null ? '' : String(pageNumber);
  return template.split(PAGE_NUMBER_TOKEN).join(replacement);
}
