import { GLYPH_JITTER_DEFAULTS, cloneGlyphJitterRange } from '../config/glyphJitterConfig.js';
import { LOW_RES_ZOOM_DEFAULTS } from '../config/lowResZoom.js';
import { DEFAULT_PAPER_SIZE } from '../config/paperSizes.js';
import { LINE_SLANT_DEFAULTS, normalizeLineSlantRange } from '../config/lineSlantConfig.js';
import {
  DEFAULT_INK_SECTION_ORDER as PRESET_INK_SECTION_ORDER,
  getDefaultInkSectionQuality,
  getDefaultInkSectionStrength,
} from '../config/inkEffectDefaultStyle.js';
import { createDefaultPageNumberingSettings } from '../config/pageNumbering.js';
import { createDefaultInkOpacity } from '../config/inkPalette.js';
import { TYPEWRITER_DEFAULTS } from '../config/typewriterMode.js';

const SECTION_STRENGTH_DEFAULTS = {
  expTone: getDefaultInkSectionStrength('expTone'),
  expEdge: getDefaultInkSectionStrength('expEdge'),
  expGrain: getDefaultInkSectionStrength('expGrain'),
  expDefects: getDefaultInkSectionStrength('expDefects'),
};

const SECTION_QUALITY_DEFAULTS = {
  expTone: getDefaultInkSectionQuality('expTone'),
  expEdge: getDefaultInkSectionQuality('expEdge'),
  expGrain: getDefaultInkSectionQuality('expGrain'),
  expDefects: getDefaultInkSectionQuality('expDefects'),
};

const SECTION_SCALE_DEFAULTS = {
  expTone: 100,
  expEdge: 100,
  expGrain: 100,
  expDefects: 100,
};

export const DEFAULT_INK_SECTION_ORDER = PRESET_INK_SECTION_ORDER.slice();

export function createMainState(app, gridDiv = 8) {
  return {
    pages: [],
    caret: { page:0, rowMu:0, col:0 },
    documentId: null,
    documentTitle: 'Untitled Document',
    saveRevision: 0,
    lastSavedRevision: 0,
    marginL: 0, marginR: app.PAGE_W, marginTop: 0, marginBottom: 0,
    ink: 'b',
    showRulers: true,
    showMarginBox: false,
    hammerLock: true,
    caretAnchor: { x: 0.5, y: 0.5, unit: 'fraction' },
    paperOffset: { x: 0, y: 0 },
    paperSize: DEFAULT_PAPER_SIZE,
    stageWidthFactor: 1.0,
    stageHeightFactor: 1.0,
    cpi: 10,
    colsAcross: 82.68,
    inkWidthPct: 95,
    inkOpacity: createDefaultInkOpacity(100),
    lineHeightFactor: 1.5,
    lineStepMu: Math.round(gridDiv * 1.5),
    zoom: 1.0,
    effectsOverallStrength: 100,
    expToneStrength: SECTION_STRENGTH_DEFAULTS.expTone,
    expEdgeStrength: SECTION_STRENGTH_DEFAULTS.expEdge,
    expGrainStrength: SECTION_STRENGTH_DEFAULTS.expGrain,
    expDefectsStrength: SECTION_STRENGTH_DEFAULTS.expDefects,
    expToneQuality: SECTION_QUALITY_DEFAULTS.expTone,
    expEdgeQuality: SECTION_QUALITY_DEFAULTS.expEdge,
    expGrainQuality: SECTION_QUALITY_DEFAULTS.expGrain,
    expDefectsQuality: SECTION_QUALITY_DEFAULTS.expDefects,
    expToneScale: SECTION_SCALE_DEFAULTS.expTone,
    expEdgeScale: SECTION_SCALE_DEFAULTS.expEdge,
    expGrainScale: SECTION_SCALE_DEFAULTS.expGrain,
    expDefectsScale: SECTION_SCALE_DEFAULTS.expDefects,
    altSeed: 0x51F15EED,
    inkSectionOrder: DEFAULT_INK_SECTION_ORDER.slice(),
    glyphJitterEnabled: GLYPH_JITTER_DEFAULTS.enabled,
    glyphJitterAmountPct: cloneGlyphJitterRange(GLYPH_JITTER_DEFAULTS.amountPct),
    glyphJitterFrequencyPct: cloneGlyphJitterRange(GLYPH_JITTER_DEFAULTS.frequencyPct),
    glyphJitterSeed: GLYPH_JITTER_DEFAULTS.seed >>> 0,
    lineSlantEnabled: LINE_SLANT_DEFAULTS.enabled,
    lineSlantRangeDeg: normalizeLineSlantRange(LINE_SLANT_DEFAULTS.range),
    wordWrap: true,
    themeMode: 'auto',
    darkPageInDarkMode: false,
    pageFillColor: '#f7f5ee',
    inkEffectsPreferWhite: false,
    savedInkStyles: [],
    currentInkStyle: null,
    lowResZoomEnabled: true,
    lowResZoomSoftCapPct: LOW_RES_ZOOM_DEFAULTS.softCapPct,
    lowResZoomMarginPct: LOW_RES_ZOOM_DEFAULTS.marginPct,
    lagInputBlocked: false,
    lagAssistEnabled: true,
    pageNumbering: createDefaultPageNumberingSettings(),
    realTypewriterEnabled: TYPEWRITER_DEFAULTS.enabled,
    realTypewriterBellSound: TYPEWRITER_DEFAULTS.bellSound,
    realTypewriterBellVolume: TYPEWRITER_DEFAULTS.bellVolume,
    realTypewriterBellLead: TYPEWRITER_DEFAULTS.bellLead,
    realTypewriterStopSound: TYPEWRITER_DEFAULTS.stopSound,
    realTypewriterStopEnabled: TYPEWRITER_DEFAULTS.stopEnabled,
    typewriterMarginRelease: false,
  };
}

export function createEphemeralState() {
  return {
    lastDigitTs: 0,
    lastDigitCaret: null,
    bsBurstCount: 0,
    bsBurstTs: 0,
    lastPasteTs: 0,
    typedRun: { active:false, page:0, rowMu:0, startCol:0, length:0, lastTs:0 },
    drag: null,
    saveTimer: null,
    zoomDebounceTimer: null,
    zooming: false,
    freezeVirtual: false,
    batchDepth: 0,
    touchedPages: new Set(),
    typingBatchRAF: 0,
    metricsRAF: 0,
    pendingFullRebuild: false,
    virtRAF: 0,
    fontLoadSeq: 0,
    primedMetricsAreFallback: false,
  };
}

export function resetInkEffectsState(state) {
  if (!state) return;
  state.effectsOverallStrength = 100;
  state.expToneStrength = SECTION_STRENGTH_DEFAULTS.expTone;
  state.expEdgeStrength = SECTION_STRENGTH_DEFAULTS.expEdge;
  state.expGrainStrength = SECTION_STRENGTH_DEFAULTS.expGrain;
  state.expDefectsStrength = SECTION_STRENGTH_DEFAULTS.expDefects;
  state.expToneQuality = SECTION_QUALITY_DEFAULTS.expTone;
  state.expEdgeQuality = SECTION_QUALITY_DEFAULTS.expEdge;
  state.expGrainQuality = SECTION_QUALITY_DEFAULTS.expGrain;
  state.expDefectsQuality = SECTION_QUALITY_DEFAULTS.expDefects;
  state.expToneScale = SECTION_SCALE_DEFAULTS.expTone;
  state.expEdgeScale = SECTION_SCALE_DEFAULTS.expEdge;
  state.expGrainScale = SECTION_SCALE_DEFAULTS.expGrain;
  state.expDefectsScale = SECTION_SCALE_DEFAULTS.expDefects;
  state.inkSectionOrder = DEFAULT_INK_SECTION_ORDER.slice();
}
