import { clamp } from '../utils/math.js';
import { DEFAULT_PAPER_SIZE, normalizePaperSizeId } from '../config/paperSizes.js';
import {
  GLYPH_JITTER_DEFAULTS,
  normalizeGlyphJitterAmount,
  normalizeGlyphJitterFrequency,
  normalizeGlyphJitterSeed,
  cloneGlyphJitterRange,
} from '../config/glyphJitterConfig.js';
import {
  LOW_RES_ZOOM_DEFAULTS,
  normalizeLowResZoomSettings,
  ZOOM_SLIDER_MAX_PCT,
  ZOOM_SLIDER_MIN_PCT,
} from '../config/lowResZoom.js';
import {
  LINE_SLANT_DEFAULTS,
  normalizeLineSlantRange,
  clampLineSlantDeg,
  sampleLineSlantDeg,
} from '../config/lineSlantConfig.js';
import {
  DEFAULT_INK_SECTION_ORDER as PRESET_INK_SECTION_ORDER,
  DEFAULT_INK_SUBSECTION_ORDER as PRESET_INK_SUBSECTION_ORDER,
  getDefaultInkSectionQuality,
  getDefaultInkSectionStrength,
  getDefaultInkSubsectionQuality,
  getDefaultInkSubsectionScale,
} from '../config/inkEffectDefaultStyle.js';
import { TYPEWRITER_DEFAULTS, normalizeTypewriterSettings } from '../config/typewriterMode.js';
import { hydrateGlyphEntry, serializeGlyphEntry } from './glyphStack.js';
import { STAGE_HEIGHT_MAX, STAGE_HEIGHT_MIN, STAGE_WIDTH_MAX, STAGE_WIDTH_MIN } from '../layout/stageLayout.js';
import { createDefaultPageNumberingSettings, sanitizePageNumberingSettings } from '../config/pageNumbering.js';
import { DEFAULT_INK, SUPPORTED_INKS, createDefaultInkOpacity, normalizeInkId } from '../config/inkPalette.js';

export const METADATA_VERSION = 2;

const KNOWN_INK_SECTIONS = PRESET_INK_SECTION_ORDER.slice();
const KNOWN_INK_SUBSECTIONS = PRESET_INK_SUBSECTION_ORDER.slice();
const EFFECT_QUALITY_DEFAULT = 100;
const EFFECT_QUALITY_MIN = 0;
const EFFECT_QUALITY_MAX = 200;
const EFFECT_SCALE_DEFAULT = 100;
const EFFECT_SCALE_MIN = 0;
const EFFECT_SCALE_MAX = 200;

const SECTION_STRENGTH_DEFAULTS = Object.freeze({
  filters: getDefaultInkSectionStrength('filters'),
});

const SECTION_QUALITY_DEFAULTS = Object.freeze({
  'filters.variations': getDefaultInkSubsectionQuality('filters.variations'),
  'filters.ribbon': getDefaultInkSubsectionQuality('filters.ribbon'),
  'filters.rim': getDefaultInkSubsectionQuality('filters.rim'),
  'filters.fuzz': getDefaultInkSubsectionQuality('filters.fuzz'),
  'filters.counterFill': getDefaultInkSubsectionQuality('filters.counterFill'),
  'filters.grain': getDefaultInkSubsectionQuality('filters.grain'),
  'filters.weight': getDefaultInkSubsectionQuality('filters.weight'),
  'filters.speckle': getDefaultInkSubsectionQuality('filters.speckle'),
  'filters.dropouts': getDefaultInkSubsectionQuality('filters.dropouts'),
  'filters.smudge': getDefaultInkSubsectionQuality('filters.smudge'),
  'filters.punch': getDefaultInkSubsectionQuality('filters.punch'),
});

const SECTION_SCALE_DEFAULTS = Object.freeze({
  'filters.variations': getDefaultInkSubsectionScale('filters.variations'),
  'filters.ribbon': getDefaultInkSubsectionScale('filters.ribbon'),
  'filters.rim': getDefaultInkSubsectionScale('filters.rim'),
  'filters.fuzz': getDefaultInkSubsectionScale('filters.fuzz'),
  'filters.counterFill': getDefaultInkSubsectionScale('filters.counterFill'),
  'filters.grain': getDefaultInkSubsectionScale('filters.grain'),
  'filters.weight': getDefaultInkSubsectionScale('filters.weight'),
  'filters.speckle': getDefaultInkSubsectionScale('filters.speckle'),
  'filters.dropouts': getDefaultInkSubsectionScale('filters.dropouts'),
  'filters.smudge': getDefaultInkSubsectionScale('filters.smudge'),
  'filters.punch': getDefaultInkSubsectionScale('filters.punch'),
});

const STYLE_INCLUDE_DEFAULTS = Object.freeze({
  font: true,
  slant: true,
  jitter: true,
  effects: true,
});

const SECTION_TO_SUBSECTIONS = Object.freeze({
  filters: [
    'filters.variations',
    'filters.ribbon',
    'filters.rim',
    'filters.fuzz',
    'filters.counterFill',
    'filters.grain',
    'filters.weight',
    'filters.speckle',
    'filters.dropouts',
    'filters.smudge',
    'filters.punch',
  ],
});

function normalizeInkSectionOrder(order, fallback = KNOWN_INK_SECTIONS) {
  const base = Array.isArray(order) ? order : [];
  const seen = new Set();
  const normalized = [];
  base.forEach(id => {
    if (typeof id !== 'string') return;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return;
    if (!KNOWN_INK_SECTIONS.includes(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  (Array.isArray(fallback) ? fallback : KNOWN_INK_SECTIONS).forEach(id => {
    if (!KNOWN_INK_SECTIONS.includes(id)) return;
    if (seen.has(id)) return;
    seen.add(id);
    normalized.push(id);
  });
  return normalized;
}

function normalizeInkSubsectionOrder(order, fallback = KNOWN_INK_SUBSECTIONS) {
  const base = Array.isArray(order) ? order : [];
  const seen = new Set();
  const normalized = [];
  base.forEach(id => {
    if (typeof id !== 'string') return;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return;
    if (!KNOWN_INK_SUBSECTIONS.includes(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  (Array.isArray(fallback) ? fallback : KNOWN_INK_SUBSECTIONS).forEach(id => {
    if (!KNOWN_INK_SUBSECTIONS.includes(id)) return;
    if (seen.has(id)) return;
    seen.add(id);
    normalized.push(id);
  });
  return normalized;
}

function cloneInkStyleValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => cloneInkStyleValue(item));
  }
  if (value && typeof value === 'object') {
    const clone = {};
    for (const key of Object.keys(value)) {
      clone[key] = cloneInkStyleValue(value[key]);
    }
    return clone;
  }
  return value;
}

function normalizeSubsectionNumber(value, fallback, min, max) {
  const normalizedFallback = Number.isFinite(fallback) ? fallback : fallback === 0 ? 0 : undefined;
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return clamp(Number.isFinite(normalizedFallback) ? normalizedFallback : 0, min, max);
  }
  return clamp(raw, min, max);
}

function normalizeSubsectionSettings(sectionId, source, legacyValue, defaults, range = { min: 0, max: 100 }) {
  const result = {};
  const list = SECTION_TO_SUBSECTIONS[sectionId] || [];
  list.forEach(fullId => {
    const [, subId] = fullId.split('.');
    const rawSource = source && typeof source === 'object'
      ? (Object.prototype.hasOwnProperty.call(source, subId) ? source[subId] : source[fullId])
      : undefined;
    const fallback = Number.isFinite(legacyValue) ? legacyValue : defaults[fullId];
    result[subId] = normalizeSubsectionNumber(
      rawSource,
      fallback,
      range.min,
      range.max,
    );
  });
  return result;
}

function sanitizeStyleIncludes(source) {
  const base = { ...STYLE_INCLUDE_DEFAULTS };
  if (source && typeof source === 'object') {
    Object.keys(base).forEach(key => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        base[key] = !!source[key];
      }
    });
  }
  return base;
}

function sanitizeStyleSection(sectionValue, sectionId) {
  if (!sectionValue || typeof sectionValue !== 'object') {
    return { strength: 0, config: null, qualities: {}, scales: {} };
  }
  const strength = clamp(Number(sectionValue.strength ?? sectionValue.value ?? sectionValue.percent ?? 0), 0, 100);
  const configSource = sectionValue.config != null
    ? sectionValue.config
    : sectionValue.settings != null
      ? sectionValue.settings
      : ('strength' in sectionValue ? null : sectionValue);
  const config = configSource == null ? null : cloneInkStyleValue(configSource);
  const legacyQuality = sectionValue.quality;
  const legacyScale = sectionValue.scale;
  const qualities = normalizeSubsectionSettings(
    sectionId,
    sectionValue.qualities,
    legacyQuality,
    SECTION_QUALITY_DEFAULTS,
    { min: EFFECT_QUALITY_MIN, max: EFFECT_QUALITY_MAX },
  );
  const scales = normalizeSubsectionSettings(
    sectionId,
    sectionValue.scales,
    legacyScale,
    SECTION_SCALE_DEFAULTS,
    { min: EFFECT_SCALE_MIN, max: EFFECT_SCALE_MAX },
  );
  const convertSubId = val => {
    if (typeof val !== 'string') return null;
    const trimmed = val.trim();
    if (!trimmed) return null;
    return trimmed.includes('.') ? trimmed : `${sectionId}.${trimmed}`;
  };
  const rawOrder = Array.isArray(sectionValue.order)
    ? sectionValue.order
    : Array.isArray(sectionValue.subsectionOrder)
      ? sectionValue.subsectionOrder
      : null;
  const normalizedOrder = normalizeInkSubsectionOrder(
    rawOrder ? rawOrder.map(convertSubId).filter(Boolean) : SECTION_TO_SUBSECTIONS[sectionId],
    SECTION_TO_SUBSECTIONS[sectionId],
  ).filter(id => id.startsWith(`${sectionId}.`));
  return { strength, config, qualities, scales, order: normalizedOrder };
}

function sanitizeSavedInkStyle(style, index = 0) {
  if (!style || typeof style !== 'object') {
    return {
      id: `style-${index}-${Date.now().toString(36)}`,
      name: `Style ${index + 1}`,
      overall: 100,
      sections: {},
      sectionOrder: KNOWN_INK_SECTIONS.slice(),
      subsectionOrder: KNOWN_INK_SUBSECTIONS.slice(),
      includes: { ...STYLE_INCLUDE_DEFAULTS },
      fontName: null,
      lineSlantEnabled: null,
      lineSlantRangeDeg: null,
      glyphJitterEnabled: null,
      glyphJitterAmountPct: null,
      glyphJitterFrequencyPct: null,
      glyphJitterSeed: null,
    };
  }
  const id = typeof style.id === 'string' && style.id.trim()
    ? style.id.trim()
    : `style-${index}-${Date.now().toString(36)}`;
  const name = typeof style.name === 'string' && style.name.trim()
    ? style.name.trim().slice(0, 80)
    : `Style ${index + 1}`;
  const overall = clamp(Number(style.overall ?? 100), 0, 100);
  const sections = {};
  if (style.sections && typeof style.sections === 'object') {
    for (const [sectionId, sectionValue] of Object.entries(style.sections)) {
      if (!KNOWN_INK_SECTIONS.includes(sectionId)) continue;
      sections[sectionId] = sanitizeStyleSection(sectionValue, sectionId);
    }
  }
  KNOWN_INK_SECTIONS.forEach(sectionId => {
    if (sections[sectionId]) return;
    if (!style[sectionId] || typeof style[sectionId] !== 'object') return;
    sections[sectionId] = sanitizeStyleSection(style[sectionId], sectionId);
  });
  const sectionOrder = normalizeInkSectionOrder(style.sectionOrder);
  const subsectionOrder = normalizeInkSubsectionOrder(
    style.subsectionOrder || style.inkSubsectionOrder || Object.values(sections).flatMap(section => section.order || []),
  );
  return {
    id,
    name,
    overall,
    sections,
    sectionOrder,
    subsectionOrder,
    includes: sanitizeStyleIncludes(style.includes),
    fontName: typeof style.fontName === 'string' ? style.fontName : null,
    lineSlantEnabled: typeof style.lineSlantEnabled === 'boolean' ? style.lineSlantEnabled : null,
    lineSlantRangeDeg: style.lineSlantRangeDeg && typeof style.lineSlantRangeDeg === 'object'
      ? cloneInkStyleValue(style.lineSlantRangeDeg)
      : null,
    glyphJitterEnabled: typeof style.glyphJitterEnabled === 'boolean' ? style.glyphJitterEnabled : null,
    glyphJitterAmountPct: style.glyphJitterAmountPct && typeof style.glyphJitterAmountPct === 'object'
      ? cloneInkStyleValue(style.glyphJitterAmountPct)
      : null,
    glyphJitterFrequencyPct: style.glyphJitterFrequencyPct && typeof style.glyphJitterFrequencyPct === 'object'
      ? cloneInkStyleValue(style.glyphJitterFrequencyPct)
      : null,
    glyphJitterSeed: Number.isFinite(style.glyphJitterSeed) ? style.glyphJitterSeed >>> 0 : null,
  };
}

function sanitizeSavedInkStyles(styles) {
  if (!Array.isArray(styles)) return [];
  return styles.map((style, index) => sanitizeSavedInkStyle(style, index));
}

export const DEFAULT_DOCUMENT_TITLE = 'Untitled Document';

export function normalizeDocumentTitle(title) {
  if (typeof title !== 'string') return DEFAULT_DOCUMENT_TITLE;
  const trimmed = title.trim();
  return trimmed ? trimmed.slice(0, 200) : DEFAULT_DOCUMENT_TITLE;
}

export function generateDocumentId(existingIds = null) {
  const baseSet = existingIds instanceof Set ? existingIds : new Set();
  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  let id;
  do {
    id = hasCrypto
      ? crypto.randomUUID()
      : `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (baseSet.has(id));
  baseSet.add(id);
  return id;
}

export function serializeDocumentState(state, { getActiveFontName } = {}) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  const activeFont = typeof getActiveFontName === 'function'
    ? getActiveFontName()
    : undefined;
  const pages = Array.isArray(state.pages)
    ? state.pages.map((p) => {
        if (!p || typeof p !== 'object' || !(p.grid instanceof Map)) {
          return { rows: [] };
        }
        const rows = [];
        for (const [rmu, rowMap] of p.grid) {
          if (!(rowMap instanceof Map)) continue;
          const cols = [];
          for (const [c, stack] of rowMap) {
            if (!Array.isArray(stack) || !Number.isFinite(c)) continue;
            cols.push([
              c,
              stack.map((s) => serializeGlyphEntry(s)),
            ]);
          }
          rows.push([rmu, cols]);
        }
        const slant = Number.isFinite(p.lineSlantDeg) ? p.lineSlantDeg : undefined;
        return { rows, slant };
      })
    : [];
  const glyphJitterAmount = normalizeGlyphJitterAmount(state.glyphJitterAmountPct, GLYPH_JITTER_DEFAULTS.amountPct);
  const glyphJitterFrequency = normalizeGlyphJitterFrequency(state.glyphJitterFrequencyPct, GLYPH_JITTER_DEFAULTS.frequencyPct);
  const glyphJitterSeed = normalizeGlyphJitterSeed(state.glyphJitterSeed, GLYPH_JITTER_DEFAULTS.seed);
  const lowResZoom = normalizeLowResZoomSettings(
    {
      softCapPct: state.lowResZoomSoftCapPct,
      marginPct: state.lowResZoomMarginPct,
    },
    { maxZoomPct: ZOOM_SLIDER_MAX_PCT, minSoftCapPct: ZOOM_SLIDER_MIN_PCT },
  );
  const lowResZoomEnabled = state.lowResZoomEnabled !== false;
  const pageNumbering = sanitizePageNumberingSettings(
    state.pageNumbering,
    createDefaultPageNumberingSettings(),
  );
  const lineSlantRange = normalizeLineSlantRange(state.lineSlantRangeDeg, LINE_SLANT_DEFAULTS.range);

  const realTypewriter = normalizeTypewriterSettings(
    {
      enabled: state.realTypewriterEnabled,
      bellSound: state.realTypewriterBellSound,
      bellVolume: state.realTypewriterBellVolume,
      bellLead: state.realTypewriterBellLead,
      stopSound: state.realTypewriterStopSound,
      stopEnabled: state.realTypewriterStopEnabled,
      backspaceEnabled: state.realTypewriterBackspaceEnabled,
      caretLockEnabled: state.realTypewriterCaretLockEnabled,
    },
    TYPEWRITER_DEFAULTS,
  );

  return {
    v: 31,
    fontName: activeFont,
    documentId: typeof state.documentId === 'string' ? state.documentId : null,
    documentTitle: typeof state.documentTitle === 'string'
      ? state.documentTitle
      : DEFAULT_DOCUMENT_TITLE,
    margins: {
      L: state.marginL,
      R: state.marginR,
      T: state.marginTop,
      B: state.marginBottom,
    },
    caret: state.caret,
    paperSize: normalizePaperSizeId(state.paperSize || DEFAULT_PAPER_SIZE),
    ink: state.ink,
    showRulers: state.showRulers,
    showMarginBox: state.showMarginBox,
    cpi: state.cpi,
    colsAcross: state.colsAcross,
    inkWidthPct: state.inkWidthPct,
    inkOpacity: state.inkOpacity,
    lineHeightFactor: state.lineHeightFactor,
    zoom: state.zoom,
    effectsOverallStrength: clamp(Number(state.effectsOverallStrength ?? 100), 0, 100),
    filtersStrength: clamp(Number(state.filtersStrength ?? SECTION_STRENGTH_DEFAULTS.filters), 0, 100),
    filtersVariationsQuality: clamp(Number(state.filtersVariationsQuality ?? SECTION_QUALITY_DEFAULTS['filters.variations']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersRibbonQuality: clamp(Number(state.filtersRibbonQuality ?? SECTION_QUALITY_DEFAULTS['filters.ribbon']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersRimQuality: clamp(Number(state.filtersRimQuality ?? SECTION_QUALITY_DEFAULTS['filters.rim']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersFuzzQuality: clamp(Number(state.filtersFuzzQuality ?? SECTION_QUALITY_DEFAULTS['filters.fuzz']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersCounterFillQuality: clamp(Number(state.filtersCounterFillQuality ?? SECTION_QUALITY_DEFAULTS['filters.counterFill']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersGrainQuality: clamp(Number(state.filtersGrainQuality ?? SECTION_QUALITY_DEFAULTS['filters.grain']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersWeightQuality: clamp(Number(state.filtersWeightQuality ?? SECTION_QUALITY_DEFAULTS['filters.weight']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersSpeckleQuality: clamp(Number(state.filtersSpeckleQuality ?? SECTION_QUALITY_DEFAULTS['filters.speckle']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersDropoutsQuality: clamp(Number(state.filtersDropoutsQuality ?? SECTION_QUALITY_DEFAULTS['filters.dropouts']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersSmudgeQuality: clamp(Number(state.filtersSmudgeQuality ?? SECTION_QUALITY_DEFAULTS['filters.smudge']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersPunchQuality: clamp(Number(state.filtersPunchQuality ?? SECTION_QUALITY_DEFAULTS['filters.punch']), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    filtersVariationsScale: clamp(Number(state.filtersVariationsScale ?? SECTION_SCALE_DEFAULTS['filters.variations']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    filtersRibbonScale: clamp(Number(state.filtersRibbonScale ?? SECTION_SCALE_DEFAULTS['filters.ribbon']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    filtersRimScale: clamp(Number(state.filtersRimScale ?? SECTION_SCALE_DEFAULTS['filters.rim']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    filtersFuzzScale: clamp(Number(state.filtersFuzzScale ?? SECTION_SCALE_DEFAULTS['filters.fuzz']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    filtersCounterFillScale: clamp(Number(state.filtersCounterFillScale ?? SECTION_SCALE_DEFAULTS['filters.counterFill']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    filtersGrainScale: clamp(Number(state.filtersGrainScale ?? SECTION_SCALE_DEFAULTS['filters.grain']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    filtersWeightScale: clamp(Number(state.filtersWeightScale ?? SECTION_SCALE_DEFAULTS['filters.weight']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    filtersSpeckleScale: clamp(Number(state.filtersSpeckleScale ?? SECTION_SCALE_DEFAULTS['filters.speckle']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    filtersDropoutsScale: clamp(Number(state.filtersDropoutsScale ?? SECTION_SCALE_DEFAULTS['filters.dropouts']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    filtersSmudgeScale: clamp(Number(state.filtersSmudgeScale ?? SECTION_SCALE_DEFAULTS['filters.smudge']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    filtersPunchScale: clamp(Number(state.filtersPunchScale ?? SECTION_SCALE_DEFAULTS['filters.punch']), EFFECT_SCALE_MIN, EFFECT_SCALE_MAX),
    inkSectionOrder: normalizeInkSectionOrder(state.inkSectionOrder),
    inkSubsectionOrder: normalizeInkSubsectionOrder(state.inkSubsectionOrder),
    wordWrap: state.wordWrap,
    stageWidthFactor: state.stageWidthFactor,
    stageHeightFactor: state.stageHeightFactor,
    themeMode: state.themeMode || 'auto',
    darkPageInDarkMode: !!state.darkPageInDarkMode,
    lagAssistEnabled: state.lagAssistEnabled !== false,
    pageFillColor: state.pageFillColor,
    savedInkStyles: sanitizeSavedInkStyles(state.savedInkStyles),
    currentInkStyle: state.currentInkStyle ? sanitizeSavedInkStyle(state.currentInkStyle) : null,
    pageNumbering,
    realTypewriter,
    lineSlant: {
      enabled: state.lineSlantEnabled !== false,
      range: lineSlantRange,
    },
    glyphJitter: {
      enabled: !!state.glyphJitterEnabled,
      amountPct: cloneGlyphJitterRange(glyphJitterAmount),
      frequencyPct: cloneGlyphJitterRange(glyphJitterFrequency),
      seed: glyphJitterSeed,
    },
    lowResZoom: {
      enabled: lowResZoomEnabled,
      softCapPct: lowResZoom.softCapPct ?? LOW_RES_ZOOM_DEFAULTS.softCapPct,
      marginPct: lowResZoom.marginPct ?? LOW_RES_ZOOM_DEFAULTS.marginPct,
    },
    pages,
  };
}

export function deserializeDocumentState(data, context) {
  const {
    state,
    app,
    getGridDiv,
    prepareCanvas,
    makePageRecord,
    computeColsFromCpi,
    setActiveFontName,
    applyPaperSizeSelection,
    scheduleMetricsUpdate,
  } = context || {};

  if (!state || !app) return false;
  const gridDiv = typeof getGridDiv === 'function' ? getGridDiv() : 0;
  if (!data || data.v < 2 || data.v > 31) return false;
  const targetPaperSize = typeof data.paperSize === 'string'
    ? data.paperSize
    : state.paperSize || DEFAULT_PAPER_SIZE;
  if (typeof applyPaperSizeSelection === 'function') {
    applyPaperSizeSelection(targetPaperSize, {
      silent: true,
      preserveMargins: false,
      updateColumns: false,
      triggerLayout: false,
      scheduleMetrics: false,
      triggerRewrap: false,
      markDirty: false,
      save: false,
      focus: false,
    });
  }
  state.paperSize = normalizePaperSizeId(targetPaperSize);
  state.pages = [];
  if (app.stageInner) {
    app.stageInner.innerHTML = '';
  }
  const hasStoredMarginBox = data && Object.prototype.hasOwnProperty.call(data, 'showMarginBox');
  const resolvedShowMarginBox = hasStoredMarginBox ? !!data.showMarginBox : !!state.showMarginBox;
  const pgArr = Array.isArray(data.pages) ? data.pages : [];
  pgArr.forEach((pg, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = String(idx);
    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.height = app.PAGE_H + 'px';
    const cv = document.createElement('canvas');
    if (typeof prepareCanvas === 'function') {
      prepareCanvas(cv);
    }
    const mb = document.createElement('div');
    mb.className = 'margin-box';
    mb.style.visibility = resolvedShowMarginBox ? 'visible' : 'hidden';
    pageEl.appendChild(cv);
    pageEl.appendChild(mb);
    wrap.appendChild(pageEl);
    app.stageInner.appendChild(wrap);
    if (idx === 0) {
      app.firstPageWrap = wrap;
      app.firstPage = pageEl;
      app.marginBox = mb;
    }
    const page = typeof makePageRecord === 'function'
      ? makePageRecord(idx, wrap, pageEl, cv, mb)
      : null;
    if (!page) return;
    page.lineSlantDeg = state.lineSlantEnabled
      ? clampLineSlantDeg(pg?.slant ?? sampleLineSlantDeg(state.lineSlantRangeDeg), state.lineSlantRangeDeg)
      : 0;
    if (page.marginBoxEl) {
      page.marginBoxEl.style.setProperty('--line-slant-deg', `${page.lineSlantDeg}deg`);
    }
    state.pages.push(page);
    if (Array.isArray(pg?.rows)) {
      for (const [rmu, cols] of pg.rows) {
        const rowMap = new Map();
        if (Array.isArray(cols)) {
          for (const [c, stackArr] of cols) {
            rowMap.set(c, Array.isArray(stackArr)
              ? stackArr.map((s) => hydrateGlyphEntry(s?.ch, s?.ink, s?.salt))
              : []);
          }
        }
        page.grid.set(rmu, rowMap);
      }
    }
  });

  if (!state.pages.length) {
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = '0';
    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.height = app.PAGE_H + 'px';
    const cv = document.createElement('canvas');
    if (typeof prepareCanvas === 'function') {
      prepareCanvas(cv);
    }
    const mb = document.createElement('div');
    mb.className = 'margin-box';
    mb.style.visibility = resolvedShowMarginBox ? 'visible' : 'hidden';
    pageEl.appendChild(cv);
    pageEl.appendChild(mb);
    wrap.appendChild(pageEl);
    app.stageInner.appendChild(wrap);
    app.firstPageWrap = wrap;
    app.firstPage = pageEl;
    app.marginBox = mb;
    const page = typeof makePageRecord === 'function'
      ? makePageRecord(0, wrap, pageEl, cv, mb)
      : null;
    if (page) {
      page.canvas.style.visibility = 'hidden';
      page.lineSlantDeg = state.lineSlantEnabled
        ? clampLineSlantDeg(sampleLineSlantDeg(state.lineSlantRangeDeg), state.lineSlantRangeDeg)
        : 0;
      if (page.marginBoxEl) {
        page.marginBoxEl.style.setProperty('--line-slant-deg', `${page.lineSlantDeg}deg`);
      }
      state.pages.push(page);
    }
  }

  let inferredCols = data.colsAcross;
  const cpiVal = data.cpi ?? null;
  if (cpiVal && typeof computeColsFromCpi === 'function') {
    inferredCols = computeColsFromCpi(cpiVal).cols2;
  }
  const defaultInkOpacity = createDefaultInkOpacity(100);
  const inkOpacity = (data.inkOpacity && typeof data.inkOpacity === 'object')
    ? SUPPORTED_INKS.reduce((map, key) => {
        map[key] = clamp(Number(data.inkOpacity[key] ?? defaultInkOpacity[key]), 0, 100);
        return map;
      }, {})
    : defaultInkOpacity;
  const storedInkWidth = Number(data.inkWidthPct);
  const sanitizedInkWidth = Number.isFinite(storedInkWidth)
    ? clamp(Math.round(storedInkWidth), 1, 150)
    : 95;
  const storedStageWidth = Number(data.stageWidthFactor);
  const storedStageHeight = Number(data.stageHeightFactor);
  const sanitizedStageWidth = Number.isFinite(storedStageWidth)
    ? clamp(storedStageWidth, STAGE_WIDTH_MIN, STAGE_WIDTH_MAX)
    : state.stageWidthFactor;
  const sanitizedStageHeight = Number.isFinite(storedStageHeight)
    ? clamp(storedStageHeight, STAGE_HEIGHT_MIN, STAGE_HEIGHT_MAX)
    : state.stageHeightFactor;
  const jitterBlock = data.glyphJitter && typeof data.glyphJitter === 'object'
    ? data.glyphJitter
    : null;
  const fallbackAmount = state.glyphJitterAmountPct || GLYPH_JITTER_DEFAULTS.amountPct;
  const fallbackFrequency = state.glyphJitterFrequencyPct || GLYPH_JITTER_DEFAULTS.frequencyPct;
  const sanitizedJitterAmount = normalizeGlyphJitterAmount(jitterBlock?.amountPct, fallbackAmount);
  const sanitizedJitterFrequency = normalizeGlyphJitterFrequency(jitterBlock?.frequencyPct, fallbackFrequency);
  const sanitizedJitterSeed = normalizeGlyphJitterSeed(jitterBlock?.seed, state.glyphJitterSeed ?? GLYPH_JITTER_DEFAULTS.seed);
  const lowResZoomBlock = (data.lowResZoom && typeof data.lowResZoom === 'object') ? data.lowResZoom : {};
  const normalizedLowResZoom = normalizeLowResZoomSettings(
    {
      softCapPct: lowResZoomBlock.softCapPct,
      marginPct: lowResZoomBlock.marginPct,
    },
    { maxZoomPct: ZOOM_SLIDER_MAX_PCT, minSoftCapPct: ZOOM_SLIDER_MIN_PCT },
  );
  const lowResZoomEnabled = lowResZoomBlock.enabled !== false;
  const normalizedTypewriter = normalizeTypewriterSettings(
    data.realTypewriter,
    TYPEWRITER_DEFAULTS,
  );
  const storedLineSlant = data.lineSlant && typeof data.lineSlant === 'object' ? data.lineSlant : null;
  const normalizedLineSlantRange = normalizeLineSlantRange(
    storedLineSlant?.range,
    state.lineSlantRangeDeg ?? LINE_SLANT_DEFAULTS.range,
  );
  const legacySectionStrengths = [
    data.expToneStrength,
    data.expEdgeStrength,
    data.expGrainStrength,
    data.expDefectsStrength,
  ].filter(val => Number.isFinite(val));
  const legacyStrengthFallback = legacySectionStrengths.length
    ? Math.max(...legacySectionStrengths)
    : null;

  Object.assign(state, {
    marginL: data.margins?.L ?? state.marginL,
    marginR: data.margins?.R ?? state.marginR,
    marginTop: data.margins?.T ?? state.marginTop,
    marginBottom: data.margins?.B ?? state.marginBottom,
    caret: data.caret
      ? { page: data.caret.page || 0, rowMu: data.caret.rowMu || 0, col: data.caret.col || 0 }
      : state.caret,
    ink: normalizeInkId(data.ink ?? state.ink ?? DEFAULT_INK),
    showRulers: data.showRulers !== false,
    showMarginBox: resolvedShowMarginBox,
    cpi: cpiVal || 10,
    colsAcross: inferredCols ?? state.colsAcross,
    paperSize: normalizePaperSizeId(data.paperSize || state.paperSize || DEFAULT_PAPER_SIZE),
    inkWidthPct: sanitizedInkWidth,
    inkOpacity,
    lineHeightFactor: [1, 1.5, 2, 2.5, 3].includes(data.lineHeightFactor)
      ? data.lineHeightFactor
      : 1.5,
    zoom: typeof data.zoom === 'number' && data.zoom >= 0.5 && data.zoom <= 4 ? data.zoom : 1.0,
    lowResZoomEnabled,
    lowResZoomSoftCapPct: normalizedLowResZoom.softCapPct ?? LOW_RES_ZOOM_DEFAULTS.softCapPct,
    lowResZoomMarginPct: normalizedLowResZoom.marginPct ?? LOW_RES_ZOOM_DEFAULTS.marginPct,
    effectsOverallStrength: clamp(Number(data.effectsOverallStrength ?? state.effectsOverallStrength ?? 100), 0, 100),
    filtersStrength: clamp(
      Number(data.filtersStrength ?? state.filtersStrength ?? legacyStrengthFallback ?? SECTION_STRENGTH_DEFAULTS.filters),
      0,
      100,
    ),
    filtersVariationsQuality: clamp(
      Number(
        data.filtersVariationsQuality
        ?? state.filtersVariationsQuality
        ?? data.expToneVariationsQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.variations']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersRibbonQuality: clamp(
      Number(
        data.filtersRibbonQuality
        ?? state.filtersRibbonQuality
        ?? data.expToneRibbonQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.ribbon']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersRimQuality: clamp(
      Number(
        data.filtersRimQuality
        ?? state.filtersRimQuality
        ?? data.expEdgeRimQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.rim']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersFuzzQuality: clamp(
      Number(
        data.filtersFuzzQuality
        ?? state.filtersFuzzQuality
        ?? data.expEdgeFuzzQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.fuzz']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersCounterFillQuality: clamp(
      Number(
        data.filtersCounterFillQuality
        ?? state.filtersCounterFillQuality
        ?? data.expEdgeCounterFillQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.counterFill']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersGrainQuality: clamp(
      Number(
        data.filtersGrainQuality
        ?? state.filtersGrainQuality
        ?? data.expEdgeGrainQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.grain']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersWeightQuality: clamp(
      Number(
        data.filtersWeightQuality
        ?? state.filtersWeightQuality
        ?? data.expEdgeWeightQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.weight']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersSpeckleQuality: clamp(
      Number(
        data.filtersSpeckleQuality
        ?? state.filtersSpeckleQuality
        ?? data.expGrainSpeckleQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.speckle']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersDropoutsQuality: clamp(
      Number(
        data.filtersDropoutsQuality
        ?? state.filtersDropoutsQuality
        ?? data.expGrainDropoutsQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.dropouts']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersSmudgeQuality: clamp(
      Number(
        data.filtersSmudgeQuality
        ?? state.filtersSmudgeQuality
        ?? data.expDefectsSmudgeQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.smudge']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersPunchQuality: clamp(
      Number(
        data.filtersPunchQuality
        ?? state.filtersPunchQuality
        ?? data.expDefectsPunchQuality
        ?? SECTION_QUALITY_DEFAULTS['filters.punch']
      ),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    filtersVariationsScale: clamp(
      Number(
        data.filtersVariationsScale
        ?? state.filtersVariationsScale
        ?? data.expToneVariationsScale
        ?? SECTION_SCALE_DEFAULTS['filters.variations']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    filtersRibbonScale: clamp(
      Number(
        data.filtersRibbonScale
        ?? state.filtersRibbonScale
        ?? data.expToneRibbonScale
        ?? SECTION_SCALE_DEFAULTS['filters.ribbon']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    filtersRimScale: clamp(
      Number(
        data.filtersRimScale
        ?? state.filtersRimScale
        ?? data.expEdgeRimScale
        ?? SECTION_SCALE_DEFAULTS['filters.rim']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    filtersFuzzScale: clamp(
      Number(
        data.filtersFuzzScale
        ?? state.filtersFuzzScale
        ?? data.expEdgeFuzzScale
        ?? SECTION_SCALE_DEFAULTS['filters.fuzz']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    filtersCounterFillScale: clamp(
      Number(
        data.filtersCounterFillScale
        ?? state.filtersCounterFillScale
        ?? data.expEdgeCounterFillScale
        ?? SECTION_SCALE_DEFAULTS['filters.counterFill']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    filtersGrainScale: clamp(
      Number(
        data.filtersGrainScale
        ?? state.filtersGrainScale
        ?? data.expEdgeGrainScale
        ?? SECTION_SCALE_DEFAULTS['filters.grain']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    filtersWeightScale: clamp(
      Number(
        data.filtersWeightScale
        ?? state.filtersWeightScale
        ?? data.expEdgeWeightScale
        ?? SECTION_SCALE_DEFAULTS['filters.weight']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    filtersSpeckleScale: clamp(
      Number(
        data.filtersSpeckleScale
        ?? state.filtersSpeckleScale
        ?? data.expGrainSpeckleScale
        ?? SECTION_SCALE_DEFAULTS['filters.speckle']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    filtersDropoutsScale: clamp(
      Number(
        data.filtersDropoutsScale
        ?? state.filtersDropoutsScale
        ?? data.expGrainDropoutsScale
        ?? SECTION_SCALE_DEFAULTS['filters.dropouts']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    filtersSmudgeScale: clamp(
      Number(
        data.filtersSmudgeScale
        ?? state.filtersSmudgeScale
        ?? data.expDefectsSmudgeScale
        ?? SECTION_SCALE_DEFAULTS['filters.smudge']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    filtersPunchScale: clamp(
      Number(
        data.filtersPunchScale
        ?? state.filtersPunchScale
        ?? data.expDefectsPunchScale
        ?? SECTION_SCALE_DEFAULTS['filters.punch']
      ),
      EFFECT_SCALE_MIN,
      EFFECT_SCALE_MAX,
    ),
    wordWrap: data.wordWrap !== false,
    stageWidthFactor: sanitizedStageWidth,
    stageHeightFactor: sanitizedStageHeight,
    themeMode: ['auto', 'light', 'dark'].includes(data.themeMode)
      ? data.themeMode
      : (state.themeMode || 'auto'),
    darkPageInDarkMode: data.darkPageInDarkMode === true,
    lagAssistEnabled: data.lagAssistEnabled !== false,
    realTypewriterEnabled: normalizedTypewriter.enabled,
    realTypewriterBellSound: normalizedTypewriter.bellSound,
    realTypewriterBellVolume: normalizedTypewriter.bellVolume,
    realTypewriterBellLead: normalizedTypewriter.bellLead,
    realTypewriterStopSound: normalizedTypewriter.stopSound,
    realTypewriterStopEnabled: normalizedTypewriter.stopEnabled,
    realTypewriterBackspaceEnabled: normalizedTypewriter.backspaceEnabled,
    realTypewriterCaretLockEnabled: normalizedTypewriter.caretLockEnabled,
    hammerLock: normalizedTypewriter.caretLockEnabled,
    typewriterMarginRelease: false,
    lineSlantEnabled: storedLineSlant?.enabled !== false,
    lineSlantRangeDeg: normalizedLineSlantRange,
    pageFillColor: typeof data.pageFillColor === 'string' && data.pageFillColor.trim()
      ? data.pageFillColor
      : state.pageFillColor,
    glyphJitterEnabled: jitterBlock?.enabled === true
      ? true
      : jitterBlock?.enabled === false
        ? false
        : !!state.glyphJitterEnabled,
    glyphJitterAmountPct: sanitizedJitterAmount,
    glyphJitterFrequencyPct: sanitizedJitterFrequency,
    glyphJitterSeed: sanitizedJitterSeed,
    pageNumbering: sanitizePageNumberingSettings(
      data.pageNumbering,
      state.pageNumbering || createDefaultPageNumberingSettings(),
    ),
  });
  state.savedInkStyles = sanitizeSavedInkStyles(data.savedInkStyles);
  state.currentInkStyle = data.currentInkStyle
    ? sanitizeSavedInkStyle(data.currentInkStyle)
    : null;
  state.inkSectionOrder = normalizeInkSectionOrder(data.inkSectionOrder, state.inkSectionOrder);
  state.inkSubsectionOrder = normalizeInkSubsectionOrder(data.inkSubsectionOrder, state.inkSubsectionOrder);
  if (typeof data.documentId === 'string' && data.documentId.trim()) {
    state.documentId = data.documentId.trim();
  }
  if (typeof data.documentTitle === 'string') {
    state.documentTitle = normalizeDocumentTitle(data.documentTitle);
  }
  state.lineStepMu = Math.round(gridDiv * state.lineHeightFactor);
  if (data.fontName && typeof setActiveFontName === 'function') {
    setActiveFontName(data.fontName);
  }
  for (const p of state.pages) {
    if (!p) continue;
    p.dirtyAll = true;
  }
  document.body.classList.toggle('rulers-off', !state.showRulers);
  if (typeof scheduleMetricsUpdate === 'function') {
    scheduleMetricsUpdate(true);
  }
  return true;
}

export function createDocumentRecord({ id, title, data, createdAt, updatedAt } = {}, existingIds) {
  const now = Date.now();
  let safeId = typeof id === 'string' && id.trim() ? id.trim() : '';
  if (!safeId) {
    safeId = generateDocumentId(existingIds);
  } else if (existingIds instanceof Set) {
    if (existingIds.has(safeId)) {
      safeId = generateDocumentId(existingIds);
    } else {
      existingIds.add(safeId);
    }
  }
  const safeCreated = Number.isFinite(createdAt) ? createdAt : now;
  const safeUpdated = Number.isFinite(updatedAt) ? updatedAt : safeCreated;
  const safeData = data && typeof data === 'object' ? data : null;
  return {
    id: safeId,
    title: normalizeDocumentTitle(title),
    createdAt: safeCreated,
    updatedAt: safeUpdated,
    data: safeData,
  };
}

export { encodeDocumentDataForStorage, decodeDocumentDataFromStorage } from '../storage/jsonCompression.js';
