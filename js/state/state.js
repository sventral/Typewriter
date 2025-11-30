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
  filters: getDefaultInkSectionStrength('filters'),
};

const SECTION_QUALITY_DEFAULTS = {
  filtersVariations: getDefaultInkSubsectionQuality('filters.variations'),
  filtersRibbon: getDefaultInkSubsectionQuality('filters.ribbon'),
  filtersRim: getDefaultInkSubsectionQuality('filters.rim'),
  filtersFuzz: getDefaultInkSubsectionQuality('filters.fuzz'),
  filtersCounterFill: getDefaultInkSubsectionQuality('filters.counterFill'),
  filtersGrain: getDefaultInkSubsectionQuality('filters.grain'),
  filtersWeight: getDefaultInkSubsectionQuality('filters.weight'),
  filtersSpeckle: getDefaultInkSubsectionQuality('filters.speckle'),
  filtersDropouts: getDefaultInkSubsectionQuality('filters.dropouts'),
  filtersSmudge: getDefaultInkSubsectionQuality('filters.smudge'),
  filtersPunch: getDefaultInkSubsectionQuality('filters.punch'),
};

const SECTION_SCALE_DEFAULTS = {
  filtersVariations: getDefaultInkSubsectionScale('filters.variations'),
  filtersRibbon: getDefaultInkSubsectionScale('filters.ribbon'),
  filtersRim: getDefaultInkSubsectionScale('filters.rim'),
  filtersFuzz: getDefaultInkSubsectionScale('filters.fuzz'),
  filtersCounterFill: getDefaultInkSubsectionScale('filters.counterFill'),
  filtersGrain: getDefaultInkSubsectionScale('filters.grain'),
  filtersWeight: getDefaultInkSubsectionScale('filters.weight'),
  filtersSpeckle: getDefaultInkSubsectionScale('filters.speckle'),
  filtersDropouts: getDefaultInkSubsectionScale('filters.dropouts'),
  filtersSmudge: getDefaultInkSubsectionScale('filters.smudge'),
  filtersPunch: getDefaultInkSubsectionScale('filters.punch'),
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
    filtersStrength: SECTION_STRENGTH_DEFAULTS.filters,
    filtersVariationsQuality: SECTION_QUALITY_DEFAULTS.filtersVariations,
    filtersRibbonQuality: SECTION_QUALITY_DEFAULTS.filtersRibbon,
    filtersRimQuality: SECTION_QUALITY_DEFAULTS.filtersRim,
    filtersFuzzQuality: SECTION_QUALITY_DEFAULTS.filtersFuzz,
    filtersCounterFillQuality: SECTION_QUALITY_DEFAULTS.filtersCounterFill,
    filtersGrainQuality: SECTION_QUALITY_DEFAULTS.filtersGrain,
    filtersWeightQuality: SECTION_QUALITY_DEFAULTS.filtersWeight,
    filtersSpeckleQuality: SECTION_QUALITY_DEFAULTS.filtersSpeckle,
    filtersDropoutsQuality: SECTION_QUALITY_DEFAULTS.filtersDropouts,
    filtersSmudgeQuality: SECTION_QUALITY_DEFAULTS.filtersSmudge,
    filtersPunchQuality: SECTION_QUALITY_DEFAULTS.filtersPunch,
    filtersVariationsScale: SECTION_SCALE_DEFAULTS.filtersVariations,
    filtersRibbonScale: SECTION_SCALE_DEFAULTS.filtersRibbon,
    filtersRimScale: SECTION_SCALE_DEFAULTS.filtersRim,
    filtersFuzzScale: SECTION_SCALE_DEFAULTS.filtersFuzz,
    filtersCounterFillScale: SECTION_SCALE_DEFAULTS.filtersCounterFill,
    filtersGrainScale: SECTION_SCALE_DEFAULTS.filtersGrain,
    filtersWeightScale: SECTION_SCALE_DEFAULTS.filtersWeight,
    filtersSpeckleScale: SECTION_SCALE_DEFAULTS.filtersSpeckle,
    filtersDropoutsScale: SECTION_SCALE_DEFAULTS.filtersDropouts,
    filtersSmudgeScale: SECTION_SCALE_DEFAULTS.filtersSmudge,
    filtersPunchScale: SECTION_SCALE_DEFAULTS.filtersPunch,
    altSeed: 0x51F15EED,
    inkSectionOrder: DEFAULT_INK_SECTION_ORDER.slice(),
    inkSubsectionOrder: DEFAULT_INK_SUBSECTION_ORDER.slice(),
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
  state.filtersStrength = SECTION_STRENGTH_DEFAULTS.filters;
  state.filtersVariationsQuality = SECTION_QUALITY_DEFAULTS.filtersVariations;
  state.filtersRibbonQuality = SECTION_QUALITY_DEFAULTS.filtersRibbon;
  state.filtersRimQuality = SECTION_QUALITY_DEFAULTS.filtersRim;
  state.filtersFuzzQuality = SECTION_QUALITY_DEFAULTS.filtersFuzz;
  state.filtersCounterFillQuality = SECTION_QUALITY_DEFAULTS.filtersCounterFill;
  state.filtersGrainQuality = SECTION_QUALITY_DEFAULTS.filtersGrain;
  state.filtersWeightQuality = SECTION_QUALITY_DEFAULTS.filtersWeight;
  state.filtersSpeckleQuality = SECTION_QUALITY_DEFAULTS.filtersSpeckle;
  state.filtersDropoutsQuality = SECTION_QUALITY_DEFAULTS.filtersDropouts;
  state.filtersSmudgeQuality = SECTION_QUALITY_DEFAULTS.filtersSmudge;
  state.filtersPunchQuality = SECTION_QUALITY_DEFAULTS.filtersPunch;
  state.filtersVariationsScale = SECTION_SCALE_DEFAULTS.filtersVariations;
  state.filtersRibbonScale = SECTION_SCALE_DEFAULTS.filtersRibbon;
  state.filtersRimScale = SECTION_SCALE_DEFAULTS.filtersRim;
  state.filtersFuzzScale = SECTION_SCALE_DEFAULTS.filtersFuzz;
  state.filtersCounterFillScale = SECTION_SCALE_DEFAULTS.filtersCounterFill;
  state.filtersGrainScale = SECTION_SCALE_DEFAULTS.filtersGrain;
  state.filtersWeightScale = SECTION_SCALE_DEFAULTS.filtersWeight;
  state.filtersSpeckleScale = SECTION_SCALE_DEFAULTS.filtersSpeckle;
  state.filtersDropoutsScale = SECTION_SCALE_DEFAULTS.filtersDropouts;
  state.filtersSmudgeScale = SECTION_SCALE_DEFAULTS.filtersSmudge;
  state.filtersPunchScale = SECTION_SCALE_DEFAULTS.filtersPunch;
  state.inkSectionOrder = DEFAULT_INK_SECTION_ORDER.slice();
  state.inkSubsectionOrder = DEFAULT_INK_SUBSECTION_ORDER.slice();
}
