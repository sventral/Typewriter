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
  getDefaultInkSectionQuality,
  getDefaultInkSectionStrength,
} from '../config/inkEffectDefaultStyle.js';
import { TYPEWRITER_DEFAULTS, normalizeTypewriterSettings } from '../config/typewriterMode.js';
import { hydrateGlyphEntry, serializeGlyphEntry } from './glyphStack.js';
import { STAGE_HEIGHT_MAX, STAGE_HEIGHT_MIN, STAGE_WIDTH_MAX, STAGE_WIDTH_MIN } from '../layout/stageLayout.js';
import { encodeDocumentDataForStorage, decodeDocumentDataFromStorage } from '../storage/jsonCompression.js';
import { createDefaultPageNumberingSettings, sanitizePageNumberingSettings } from '../config/pageNumbering.js';
import { DEFAULT_INK, SUPPORTED_INKS, createDefaultInkOpacity, normalizeInkId } from '../config/inkPalette.js';
import {
  saveDocumentPayload,
  readDocumentPayload,
  pruneDocumentPayloads,
  estimatePayloadBytes,
} from '../storage/documentBlobStore.js';
const KNOWN_INK_SECTIONS = PRESET_INK_SECTION_ORDER.slice();
const EFFECT_QUALITY_DEFAULT = 100;
const EFFECT_QUALITY_MIN = 0;
const EFFECT_QUALITY_MAX = 200;
const METADATA_VERSION = 2;

const SECTION_STRENGTH_DEFAULTS = Object.freeze({
  expTone: getDefaultInkSectionStrength('expTone'),
  expEdge: getDefaultInkSectionStrength('expEdge'),
  expGrain: getDefaultInkSectionStrength('expGrain'),
  expDefects: getDefaultInkSectionStrength('expDefects'),
});

const SECTION_QUALITY_DEFAULTS = Object.freeze({
  expTone: getDefaultInkSectionQuality('expTone'),
  expEdge: getDefaultInkSectionQuality('expEdge'),
  expGrain: getDefaultInkSectionQuality('expGrain'),
  expDefects: getDefaultInkSectionQuality('expDefects'),
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

function sanitizeStyleSection(sectionValue) {
  if (!sectionValue || typeof sectionValue !== 'object') {
    return { strength: 0, config: null };
  }
  const strength = clamp(Number(sectionValue.strength ?? sectionValue.value ?? sectionValue.percent ?? 0), 0, 100);
  const configSource = sectionValue.config != null
    ? sectionValue.config
    : sectionValue.settings != null
      ? sectionValue.settings
      : ('strength' in sectionValue ? null : sectionValue);
  const config = configSource == null ? null : cloneInkStyleValue(configSource);
  return { strength, config };
}

function sanitizeSavedInkStyle(style, index = 0) {
  if (!style || typeof style !== 'object') {
    return {
      id: `style-${index}-${Date.now().toString(36)}`,
      name: `Style ${index + 1}`,
      overall: 100,
      sections: {},
      sectionOrder: KNOWN_INK_SECTIONS.slice(),
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
      sections[sectionId] = sanitizeStyleSection(sectionValue);
    }
  }
  KNOWN_INK_SECTIONS.forEach(sectionId => {
    if (sections[sectionId]) return;
    if (!style[sectionId] || typeof style[sectionId] !== 'object') return;
    sections[sectionId] = sanitizeStyleSection(style[sectionId]);
  });
  const sectionOrder = normalizeInkSectionOrder(style.sectionOrder);
  return {
    id,
    name,
    overall,
    sections,
    sectionOrder,
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
    },
    TYPEWRITER_DEFAULTS,
  );

  return {
    v: 30,
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
    expToneStrength: clamp(Number(state.expToneStrength ?? SECTION_STRENGTH_DEFAULTS.expTone), 0, 100),
    expEdgeStrength: clamp(Number(state.expEdgeStrength ?? SECTION_STRENGTH_DEFAULTS.expEdge), 0, 100),
    expGrainStrength: clamp(Number(state.expGrainStrength ?? SECTION_STRENGTH_DEFAULTS.expGrain), 0, 100),
    expDefectsStrength: clamp(Number(state.expDefectsStrength ?? SECTION_STRENGTH_DEFAULTS.expDefects), 0, 100),
    expToneQuality: clamp(Number(state.expToneQuality ?? SECTION_QUALITY_DEFAULTS.expTone), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    expEdgeQuality: clamp(Number(state.expEdgeQuality ?? SECTION_QUALITY_DEFAULTS.expEdge), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    expGrainQuality: clamp(Number(state.expGrainQuality ?? SECTION_QUALITY_DEFAULTS.expGrain), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    expDefectsQuality: clamp(Number(state.expDefectsQuality ?? SECTION_QUALITY_DEFAULTS.expDefects), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX),
    inkSectionOrder: normalizeInkSectionOrder(state.inkSectionOrder),
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
  if (!data || data.v < 2 || data.v > 30) return false;
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
    expToneStrength: clamp(
      Number(data.expToneStrength ?? state.expToneStrength ?? SECTION_STRENGTH_DEFAULTS.expTone),
      0,
      100,
    ),
    expEdgeStrength: clamp(
      Number(data.expEdgeStrength ?? state.expEdgeStrength ?? SECTION_STRENGTH_DEFAULTS.expEdge),
      0,
      100,
    ),
    expGrainStrength: clamp(
      Number(data.expGrainStrength ?? state.expGrainStrength ?? SECTION_STRENGTH_DEFAULTS.expGrain),
      0,
      100,
    ),
    expDefectsStrength: clamp(
      Number(data.expDefectsStrength ?? state.expDefectsStrength ?? SECTION_STRENGTH_DEFAULTS.expDefects),
      0,
      100,
    ),
    expToneQuality: clamp(
      Number(data.expToneQuality ?? state.expToneQuality ?? SECTION_QUALITY_DEFAULTS.expTone),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    expEdgeQuality: clamp(
      Number(data.expEdgeQuality ?? state.expEdgeQuality ?? SECTION_QUALITY_DEFAULTS.expEdge),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    expGrainQuality: clamp(
      Number(data.expGrainQuality ?? state.expGrainQuality ?? SECTION_QUALITY_DEFAULTS.expGrain),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
    ),
    expDefectsQuality: clamp(
      Number(data.expDefectsQuality ?? state.expDefectsQuality ?? SECTION_QUALITY_DEFAULTS.expDefects),
      EFFECT_QUALITY_MIN,
      EFFECT_QUALITY_MAX,
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

function getDocumentsKey(storageKey) {
  return `${storageKey}::documents.v1`;
}

function resolveStorage(options) {
  if (options && options.localStorage) return options.localStorage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

function estimateStoredBytes(value) {
  return estimatePayloadBytes(value);
}

async function hydrateDocumentsFromBlobStore(documents, idsToHydrate) {
  if (!Array.isArray(documents) || !documents.length) return;
  const targetIds = Array.isArray(idsToHydrate) ? idsToHydrate.filter(Boolean) : [];
  if (!targetIds.length) return;
  const docMap = new Map(documents.map((doc) => [doc.id, doc]));
  await Promise.all(targetIds.map(async (id) => {
    const doc = docMap.get(id);
    if (!doc || doc.data) return;
    try {
      const payload = await readDocumentPayload(id);
      if (!payload) return;
      doc.data = decodeDocumentDataFromStorage(payload);
    } catch (err) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('Typewriter: Failed to read stored document payload', err);
      }
    }
  }));
}

function normalizeDocumentEntry(base, seen) {
  const decodedData = decodeDocumentDataFromStorage(base.data);
  const record = createDocumentRecord({
    id: base.id,
    title: base.title,
    data: decodedData,
    createdAt: Number(base.createdAt),
    updatedAt: Number(base.updatedAt),
  }, seen);
  const dataSize = Number.isFinite(base.dataSize) ? base.dataSize : estimateStoredBytes(base.data);
  if (dataSize) {
    record.dataSize = dataSize;
  }
  return record;
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

export async function loadDocumentIndexFromStorage(storageKey, options = {}) {
  const storage = resolveStorage(options);
  const documents = [];
  const seen = new Set();
  let activeId = null;
  let parsed = null;
  if (storage) {
    try {
      parsed = JSON.parse(storage.getItem(getDocumentsKey(storageKey)));
    } catch {
      parsed = null;
    }
  }
  const docEntries = parsed && Array.isArray(parsed.documents) ? parsed.documents : [];
  docEntries.forEach((entry) => {
    const base = entry && typeof entry === 'object' ? entry : {};
    const record = normalizeDocumentEntry(base, seen);
    documents.push(record);
  });
  if (parsed && typeof parsed.activeId === 'string' && parsed.activeId.trim()) {
    activeId = parsed.activeId.trim();
  }
  if (activeId && !documents.some((doc) => doc.id === activeId)) {
    activeId = null;
  }
  if (!activeId && documents.length) {
    activeId = documents[0].id;
  }
  const hydrateMode = options && options.hydrateAll ? 'all' : 'active';
  const idsToHydrate = hydrateMode === 'all'
    ? documents.map((d) => d.id)
    : (activeId ? [activeId] : []);
  await hydrateDocumentsFromBlobStore(documents, idsToHydrate);
  return { documents, activeId };
}

export function migrateLegacyDocument(storageKey, options = {}) {
  const storage = resolveStorage(options);
  if (!storage) return null;
  let raw = null;
  try {
    raw = JSON.parse(storage.getItem(storageKey));
  } catch {}
  if (!raw || typeof raw !== 'object') return null;
  const migrated = createDocumentRecord({
    id: generateDocumentId(),
    title: typeof raw.documentTitle === 'string' ? raw.documentTitle : DEFAULT_DOCUMENT_TITLE,
    data: raw,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  try {
    storage.removeItem(storageKey);
  } catch {}
  return migrated;
}

export async function loadDocumentDataById(docId) {
  if (!docId) return null;
  try {
    const payload = await readDocumentPayload(docId);
    return decodeDocumentDataFromStorage(payload);
  } catch {
    return null;
  }
}

export async function persistDocuments(storageKey, docState, options = {}) {
  const storage = resolveStorage(options);
  const documents = Array.isArray(docState?.documents) ? docState.documents : [];
  const keepIds = new Set();
  const payloadDocs = [];
  const blobWrites = [];
  documents.forEach((doc) => {
    if (!doc || typeof doc !== 'object') return;
    const encoded = encodeDocumentDataForStorage(doc.data);
    const size = encoded ? estimateStoredBytes(encoded) : (Number(doc.dataSize) || 0);
    if (doc.id) {
      keepIds.add(doc.id);
    }
    payloadDocs.push({
      id: doc.id,
      title: doc.title,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      dataSize: size || 0,
      hasData: !!encoded || !!doc.dataSize,
    });
    if (doc.id && encoded) {
      blobWrites.push(saveDocumentPayload(doc.id, encoded));
    }
  });
  const payload = {
    version: METADATA_VERSION,
    activeId: docState?.activeId || null,
    documents: payloadDocs,
  };
  if (storage && !options.skipMetadataWrite) {
    try {
      storage.setItem(getDocumentsKey(storageKey), JSON.stringify(payload));
      storage.removeItem(storageKey);
    } catch (err) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('Typewriter: Failed to persist document metadata – storage quota may be exhausted.', err);
      }
      if (options.onSaveError) {
        options.onSaveError(err);
      }
    }
  }
  try {
    await Promise.all(blobWrites);
  } catch (err) {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('Typewriter: Failed to persist document payloads', err);
    }
    if (options.onSaveError) {
      options.onSaveError(err);
    }
  }
  if (keepIds.size || documents.length === 0) {
    try {
      await pruneDocumentPayloads(keepIds);
    } catch (err) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('Typewriter: Failed to prune stale document payloads', err);
      }
    }
  }
}

export function estimateDocumentDataBytes(data, options = {}) {
  const encoded = encodeDocumentDataForStorage(data, options);
  return estimateStoredBytes(encoded);
}
