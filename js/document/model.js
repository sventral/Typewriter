import { clamp } from '../utils/math.js';

export function createDocumentModel({
  app,
  state,
  getCharWidth,
  getGridHeight,
  getAsc,
  getDesc,
  markRowAsDirty,
  prepareCanvas,
  configureCanvasContext,
  handlePageClick,
  requestVirtualization,
  renderMargins,
  positionRulers,
  updateCaretPosition,
  saveStateDebounced = () => {},
  beginBatch,
  endBatch,
  attemptWordWrapAtOverflow,
}) {
  let saveState = saveStateDebounced;

  function setPersistenceHooks({ saveStateDebounced: save }) {
    if (typeof save === 'function') saveState = save;
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

  function makePageRecord(idx, wrapEl, pageEl, canvas, marginBoxEl) {
    try {
      pageEl.style.cursor = 'text';
    } catch {}
    prepareCanvas(canvas);
    const ctx = canvas.getContext('2d');
    configureCanvasContext(ctx);
    const backCanvas = document.createElement('canvas');
    prepareCanvas(backCanvas);
    const backCtx = backCanvas.getContext('2d');
    configureCanvasContext(backCtx);
    backCtx.save();
    backCtx.globalCompositeOperation = 'source-over';
    backCtx.globalAlpha = 1;
    backCtx.fillStyle = '#ffffff';
    backCtx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
    backCtx.restore();
    const page = {
      index: idx,
      wrapEl,
      pageEl,
      canvas,
      ctx,
      backCanvas,
      backCtx,
      grid: new Map(),
      raf: 0,
      dirtyAll: true,
      active: false,
      _dirtyRowMinMu: undefined,
      _dirtyRowMaxMu: undefined,
      marginBoxEl,
      grainCanvas: null,
      grainForSize: { w: 0, h: 0 },
    };
    pageEl.addEventListener('mousedown', (e) => handlePageClick(e, idx), { capture: false });
    canvas.addEventListener('mousedown', (e) => handlePageClick(e, idx), { capture: false });
    return page;
  }

  function addPage() {
    const idx = state.pages.length;
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = String(idx);
    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.height = app.PAGE_H + 'px';
    const canvas = document.createElement('canvas');
    const mb = document.createElement('div');
    mb.className = 'margin-box';
    mb.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
    pageEl.appendChild(canvas);
    pageEl.appendChild(mb);
    wrap.appendChild(pageEl);
    app.stageInner.appendChild(wrap);
    const page = makePageRecord(idx, wrap, pageEl, canvas, mb);
    page.canvas.style.visibility = 'hidden';
    state.pages.push(page);
    renderMargins();
    requestVirtualization();
    return page;
  }

  function bootstrapFirstPage() {
    const pageEl = app.firstPage;
    pageEl.style.height = app.PAGE_H + 'px';
    const canvas = pageEl.querySelector('canvas');
    const page = makePageRecord(0, app.firstPageWrap, pageEl, canvas, app.marginBox);
    page.canvas.style.visibility = 'hidden';
    page.marginBoxEl.style.visibility = state.showMarginBox ? 'visible' : 'hidden';
    state.pages.push(page);
  }

  function resetPagesBlankPreserveSettings() {
    state.pages = [];
    app.stageInner.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = '0';
    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.height = app.PAGE_H + 'px';
    const cv = document.createElement('canvas');
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
    renderMargins();
    requestVirtualization();
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
          tokens.push({ layers: stack.map((s) => ({ ch: s.char, ink: s.ink || 'b' })) });
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

  function typeStreamIntoGrid(tokens, caretIndex) {
    const b = getCurrentBounds();
    let pageIndex = 0;
    let rowMu = b.Tmu;
    let col = b.L;
    let page = state.pages[0] || addPage();
    let pos = 0;
    let caretSet = false;

    const newline = () => {
      col = b.L;
      rowMu += state.lineStepMu;
      if (rowMu > b.Bmu) {
        pageIndex++;
        page = state.pages[pageIndex] || addPage();
        app.activePageIndex = page.index;
        requestVirtualization();
        rowMu = b.Tmu;
        col = b.L;
        positionRulers();
      }
    };
    const advance = () => {
      col++;
      if (col > b.R) {
        const moved = attemptWordWrapAtOverflow(rowMu, pageIndex, b, false);
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
      if (col > b.R) {
        const moved = attemptWordWrapAtOverflow(rowMu, pageIndex, b, false);
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

  function getCurrentBounds() {
    const charW = getCharWidth();
    const gridH = getGridHeight();
    const asc = getAsc();
    const desc = getDesc();
    const L = Math.ceil(state.marginL / charW);
    const Rstrict = Math.floor((state.marginR - 1) / charW);
    const pageMaxStart = Math.ceil(app.PAGE_W / charW) - 1;
    const Tmu = Math.ceil((state.marginTop + asc) / gridH);
    const Bmu = Math.floor((app.PAGE_H - state.marginBottom - desc) / gridH);
    const clamp2 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const allowEdgeOverflow = state.marginR >= app.PAGE_W - 0.5;
    const Lc = clamp2(L, 0, pageMaxStart);
    const RcStrict = clamp2(Rstrict, 0, pageMaxStart);
    const Rc = allowEdgeOverflow ? pageMaxStart : RcStrict;
    return { L: Math.min(Lc, Rc), R: Math.max(Lc, Rc), Tmu, Bmu };
  }

  function snapRowMuToStep(rowMu, b = getCurrentBounds()) {
    const step = state.lineStepMu;
    const k = Math.round((rowMu - b.Tmu) / step);
    return clamp(b.Tmu + k * step, b.Tmu, b.Bmu);
  }

  function clampCaretToBounds() {
    const b = getCurrentBounds();
    state.caret.col = clamp(state.caret.col, b.L, b.R);
    state.caret.rowMu = snapRowMuToStep(clamp(state.caret.rowMu, b.Tmu, b.Bmu), b);
    updateCaretPosition();
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
    saveState();
    endBatch();
  }

  function exportToTextFile() {
    const out = [];
    for (let p = 0; p < state.pages.length; p++) {
      const page = state.pages[p];
      if (!page) {
        out.push('');
        continue;
      }
      const rows = Array.from(page.grid.keys()).sort((a, b) => a - b);
      if (!rows.length) {
        out.push('');
        continue;
      }
      for (let i = 0; i < rows.length; i++) {
        const rmu = rows[i];
        const rowMap = page.grid.get(rmu);
        let minCol = Infinity;
        let maxCol = -1;
        for (const c of rowMap.keys()) {
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
        }
        if (!isFinite(minCol) || maxCol < 0) {
          out.push('');
          continue;
        }
        let line = '';
        for (let c = minCol; c <= maxCol; c++) {
          const st = rowMap?.get(c);
          line += st && st.length ? st[st.length - 1].char : ' ';
        }
        out.push(line.replace(/\s+$/, ''));
      }
      if (p < state.pages.length - 1) out.push('');
    }
    const txt = out.join('\n');
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'typewriter.txt';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  }

  return {
    ensureRowExists,
    writeRunToRow,
    overtypeCharacter,
    eraseCharacters,
    makePageRecord,
    addPage,
    bootstrapFirstPage,
    resetPagesBlankPreserveSettings,
    flattenGridToStreamWithCaret,
    typeStreamIntoGrid,
    rewrapDocumentToCurrentBounds,
    getCurrentBounds,
    snapRowMuToStep,
    clampCaretToBounds,
    exportToTextFile,
    setPersistenceHooks,
  };
}
