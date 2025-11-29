import { GLYPH_JITTER_DEFAULTS, cloneGlyphJitterRange } from '../config/glyphJitterConfig.js';
import { LOW_RES_ZOOM_DEFAULTS } from '../config/lowResZoom.js';
import { DEFAULT_PAPER_SIZE } from '../config/paperSizes.js';
import { LINE_SLANT_DEFAULTS, normalizeLineSlantRange } from '../config/lineSlantConfig.js';
import {
  DEFAULT_INK_SECTION_ORDER as PRESET_INK_SECTION_ORDER,
  DEFAULT_INK_SUBSECTION_ORDER as PRESET_INK_SUBSECTION_ORDER,
  getDefaultInkSectionQuality,
  getDefaultInkSectionStrength,
  getDefaultInkSubsectionQuality,
  getDefaultInkSubsectionScale,
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
  expToneVariations: getDefaultInkSubsectionQuality('expTone.variations'),
  expToneRibbon: getDefaultInkSubsectionQuality('expTone.ribbon'),
  expEdgeRim: getDefaultInkSubsectionQuality('expEdge.rim'),
  expEdgeFuzz: getDefaultInkSubsectionQuality('expEdge.fuzz'),
  expEdgeCounterFill: getDefaultInkSubsectionQuality('expEdge.counterFill'),
  expEdgeGrain: getDefaultInkSubsectionQuality('expEdge.grain'),
  expEdgeWeight: getDefaultInkSubsectionQuality('expEdge.weight'),
  expGrainSpeckle: getDefaultInkSubsectionQuality('expGrain.speckle'),
  expGrainDropouts: getDefaultInkSubsectionQuality('expGrain.dropouts'),
  expDefectsSmudge: getDefaultInkSubsectionQuality('expDefects.smudge'),
  expDefectsPunch: getDefaultInkSubsectionQuality('expDefects.punch'),
};

const SECTION_SCALE_DEFAULTS = {
  expToneVariations: getDefaultInkSubsectionScale('expTone.variations'),
  expToneRibbon: getDefaultInkSubsectionScale('expTone.ribbon'),
  expEdgeRim: getDefaultInkSubsectionScale('expEdge.rim'),
  expEdgeFuzz: getDefaultInkSubsectionScale('expEdge.fuzz'),
  expEdgeCounterFill: getDefaultInkSubsectionScale('expEdge.counterFill'),
  expEdgeGrain: getDefaultInkSubsectionScale('expEdge.grain'),
  expEdgeWeight: getDefaultInkSubsectionScale('expEdge.weight'),
  expGrainSpeckle: getDefaultInkSubsectionScale('expGrain.speckle'),
  expGrainDropouts: getDefaultInkSubsectionScale('expGrain.dropouts'),
  expDefectsSmudge: getDefaultInkSubsectionScale('expDefects.smudge'),
  expDefectsPunch: getDefaultInkSubsectionScale('expDefects.punch'),
};

export const DEFAULT_INK_SECTION_ORDER = PRESET_INK_SECTION_ORDER.slice();
export const DEFAULT_INK_SUBSECTION_ORDER = PRESET_INK_SUBSECTION_ORDER.slice();

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
    hammerLock: TYPEWRITER_DEFAULTS.caretLockEnabled,
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
    expToneVariationsQuality: SECTION_QUALITY_DEFAULTS.expToneVariations,
    expToneRibbonQuality: SECTION_QUALITY_DEFAULTS.expToneRibbon,
    expEdgeRimQuality: SECTION_QUALITY_DEFAULTS.expEdgeRim,
    expEdgeFuzzQuality: SECTION_QUALITY_DEFAULTS.expEdgeFuzz,
    expEdgeCounterFillQuality: SECTION_QUALITY_DEFAULTS.expEdgeCounterFill,
    expEdgeGrainQuality: SECTION_QUALITY_DEFAULTS.expEdgeGrain,
    expEdgeWeightQuality: SECTION_QUALITY_DEFAULTS.expEdgeWeight,
    expGrainSpeckleQuality: SECTION_QUALITY_DEFAULTS.expGrainSpeckle,
    expGrainDropoutsQuality: SECTION_QUALITY_DEFAULTS.expGrainDropouts,
    expDefectsSmudgeQuality: SECTION_QUALITY_DEFAULTS.expDefectsSmudge,
    expDefectsPunchQuality: SECTION_QUALITY_DEFAULTS.expDefectsPunch,
    expToneVariationsScale: SECTION_SCALE_DEFAULTS.expToneVariations,
    expToneRibbonScale: SECTION_SCALE_DEFAULTS.expToneRibbon,
    expEdgeRimScale: SECTION_SCALE_DEFAULTS.expEdgeRim,
    expEdgeFuzzScale: SECTION_SCALE_DEFAULTS.expEdgeFuzz,
    expEdgeCounterFillScale: SECTION_SCALE_DEFAULTS.expEdgeCounterFill,
    expEdgeGrainScale: SECTION_SCALE_DEFAULTS.expEdgeGrain,
    expEdgeWeightScale: SECTION_SCALE_DEFAULTS.expEdgeWeight,
    expGrainSpeckleScale: SECTION_SCALE_DEFAULTS.expGrainSpeckle,
    expGrainDropoutsScale: SECTION_SCALE_DEFAULTS.expGrainDropouts,
    expDefectsSmudgeScale: SECTION_SCALE_DEFAULTS.expDefectsSmudge,
    expDefectsPunchScale: SECTION_SCALE_DEFAULTS.expDefectsPunch,
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
    realTypewriterBackspaceEnabled: TYPEWRITER_DEFAULTS.backspaceEnabled,
    realTypewriterCaretLockEnabled: TYPEWRITER_DEFAULTS.caretLockEnabled,
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
  state.expToneVariationsQuality = SECTION_QUALITY_DEFAULTS.expToneVariations;
  state.expToneRibbonQuality = SECTION_QUALITY_DEFAULTS.expToneRibbon;
  state.expEdgeRimQuality = SECTION_QUALITY_DEFAULTS.expEdgeRim;
  state.expEdgeFuzzQuality = SECTION_QUALITY_DEFAULTS.expEdgeFuzz;
  state.expEdgeCounterFillQuality = SECTION_QUALITY_DEFAULTS.expEdgeCounterFill;
  state.expEdgeGrainQuality = SECTION_QUALITY_DEFAULTS.expEdgeGrain;
  state.expEdgeWeightQuality = SECTION_QUALITY_DEFAULTS.expEdgeWeight;
  state.expGrainSpeckleQuality = SECTION_QUALITY_DEFAULTS.expGrainSpeckle;
  state.expGrainDropoutsQuality = SECTION_QUALITY_DEFAULTS.expGrainDropouts;
  state.expDefectsSmudgeQuality = SECTION_QUALITY_DEFAULTS.expDefectsSmudge;
  state.expDefectsPunchQuality = SECTION_QUALITY_DEFAULTS.expDefectsPunch;
  state.expToneVariationsScale = SECTION_SCALE_DEFAULTS.expToneVariations;
  state.expToneRibbonScale = SECTION_SCALE_DEFAULTS.expToneRibbon;
  state.expEdgeRimScale = SECTION_SCALE_DEFAULTS.expEdgeRim;
  state.expEdgeFuzzScale = SECTION_SCALE_DEFAULTS.expEdgeFuzz;
  state.expEdgeCounterFillScale = SECTION_SCALE_DEFAULTS.expEdgeCounterFill;
  state.expEdgeGrainScale = SECTION_SCALE_DEFAULTS.expEdgeGrain;
  state.expEdgeWeightScale = SECTION_SCALE_DEFAULTS.expEdgeWeight;
  state.expGrainSpeckleScale = SECTION_SCALE_DEFAULTS.expGrainSpeckle;
  state.expGrainDropoutsScale = SECTION_SCALE_DEFAULTS.expGrainDropouts;
  state.expDefectsSmudgeScale = SECTION_SCALE_DEFAULTS.expDefectsSmudge;
  state.expDefectsPunchScale = SECTION_SCALE_DEFAULTS.expDefectsPunch;
  state.inkSectionOrder = DEFAULT_INK_SECTION_ORDER.slice();
}
