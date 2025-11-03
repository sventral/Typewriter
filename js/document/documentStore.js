import { clamp } from '../utils/math.js';
import {
  GLYPH_JITTER_DEFAULTS,
  normalizeGlyphJitterAmount,
  normalizeGlyphJitterFrequency,
  normalizeGlyphJitterSeed,
  cloneGlyphJitterRange,
} from '../config/glyphJitterConfig.js';
import { INK_BLUR, INK_INTENSITY } from '../config/inkConfig.js';
import { EDGE_BLEED, GRAIN_CFG } from '../config/legacyInkEffects.js';

const resolveIntensityBounds = (key) => {
  const source = INK_INTENSITY && typeof INK_INTENSITY === 'object' ? INK_INTENSITY[key] : null;
  const min = Number.isFinite(source?.minPct) ? source.minPct : 0;
  const max = Number.isFinite(source?.maxPct) ? Math.max(source.maxPct, min) : Math.max(200, min);
  const value = Number.isFinite(source?.defaultPct) ? source.defaultPct : 100;
  return {
    min,
    max,
    defaultPct: clamp(value, min, max),
  };
};

const CENTER_THICKEN_BOUNDS = resolveIntensityBounds('centerThicken');
const EDGE_THIN_BOUNDS = resolveIntensityBounds('edgeThin');

const KNOWN_INK_SECTIONS = ['fill', 'blur', 'texture', 'fuzz', 'bleed', 'grain'];

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
      sections[sectionId] = sanitizeStyleSection(sectionValue);
    }
  } else {
    KNOWN_INK_SECTIONS.forEach(sectionId => {
      if (sections[sectionId]) return;
      if (!style[sectionId] || typeof style[sectionId] !== 'object') return;
      sections[sectionId] = sanitizeStyleSection(style[sectionId]);
    });
  }
  const sectionOrder = normalizeInkSectionOrder(style.sectionOrder);
  return { id, name, overall, sections, sectionOrder };
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
              stack.map((s) => ({
                ch: typeof s?.char === 'string' ? s.char : '',
                ink: s?.ink || 'b',
              })),
            ]);
          }
          rows.push([rmu, cols]);
        }
        return { rows };
      })
    : [];
  const glyphJitterAmount = normalizeGlyphJitterAmount(state.glyphJitterAmountPct, GLYPH_JITTER_DEFAULTS.amountPct);
  const glyphJitterFrequency = normalizeGlyphJitterFrequency(state.glyphJitterFrequencyPct, GLYPH_JITTER_DEFAULTS.frequencyPct);
  const glyphJitterSeed = normalizeGlyphJitterSeed(state.glyphJitterSeed, GLYPH_JITTER_DEFAULTS.seed);

  return {
    v: 25,
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
    inkFillStrength: clamp(Number(state.inkFillStrength ?? 100), 0, 100),
    centerThickenPct: clamp(
      Number(state.centerThickenPct ?? CENTER_THICKEN_BOUNDS.defaultPct),
      CENTER_THICKEN_BOUNDS.min,
      CENTER_THICKEN_BOUNDS.max,
    ),
    edgeThinPct: clamp(
      Number(state.edgeThinPct ?? EDGE_THIN_BOUNDS.defaultPct),
      EDGE_THIN_BOUNDS.min,
      EDGE_THIN_BOUNDS.max,
    ),
    inkBlurStrength: clamp(
      Number(state.inkBlurStrength ?? (INK_BLUR.enabled === false ? 0 : 100)),
      0,
      100,
    ),
    inkTextureStrength: clamp(Number(state.inkTextureStrength ?? 100), 0, 100),
    edgeBleedStrength: clamp(
      Number(state.edgeBleedStrength ?? (EDGE_BLEED.enabled === false ? 0 : 100)),
      0,
      100,
    ),
    edgeFuzzStrength: clamp(Number(state.edgeFuzzStrength ?? 100), 0, 100),
    grainPct: clamp(
      Number(state.grainPct ?? (GRAIN_CFG.enabled === false ? 0 : 100)),
      0,
      100,
    ),
    grainSeed: state.grainSeed >>> 0,
    altSeed: state.altSeed >>> 0,
    inkSectionOrder: normalizeInkSectionOrder(state.inkSectionOrder),
    wordWrap: state.wordWrap,
    stageWidthFactor: state.stageWidthFactor,
    stageHeightFactor: state.stageHeightFactor,
    themeMode: state.themeMode || 'auto',
    darkPageInDarkMode: !!state.darkPageInDarkMode,
    pageFillColor: state.pageFillColor,
    savedInkStyles: sanitizeSavedInkStyles(state.savedInkStyles),
    glyphJitter: {
      enabled: !!state.glyphJitterEnabled,
      amountPct: cloneGlyphJitterRange(glyphJitterAmount),
      frequencyPct: cloneGlyphJitterRange(glyphJitterFrequency),
      seed: glyphJitterSeed,
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
  } = context || {};

  if (!state || !app) return false;
  const gridDiv = typeof getGridDiv === 'function' ? getGridDiv() : 0;
  if (!data || data.v < 2 || data.v > 25) return false;
  state.pages = [];
  if (app.stageInner) {
    app.stageInner.innerHTML = '';
  }
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
    mb.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
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
    state.pages.push(page);
    if (Array.isArray(pg?.rows)) {
      for (const [rmu, cols] of pg.rows) {
        const rowMap = new Map();
        if (Array.isArray(cols)) {
          for (const [c, stackArr] of cols) {
            rowMap.set(c, Array.isArray(stackArr)
              ? stackArr.map((s) => ({ char: s?.ch, ink: s?.ink || 'b' }))
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
    mb.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
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
      state.pages.push(page);
    }
  }

  let inferredCols = data.colsAcross;
  const cpiVal = data.cpi ?? null;
  if (cpiVal && typeof computeColsFromCpi === 'function') {
    inferredCols = computeColsFromCpi(cpiVal).cols2;
  }
  const inkOpacity = (data.inkOpacity && typeof data.inkOpacity === 'object')
    ? {
        b: clamp(Number(data.inkOpacity.b ?? 100), 0, 100),
        r: clamp(Number(data.inkOpacity.r ?? 100), 0, 100),
        w: clamp(Number(data.inkOpacity.w ?? 100), 0, 100),
      }
    : { b: 100, r: 100, w: 100 };
  const storedInkWidth = Number(data.inkWidthPct);
  const sanitizedInkWidth = Number.isFinite(storedInkWidth)
    ? clamp(Math.round(storedInkWidth), 1, 150)
    : 95;
  const storedStageWidth = Number(data.stageWidthFactor);
  const storedStageHeight = Number(data.stageHeightFactor);
  const sanitizedStageWidth = Number.isFinite(storedStageWidth)
    ? clamp(storedStageWidth, 1, 5)
    : state.stageWidthFactor;
  const sanitizedStageHeight = Number.isFinite(storedStageHeight)
    ? clamp(storedStageHeight, 1, 5)
    : state.stageHeightFactor;
  const jitterBlock = data.glyphJitter && typeof data.glyphJitter === 'object'
    ? data.glyphJitter
    : null;
  const fallbackAmount = state.glyphJitterAmountPct || GLYPH_JITTER_DEFAULTS.amountPct;
  const fallbackFrequency = state.glyphJitterFrequencyPct || GLYPH_JITTER_DEFAULTS.frequencyPct;
  const sanitizedJitterAmount = normalizeGlyphJitterAmount(jitterBlock?.amountPct, fallbackAmount);
  const sanitizedJitterFrequency = normalizeGlyphJitterFrequency(jitterBlock?.frequencyPct, fallbackFrequency);
  const sanitizedJitterSeed = normalizeGlyphJitterSeed(jitterBlock?.seed, state.glyphJitterSeed ?? GLYPH_JITTER_DEFAULTS.seed);

  Object.assign(state, {
    marginL: data.margins?.L ?? state.marginL,
    marginR: data.margins?.R ?? state.marginR,
    marginTop: data.margins?.T ?? state.marginTop,
    marginBottom: data.margins?.B ?? state.marginBottom,
    caret: data.caret
      ? { page: data.caret.page || 0, rowMu: data.caret.rowMu || 0, col: data.caret.col || 0 }
      : state.caret,
    ink: ['b', 'r', 'w'].includes(data.ink) ? data.ink : 'b',
    showRulers: data.showRulers !== false,
    showMarginBox: !!data.showMarginBox,
    cpi: cpiVal || 10,
    colsAcross: inferredCols ?? state.colsAcross,
    inkWidthPct: sanitizedInkWidth,
    inkOpacity,
    lineHeightFactor: [1, 1.5, 2, 2.5, 3].includes(data.lineHeightFactor)
      ? data.lineHeightFactor
      : 1.5,
    zoom: typeof data.zoom === 'number' && data.zoom >= 0.5 && data.zoom <= 4 ? data.zoom : 1.0,
    effectsOverallStrength: clamp(Number(data.effectsOverallStrength ?? state.effectsOverallStrength ?? 100), 0, 100),
    inkFillStrength: clamp(
      Number(data.inkFillStrength ?? state.inkFillStrength ?? 100),
      0,
      100,
    ),
    centerThickenPct: clamp(
      Number(data.centerThickenPct ?? state.centerThickenPct ?? CENTER_THICKEN_BOUNDS.defaultPct),
      CENTER_THICKEN_BOUNDS.min,
      CENTER_THICKEN_BOUNDS.max,
    ),
    edgeThinPct: clamp(
      Number(data.edgeThinPct ?? state.edgeThinPct ?? EDGE_THIN_BOUNDS.defaultPct),
      EDGE_THIN_BOUNDS.min,
      EDGE_THIN_BOUNDS.max,
    ),
    inkBlurStrength: clamp(
      Number(
        data.inkBlurStrength
          ?? state.inkBlurStrength
          ?? (INK_BLUR.enabled === false ? 0 : 100)
      ),
      0,
      100,
    ),
    inkTextureStrength: clamp(Number(data.inkTextureStrength ?? state.inkTextureStrength ?? 100), 0, 100),
    edgeBleedStrength: clamp(
      Number(
        data.edgeBleedStrength
          ?? state.edgeBleedStrength
          ?? (EDGE_BLEED.enabled === false ? 0 : 100)
      ),
      0,
      100,
    ),
    edgeFuzzStrength: clamp(Number(data.edgeFuzzStrength ?? state.edgeFuzzStrength ?? 100), 0, 100),
    grainPct: clamp(
      Number(
        data.grainPct
          ?? state.grainPct
          ?? (GRAIN_CFG.enabled === false ? 0 : 100)
      ),
      0,
      100,
    ),
    grainSeed: (data.grainSeed >>> 0) || ((Math.random() * 0xFFFFFFFF) >>> 0),
    altSeed:
      (data.altSeed >>> 0) || (((data.grainSeed >>> 0) ^ 0xA5A5A5A5) >>> 0) || ((Math.random() * 0xFFFFFFFF) >>> 0),
    wordWrap: data.wordWrap !== false,
    stageWidthFactor: sanitizedStageWidth,
    stageHeightFactor: sanitizedStageHeight,
    themeMode: ['auto', 'light', 'dark'].includes(data.themeMode)
      ? data.themeMode
      : (state.themeMode || 'auto'),
    darkPageInDarkMode: data.darkPageInDarkMode === true,
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
  });
  state.savedInkStyles = sanitizeSavedInkStyles(data.savedInkStyles);
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

export function loadDocumentIndexFromStorage(storageKey, options = {}) {
  const storage = resolveStorage(options);
  const documents = [];
  const seen = new Set();
  let activeId = null;
  if (!storage) {
    return { documents, activeId };
  }
  try {
    const parsed = JSON.parse(storage.getItem(getDocumentsKey(storageKey)));
    if (parsed && Array.isArray(parsed.documents)) {
      parsed.documents.forEach((entry) => {
        const base = entry && typeof entry === 'object' ? entry : {};
        const record = createDocumentRecord({
          id: base.id,
          title: base.title,
          data: base.data && typeof base.data === 'object' ? base.data : null,
          createdAt: Number(base.createdAt),
          updatedAt: Number(base.updatedAt),
        }, seen);
        documents.push(record);
      });
    }
    if (parsed && typeof parsed.activeId === 'string' && parsed.activeId.trim()) {
      activeId = parsed.activeId.trim();
    }
  } catch {}
  if (activeId && !documents.some((doc) => doc.id === activeId)) {
    activeId = null;
  }
  if (!activeId && documents.length) {
    activeId = documents[0].id;
  }
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

export function persistDocuments(storageKey, docState, options = {}) {
  const storage = resolveStorage(options);
  if (!storage) return;
  const documents = Array.isArray(docState?.documents) ? docState.documents : [];
  const payload = {
    version: 1,
    activeId: docState?.activeId || null,
    documents: documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      data: doc.data,
    })),
  };
  try {
    storage.setItem(getDocumentsKey(storageKey), JSON.stringify(payload));
    storage.removeItem(storageKey);
  } catch {}
}
