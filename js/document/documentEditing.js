import { clamp } from '../utils/math.js';
import { recalcMetrics as recalcMetricsForContext } from '../config/metrics.js';
import {
  DEFAULT_DOCUMENT_TITLE,
  normalizeDocumentTitle,
  serializeDocumentState,
  deserializeDocumentState,
  generateDocumentId,
} from './documentStore.js';

export function createDocumentEditingController(context) {
  const {
    app,
    state,
    getGridDiv,
    getGridHeight,
    getCharWidth,
    getAsc,
    getDesc,
    getBaselineOffsetCell,
    getActiveFontName,
    setActiveFontName,
    touchedPages,
    getFreezeVirtual,
    setFreezeVirtual,
    requestVirtualization,
    positionRulers,
    saveStateDebounced,
    saveStateNow,
    renderMargins,
    beginBatch,
    endBatch,
    addPage,
    makePageRecord,
    prepareCanvas,
    configureCanvasContext,
    resetPagesBlankPreserveSettings,
    metricsOptions,
    rebuildAllAtlases,
    setPaperOffset,
    applyDefaultMargins,
    computeColsFromCpi,
    rendererHooks,
    layoutZoomFactor,
    requestHammerNudge,
    isZooming,
  } = context;

  const recalcMetrics = (face) => recalcMetricsForContext(face, metricsOptions || {});

  function markRowAsDirty(page, rowMu) {
    if (rendererHooks.markRowAsDirty) {
      rendererHooks.markRowAsDirty(page, rowMu);
    }
  }

  function schedulePaint(page) {
    if (rendererHooks.schedulePaint) {
      rendererHooks.schedulePaint(page);
    }
  }

  function touchPage(page) {
    touchedPages.add(page);
  }

  function ensureRowExists(page, rowMu) {
    let r = page.grid.get(rowMu);
    if (!r) {
      r = new Map();
      page.grid.set(rowMu, r);
    }
    return r;
  }

  function writeRunToRow(page, rowMu, startCol, text, ink) {
    if (!text || !text.length) return;
    const rowMap = ensureRowExists(page, rowMu);
    for (let i = 0; i < text.length; i++) {
      const col = startCol + i;
      let stack = rowMap.get(col);
      if (!stack) {
        stack = [];
        rowMap.set(col, stack);
      }
      stack.push({ char: text[i], ink: ink || 'b' });
    }
    markRowAsDirty(page, rowMu);
  }

  function getCurrentBounds() {
    const charWidth = getCharWidth();
    const gridDiv = getGridDiv();
    const L = Math.ceil(state.marginL / charWidth);
    const Rstrict = Math.floor((state.marginR - 1) / charWidth);
    const pageMaxStart = Math.ceil(app.PAGE_W / charWidth) - 1;
    const Tmu = Math.ceil((state.marginTop + getAsc()) / getGridHeight());
    const Bmu = Math.floor((app.PAGE_H - state.marginBottom - getDesc()) / getGridHeight());
    const clamp2 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const allowEdgeOverflow = state.marginR >= app.PAGE_W - 0.5;
    const Lc = clamp2(L, 0, pageMaxStart);
    const RcStrict = clamp2(Rstrict, 0, pageMaxStart);
    const Rc = allowEdgeOverflow ? pageMaxStart : RcStrict;
    return { L: Math.min(Lc, Rc), R: Math.max(Lc, Rc), Tmu, Bmu, gridDiv };
  }

  function snapRowMuToStep(rowMu, bounds) {
    const step = state.lineStepMu;
    const k = Math.round((rowMu - bounds.Tmu) / step);
    return clamp(bounds.Tmu + k * step, bounds.Tmu, bounds.Bmu);
  }

  function baseCaretHeightPx() {
    return getGridDiv() * getGridHeight();
  }

  function updateCaretPosition() {
    const p = state.pages[state.caret.page];
    if (!p) return;
    const layoutScale = layoutZoomFactor();
    const caretLeft = state.caret.col * getCharWidth() * layoutScale;
    const caretTop = (state.caret.rowMu * getGridHeight() - getBaselineOffsetCell()) * layoutScale;
    const caretHeight = baseCaretHeightPx() * layoutScale;
    app.caretEl.style.left = caretLeft + 'px';
    app.caretEl.style.top = caretTop + 'px';
    app.caretEl.style.height = caretHeight + 'px';
    const caretWidth = Math.max(1, Math.round(2 * layoutScale));
    app.caretEl.style.width = caretWidth + 'px';
    if (app.caretEl.parentNode !== p.pageEl) {
      app.caretEl.remove();
      p.pageEl.appendChild(app.caretEl);
    }
    if (!isZooming()) requestHammerNudge();
    requestVirtualization();
  }

  function clampCaretToBounds() {
    const bounds = getCurrentBounds();
    state.caret.col = clamp(state.caret.col, bounds.L, bounds.R);
    state.caret.rowMu = snapRowMuToStep(clamp(state.caret.rowMu, bounds.Tmu, bounds.Bmu), bounds);
    updateCaretPosition();
  }

  function overtypeCharacter(page, rowMu, col, ch, ink) {
    const rowMap = ensureRowExists(page, rowMu);
    let stack = rowMap.get(col);
    if (!stack) {
      stack = [];
      rowMap.set(col, stack);
    }
    stack.push({ char: ch, ink });
    markRowAsDirty(page, rowMu);
  }

  function eraseCharacters(page, rowMu, startCol, count) {
    let changed = false;
    const rowMap = page.grid.get(rowMu);
    if (!rowMap) return;
    for (let i = 0; i < count; i++) {
      const col = startCol + i;
      const stack = rowMap.get(col);
      if (stack && stack.length) {
        stack.pop();
        changed = true;
        if (!stack.length) rowMap.delete(col);
      }
    }
    if (changed) markRowAsDirty(page, rowMu);
  }

  function insertStringFast(s) {
    const text = (s || '').replace(/\r\n?/g, '\n');
    const bounds = getCurrentBounds();

    let pageIndex = state.caret.page;
    let page = state.pages[pageIndex] || addPage();
    let rowMu = state.caret.rowMu;
    let startCol = state.caret.col;
    const ink = state.ink;

    const prevFreeze = getFreezeVirtual();
    setFreezeVirtual(true);

    const newline = () => {
      startCol = bounds.L;
      rowMu += state.lineStepMu;
      if (rowMu > bounds.Bmu) {
        pageIndex++;
        page = state.pages[pageIndex] || addPage();
        rowMu = bounds.Tmu;
      }
    };

    let buf = '';
    let lastSpacePos = -1;

    const flush = () => {
      if (buf.length) {
        writeRunToRow(page, rowMu, startCol, buf, ink);
        startCol += buf.length;
        buf = '';
        lastSpacePos = -1;
      }
    };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === '\n') {
        flush();
        newline();
        continue;
      }

      buf += ch;
      if (/\s/.test(ch)) lastSpacePos = buf.length - 1;

      const colForCh = startCol + buf.length - 1;

      if (colForCh > bounds.R) {
        if (state.wordWrap && lastSpacePos >= 0) {
          const head = buf.slice(0, lastSpacePos);
          const tail = buf.slice(lastSpacePos + 1);
          if (head.length) writeRunToRow(page, rowMu, startCol, head, ink);
          newline();
          startCol = bounds.L;
          buf = tail;
          lastSpacePos = -1;
        } else {
          const head = buf.slice(0, buf.length - 1);
          if (head.length) writeRunToRow(page, rowMu, startCol, head, ink);
          newline();
          startCol = bounds.L;
          buf = ch;
          lastSpacePos = /\s/.test(ch) ? 0 : -1;
        }
      }
    }
    flush();

    state.caret = { page: pageIndex, rowMu, col: startCol };

    setFreezeVirtual(prevFreeze);
    updateCaretPosition();
    positionRulers();
    requestVirtualization();
    saveStateDebounced();
  }

  function advanceCaret() {
    const bounds = getCurrentBounds();
    state.caret.col++;
    if (state.caret.col > bounds.R) {
      const moved = attemptWordWrapAtOverflow(state.caret.rowMu, state.caret.page, bounds, true);
      if (!moved) {
        state.caret.col = bounds.L;
        state.caret.rowMu += state.lineStepMu;
        if (state.caret.rowMu > bounds.Bmu) {
          state.caret.page++;
          const np = state.pages[state.caret.page] || addPage();
          app.activePageIndex = np.index;
          requestVirtualization();
          state.caret.rowMu = bounds.Tmu;
          state.caret.col = bounds.L;
          positionRulers();
        }
      }
    }
    updateCaretPosition();
  }

  function handleNewline() {
    const bounds = getCurrentBounds();
    state.caret.col = bounds.L;
    state.caret.rowMu += state.lineStepMu;
    if (state.caret.rowMu > bounds.Bmu) {
      state.caret.page++;
      const np = state.pages[state.caret.page] || addPage();
      app.activePageIndex = np.index;
      requestVirtualization();
      state.caret.rowMu = bounds.Tmu;
      state.caret.col = bounds.L;
      positionRulers();
    }
    updateCaretPosition();
  }

  function handleBackspace() {
    const bounds = getCurrentBounds();
    if (state.caret.col > bounds.L) {
      state.caret.col--;
    } else if (state.caret.rowMu > bounds.Tmu) {
      state.caret.rowMu -= state.lineStepMu;
      state.caret.col = bounds.R;
    } else if (state.caret.page > 0) {
      state.caret.page--;
      app.activePageIndex = state.caret.page;
      state.caret.rowMu = bounds.Bmu;
      state.caret.col = bounds.R;
      positionRulers();
    }
    updateCaretPosition();
  }

  function insertText(text) {
    const normalized = (text || '').replace(/\r\n?/g, '\n');
    beginBatch();
    for (const ch of normalized) {
      if (ch === '\n') {
        handleNewline();
      } else {
        const page = state.pages[state.caret.page] || addPage();
        overtypeCharacter(page, state.caret.rowMu, state.caret.col, ch, state.ink);
        advanceCaret();
      }
    }
    saveStateDebounced();
    endBatch();
  }

  function flattenGridToStreamWithCaret() {
    const tokens = [];
    let linear = 0;
    let caretIndex = null;
    function maybeSetCaret2(pageIdx, rowMu, colStart, emittedBefore) {
      if (caretIndex != null) return;
      if (state.caret.page !== pageIdx || state.caret.rowMu !== rowMu) return;
      const offset = Math.max(0, state.caret.col - colStart);
      caretIndex = linear + emittedBefore + offset;
    }
    for (let p = 0; p < state.pages.length; p++) {
      const page = state.pages[p];
      if (!page || page.grid.size === 0) continue;
      const rows = Array.from(page.grid.keys()).sort((a, b) => a - b);
      for (let ri = 0; ri < rows.length; ri++) {
        const rmu = rows[ri];
        const rowMap = page.grid.get(rmu);
        if (!rowMap || rowMap.size === 0) {
          if (p === state.caret.page && rmu === state.caret.rowMu && caretIndex == null) caretIndex = linear;
          tokens.push({ ch: '\n' });
          continue;
        }
        let minCol = Infinity;
        let maxCol = -1;
        for (const c of rowMap.keys()) {
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
        }
        if (!isFinite(minCol) || maxCol < 0) {
          tokens.push({ ch: '\n' });
          continue;
        }
        maybeSetCaret2(p, rmu, minCol, 0);
        for (let c = minCol; c <= maxCol; c++) {
          const stack = rowMap.get(c);
          if (!stack || stack.length === 0) {
            tokens.push({ ch: ' ' });
            linear++;
            continue;
          }
          tokens.push({ layers: stack.map(s => ({ ch: s.char, ink: s.ink || 'b' })) });
          linear++;
        }
        tokens.push({ ch: '\n' });
      }
    }
    if (caretIndex == null) caretIndex = linear;
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.ch === '\n' || t.layers || t.ch === ' ') {
        out.push(t);
      }
    }
    while (out.length && out[out.length - 1].ch === '\n') out.pop();
    return { tokens: out, caretIndex };
  }

  function attemptWordWrapAtOverflow(prevRowMu, pageIndex, bounds, mutateCaret = true) {
    if (!state.wordWrap) return false;
    const page = state.pages[pageIndex] || addPage();
    const rowMap = page.grid.get(prevRowMu);
    if (!rowMap) return false;

    let minCol = Infinity;
    let maxCol = -1;
    for (const c of rowMap.keys()) {
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
    }
    if (!isFinite(minCol) || maxCol < bounds.L) return false;

    let splitAt = -1;
    for (let c = Math.min(maxCol, bounds.R); c >= bounds.L; c--) {
      const st = rowMap.get(c);
      if (!st || !st.length) continue;
      const ch = st[st.length - 1].char;
      if (/\s/.test(ch)) {
        splitAt = c;
        break;
      }
    }
    if (splitAt < bounds.L) return false;

    const start = splitAt + 1;
    if (start > maxCol) return false;

    let destPageIndex = pageIndex;
    let destRowMu = prevRowMu + state.lineStepMu;
    if (destRowMu > bounds.Bmu) {
      destPageIndex++;
      const np = state.pages[destPageIndex] || addPage();
      app.activePageIndex = np.index;
      requestVirtualization();
      destRowMu = bounds.Tmu;
      positionRulers();
    }
    const destPage = state.pages[destPageIndex] || addPage();
    const destRowMap = ensureRowExists(destPage, destRowMu);

    let destCol = bounds.L;
    for (let c = start; c <= maxCol; c++) {
      const stack = rowMap.get(c);
      if (!stack || !stack.length) continue;
      let dstack = destRowMap.get(destCol);
      if (!dstack) {
        dstack = [];
        destRowMap.set(destCol, dstack);
      }
      for (const s of stack) {
        dstack.push({ char: s.char, ink: s.ink || 'b' });
      }
      rowMap.delete(c);
      destCol++;
    }

    markRowAsDirty(page, prevRowMu);
    markRowAsDirty(destPage, destRowMu);

    const nextPos = { pageIndex: destPageIndex, rowMu: destRowMu, col: destCol };
    if (mutateCaret) {
      state.caret.page = nextPos.pageIndex;
      state.caret.rowMu = nextPos.rowMu;
      state.caret.col = nextPos.col;
    }
    return nextPos;
  }

  function typeStreamIntoGrid(tokens, caretIndex) {
    const bounds = getCurrentBounds();
    let pageIndex = 0;
    let rowMu = bounds.Tmu;
    let col = bounds.L;
    let page = state.pages[0] || addPage();
    let pos = 0;
    let caretSet = false;

    const newline = () => {
      col = bounds.L;
      rowMu += state.lineStepMu;
      if (rowMu > bounds.Bmu) {
        pageIndex++;
        page = state.pages[pageIndex] || addPage();
        app.activePageIndex = page.index;
        requestVirtualization();
        rowMu = bounds.Tmu;
        col = bounds.L;
        positionRulers();
      }
    };
    const advance = () => {
      col++;
      if (col > bounds.R) {
        const moved = attemptWordWrapAtOverflow(rowMu, pageIndex, bounds, false);
        if (moved) {
          pageIndex = moved.pageIndex;
          rowMu = moved.rowMu;
          col = moved.col;
          page = state.pages[pageIndex] || addPage();
        } else {
          newline();
        }
      }
    };
    const maybeSetCaret = () => {
      if (!caretSet && pos === caretIndex) {
        state.caret = { page: pageIndex, rowMu, col };
        caretSet = true;
      }
    };

    for (const t of tokens) {
      if (t.ch === '\n') {
        newline();
        continue;
      }
      if (col > bounds.R) {
        const moved = attemptWordWrapAtOverflow(rowMu, pageIndex, bounds, false);
        if (moved) {
          pageIndex = moved.pageIndex;
          rowMu = moved.rowMu;
          col = moved.col;
          page = state.pages[pageIndex] || addPage();
        } else {
          newline();
        }
      }
      maybeSetCaret();
      if (t.layers) {
        for (const L of t.layers) {
          overtypeCharacter(page, rowMu, col, L.ch, L.ink || 'b');
        }
      } else if (t.ch !== ' ') {
        overtypeCharacter(page, rowMu, col, t.ch, t.ink || 'b');
      }
      advance();
      pos++;
    }
    if (!caretSet) {
      state.caret = { page: pageIndex, rowMu, col };
    }
  }

  function rewrapDocumentToCurrentBounds() {
    beginBatch();
    const { tokens, caretIndex } = flattenGridToStreamWithCaret();
    resetPagesBlankPreserveSettings();
    typeStreamIntoGrid(tokens, caretIndex);
    for (const p of state.pages) {
      p.dirtyAll = true;
    }
    renderMargins();
    clampCaretToBounds();
    updateCaretPosition();
    positionRulers();
    requestVirtualization();
    saveStateDebounced();
    endBatch();
  }

  function serializeState() {
    return serializeDocumentState(state, { getActiveFontName });
  }

  function deserializeState(data) {
    return deserializeDocumentState(data, {
      state,
      app,
      getGridDiv,
      prepareCanvas,
      makePageRecord,
      computeColsFromCpi,
      setActiveFontName,
    });
  }

  function createNewDocument(options = {}) {
    const { documentId, documentTitle, skipSave } = options || {};
    let resolvedId = null;
    if (typeof documentId === 'string' && documentId.trim()) {
      resolvedId = documentId.trim();
    } else if (typeof state.documentId === 'string' && state.documentId.trim()) {
      resolvedId = state.documentId.trim();
    } else {
      resolvedId = generateDocumentId();
    }
    state.documentId = resolvedId;
    state.documentTitle = normalizeDocumentTitle(documentTitle ?? state.documentTitle);
    beginBatch();
    state.paperOffset = { x: 0, y: 0 };
    setPaperOffset(0, 0);
    state.pages = [];
    state.caret = { page: 0, rowMu: 0, col: 0 };
    state.grainSeed = ((Math.random() * 0xFFFFFFFF) >>> 0);
    state.altSeed = ((Math.random() * 0xFFFFFFFF) >>> 0);
    state.savedInkStyles = [];
    app.stageInner.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = '0';
    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.height = app.PAGE_H + 'px';
    const cv = document.createElement('canvas');
    prepareCanvas(cv);
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
    const page = makePageRecord(0, wrap, pageEl, cv, mb);
    page.canvas.style.visibility = 'hidden';
    state.pages.push(page);
    applyDefaultMargins();
    recalcMetrics(getActiveFontName());
    rebuildAllAtlases();
    for (const p of state.pages) {
      p.grainCanvas = null;
      p.grainForSize = { w: 0, h: 0 };
      configureCanvasContext(p.ctx);
      configureCanvasContext(p.backCtx);
      p.dirtyAll = true;
      schedulePaint(p);
    }
    renderMargins();
    clampCaretToBounds();
    updateCaretPosition();
    document.body.classList.toggle('rulers-off', !state.showRulers);
    positionRulers();
    requestVirtualization();
    if (!skipSave) saveStateNow();
    endBatch();
    return state.documentId;
  }

  function setInk(ink) {
    state.ink = ink;
    app.inkBlackBtn.dataset.active = String(ink === 'b');
    app.inkRedBtn.dataset.active = String(ink === 'r');
    app.inkWhiteBtn.dataset.active = String(ink === 'w');
    saveStateDebounced();
  }

  return {
    touchPage,
    getCurrentBounds,
    snapRowMuToStep,
    clampCaretToBounds,
    updateCaretPosition,
    advanceCaret,
    handleNewline,
    handleBackspace,
    insertText,
    insertTextFast: insertStringFast,
    overtypeCharacter,
    eraseCharacters,
    rewrapDocumentToCurrentBounds,
    serializeState,
    deserializeState,
    setInk,
    createNewDocument,
  };
}
