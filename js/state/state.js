import { GLYPH_JITTER_DEFAULTS, cloneGlyphJitterRange } from '../config/glyphJitterConfig.js';
import { INK_INTENSITY } from '../config/inkConfig.js';

const resolveIntensityDefault = (key) => {
  const source = INK_INTENSITY && typeof INK_INTENSITY === 'object' ? INK_INTENSITY[key] : null;
  const min = Number.isFinite(source?.minPct) ? source.minPct : 0;
  const max = Number.isFinite(source?.maxPct) ? Math.max(source.maxPct, min) : Math.max(200, min);
  const value = Number.isFinite(source?.defaultPct) ? source.defaultPct : 100;
  return Math.min(Math.max(value, min), max);
};

const CENTER_THICKEN_DEFAULT = resolveIntensityDefault('centerThicken');
const EDGE_THIN_DEFAULT = resolveIntensityDefault('edgeThin');

export function createMainState(app, gridDiv = 8) {
  return {
    pages: [],
    caret: { page:0, rowMu:0, col:0 },
    documentId: null,
    documentTitle: 'Untitled Document',
    marginL: 0, marginR: app.PAGE_W, marginTop: 0, marginBottom: 0,
    ink: 'b',
    showRulers: true,
    showMarginBox: false,
    hammerLock: true,
    caretAnchor: { x: 0.5, y: 0.5, unit: 'fraction' },
    paperOffset: { x: 0, y: 0 },
    stageWidthFactor: 2.0,
    stageHeightFactor: 1.2,
    cpi: 10,
    colsAcross: 82.68,
    inkWidthPct: 95,
    inkOpacity: { b: 100, r: 100, w: 100 },
    lineHeightFactor: 1.5,
    lineStepMu: Math.round(gridDiv * 1.5),
    zoom: 1.0,
    effectsOverallStrength: 100,
    inkFillStrength: 100,
    centerThickenPct: CENTER_THICKEN_DEFAULT,
    edgeThinPct: EDGE_THIN_DEFAULT,
    inkTextureStrength: 100,
    edgeBleedStrength: 0,
    edgeFuzzStrength: 100,
    grainPct: 0,
    expToneStrength: 100,
    expEdgeStrength: 100,
    expGrainStrength: 100,
    expDefectsStrength: 100,
    expToneQuality: 100,
    expEdgeQuality: 100,
    expGrainQuality: 100,
    expDefectsQuality: 100,
    grainSeed: 0xC0FFEE,
    altSeed: 0x51F15EED,
    inkSectionOrder: ['fill', 'texture', 'fuzz', 'bleed', 'grain', 'expTone', 'expEdge', 'expGrain', 'expDefects'],
    inkEffectsMode: 'classic',
    glyphJitterEnabled: GLYPH_JITTER_DEFAULTS.enabled,
    glyphJitterAmountPct: cloneGlyphJitterRange(GLYPH_JITTER_DEFAULTS.amountPct),
    glyphJitterFrequencyPct: cloneGlyphJitterRange(GLYPH_JITTER_DEFAULTS.frequencyPct),
    glyphJitterSeed: GLYPH_JITTER_DEFAULTS.seed >>> 0,
    wordWrap: true,
    themeMode: 'auto',
    darkPageInDarkMode: false,
    pageFillColor: '#ffffff',
    inkEffectsPreferWhite: false,
    savedInkStyles: [],
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
