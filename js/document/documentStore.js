import { clamp } from '../utils/math.js';

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
  return {
    v: 22,
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
    grainPct: state.grainPct,
    grainSeed: state.grainSeed >>> 0,
    altSeed: state.altSeed >>> 0,
    wordWrap: state.wordWrap,
    stageWidthFactor: state.stageWidthFactor,
    stageHeightFactor: state.stageHeightFactor,
    themeMode: state.themeMode || 'auto',
    darkPageInDarkMode: !!state.darkPageInDarkMode,
    pageFillColor: state.pageFillColor,
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
  if (!data || data.v < 2 || data.v > 22) return false;
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
    : 84;
  const storedStageWidth = Number(data.stageWidthFactor);
  const storedStageHeight = Number(data.stageHeightFactor);
  const sanitizedStageWidth = Number.isFinite(storedStageWidth)
    ? clamp(storedStageWidth, 1, 5)
    : state.stageWidthFactor;
  const sanitizedStageHeight = Number.isFinite(storedStageHeight)
    ? clamp(storedStageHeight, 1, 5)
    : state.stageHeightFactor;
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
      : 1,
    zoom: typeof data.zoom === 'number' && data.zoom >= 0.5 && data.zoom <= 4 ? data.zoom : 1.0,
    grainPct: clamp(Number(data.grainPct ?? 0), 0, 100),
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
  });
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
