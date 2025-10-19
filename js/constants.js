const rootStyles = getComputedStyle(document.documentElement);
const fontStyle = rootStyles.getPropertyValue('--font').trim();
const tempCtx = document.createElement('canvas').getContext('2d');
tempCtx.font = fontStyle;

export const PAGE_W = parseInt(rootStyles.getPropertyValue('--page-w')) || 900;
export const PAGE_H = Math.round(PAGE_W * 297 / 210);
export const PAGE_GAP = 32;

export const FONT_STYLE = fontStyle;
export const FONT_SIZE = parseInt(FONT_STYLE, 10) || 18;
export const LINE_GAP = parseFloat(rootStyles.getPropertyValue('--lineh')) || 1.5;
export const CHAR_WIDTH = tempCtx.measureText('M'.repeat(1000)).width / 1000;
export const LINE_HEIGHT = Math.round(FONT_SIZE * LINE_GAP);

export const STORAGE_DOC_PREFIX = 'typewriter.doc.v4.';
export const STORAGE_DOC_INDEX = 'typewriter.docs.index.v1';
export const STORAGE_LAST_DOC = 'typewriter.last_doc.v1';
export const STORAGE_STOPS = 'typewriter.showStops.v1';

export const MEDIA_DARK_MODE = window.matchMedia('(prefers-color-scheme: dark)');