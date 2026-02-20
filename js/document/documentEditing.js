import { clamp } from '../utils/math.js';
import { recalcMetrics as recalcMetricsForContext } from '../config/metrics.js';
import { markDocumentDirty, markPageContentDirty, getDirtyPageIndices, syncSavedPageRevisions } from '../state/saveRevision.js';
import {
  DEFAULT_DOCUMENT_TITLE,
  normalizeDocumentTitle,
  serializeDocumentState,
  serializeDocumentStateBase,
  serializeDocumentPage,
  deserializeDocumentState,
  generateDocumentId,
} from './documentStore.js';
import { resetInkEffectsState } from '../state/state.js';
import { createGlyphEntry, cloneGlyphEntry } from './glyphStack.js';
import { createDefaultPageNumberingSettings } from '../config/pageNumbering.js';
import { INK_PALETTE, normalizeInkId } from '../config/inkPalette.js';
import { createTypewriterMode } from './typewriterMode.js';
import { createBellPlayer } from '../utils/bellPlayer.js';
import { projectPointWithLineSlant } from '../utils/lineSlantProjection.js';

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
    setPaperOffset,
    applyDefaultMargins,
    computeColsFromCpi,
    applyPaperSizeSelection: applyPaperSizeSelectionFn = null,
    scheduleMetricsUpdate: scheduleMetricsUpdateFn = null,
    rendererHooks,
    layoutZoomFactor,
    requestHammerNudge,
    isZooming,
    rendererApi,
    viewAdapter,
  } = context;

  const {
    updateCaretDom,
    setActivePageIndex,
    toggleRulers,
    rebuildStageForNewDocument,
    setInkButtonsState,
  } = viewAdapter || {};

  const viewUpdateCaret = ({ pageEl, left, top, height, width }) => {
    if (typeof updateCaretDom === 'function') {
      updateCaretDom({ pageEl, left, top, height, width });
      return;
    }
    const caret = app?.caretEl;
    if (!caret) return;
    caret.style.left = left + 'px';
    caret.style.top = top + 'px';
    caret.style.height = height + 'px';
    caret.style.width = width + 'px';
    if (pageEl && caret.parentNode !== pageEl) {
      caret.remove();
      pageEl.appendChild(caret);
    }
  };

  const viewSetActivePageIndex = (index) => {
    if (typeof setActivePageIndex === 'function') {
      setActivePageIndex(index);
    } else {
      app.activePageIndex = index;
    }
  };

  const viewToggleRulers = (show) => {
    if (typeof toggleRulers === 'function') {
      toggleRulers(show);
    } else {
      document.body.classList.toggle('rulers-off', !show);
    }
  };

  const viewRebuildStageDom = (options) => {
    if (typeof rebuildStageForNewDocument === 'function') {
      return rebuildStageForNewDocument(options);
    }
    const { pageIndex = 0, pageHeight, showMarginBox, prepareCanvas: prep } = options || {};
    if (!app.stageInner) return null;
    app.stageInner.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = String(pageIndex);
    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.height = pageHeight + 'px';
    const canvas = document.createElement('canvas');
    if (typeof prep === 'function') prep(canvas);
    const marginBox = document.createElement('div');
    marginBox.className = 'margin-box';
    marginBox.style.visibility = showMarginBox ? 'visible' : 'hidden';
    pageEl.appendChild(canvas);
    pageEl.appendChild(marginBox);
    wrap.appendChild(pageEl);
    app.stageInner.appendChild(wrap);
    app.firstPageWrap = wrap;
    app.firstPage = pageEl;
    app.marginBox = marginBox;
    return { wrap, pageEl, canvas, marginBox };
  };

  const viewSetInkState = (ink) => {
    const normalized = normalizeInkId(ink);
    if (typeof setInkButtonsState === 'function') {
      setInkButtonsState(normalized);
      return;
    }
    INK_PALETTE.forEach(({ id, buttonId }) => {
      const btn = app?.[buttonId];
      if (btn) btn.dataset.active = String(normalized === id);
    });
  };

  const rendererBridge = rendererApi || {};
  let lastVirtualizedCaretPage = Number.isInteger(state?.caret?.page) ? state.caret.page : -1;

  const recalcMetrics = (face) => recalcMetricsForContext(face, metricsOptions || {});

  function markRowAsDirty(page, rowMu) {
    markPageContentDirty(page);
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

  let overtypeSession = null;

  function resetOvertypeSession() {
    overtypeSession = null;
  }

  function ensureOvertypeSession(pageIndex, rowMu) {
    const resolvedPage = Number.isFinite(pageIndex) ? pageIndex : 0;
    const resolvedRow = Number.isFinite(rowMu) ? rowMu : 0;
    if (
      !overtypeSession ||
      overtypeSession.pageIndex !== resolvedPage ||
      overtypeSession.rowMu !== resolvedRow
    ) {
      overtypeSession = {
        pageIndex: resolvedPage,
        rowMu: resolvedRow,
        touched: new Map(),
      };
    }
    return overtypeSession;
  }

  function recordOvertypeBaseline(pageIndex, rowMu, col, stackDepth) {
    const session = ensureOvertypeSession(pageIndex, rowMu);
    if (!session.touched.has(col)) {
      session.touched.set(col, Number.isFinite(stackDepth) ? stackDepth : 0);
    }
  }

  function getOvertypeSessionForRow(pageIndex, rowMu) {
    if (
      !overtypeSession ||
      !Number.isFinite(pageIndex) ||
      !Number.isFinite(rowMu)
    ) {
      return null;
    }
    if (overtypeSession.pageIndex !== pageIndex || overtypeSession.rowMu !== rowMu) {
      return null;
    }
    return overtypeSession;
  }

  function beginOvertypeSessionForRow(pageIndex, rowMu, touchedMap = new Map()) {
    overtypeSession = {
      pageIndex: Number.isFinite(pageIndex) ? pageIndex : 0,
      rowMu: Number.isFinite(rowMu) ? rowMu : 0,
      touched: touchedMap instanceof Map ? touchedMap : new Map(),
    };
    return overtypeSession;
  }

  function resolvePageIndex(page) {
    if (Number.isFinite(page?.index)) return page.index;
    const idx = Array.isArray(state.pages) ? state.pages.indexOf(page) : -1;
    if (idx >= 0) return idx;
    return Number.isFinite(state?.caret?.page) ? state.caret.page : 0;
  }

  function writeRunToRow(page, rowMu, startCol, text, ink) {
    if (!text || !text.length) return;
    const rowMap = ensureRowExists(page, rowMu);
    const normalizedInk = ink || 'b';
    for (let i = 0; i < text.length; i++) {
      const col = startCol + i;
      let stack = rowMap.get(col);
      if (!stack) {
        stack = [];
        rowMap.set(col, stack);
      }
      stack.push(createGlyphEntry(text[i], normalizedInk));
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
    const allowEdgeOverflow = state.marginR >= app.PAGE_W - 0.5 || state.typewriterMarginRelease === true;
    const Lc = clamp2(L, 0, pageMaxStart);
    const RcStrict = clamp2(Rstrict, 0, pageMaxStart);
    const Rc = allowEdgeOverflow ? pageMaxStart : RcStrict;
    return {
      L: Math.min(Lc, Rc),
      R: Math.max(Lc, Rc),
      Rstrict: RcStrict,
      Tmu,
      Bmu,
      gridDiv,
      pageMaxStart,
    };
  }

  const bellPlayer = createBellPlayer({ basePath: 'audio/' });

  const marginReleaseButtons = () => [app.marginReleaseBtn, app.marginReleaseCornerBtn].filter(Boolean);
  const marginReleaseState = { available: false, active: false, enabled: true };
  function setMarginReleaseState(next = {}) {
    Object.assign(marginReleaseState, next);
    const buttons = marginReleaseButtons();
    if (!buttons.length) return;
    const enabled = marginReleaseState.enabled !== false;
    const available = enabled && !!marginReleaseState.available;
    const active = enabled && !!marginReleaseState.active;
    const interactive = available || active;
    buttons.forEach((btn) => {
      btn.classList.toggle('is-armed', interactive);
      btn.classList.toggle('is-used', active);
      btn.disabled = !interactive;
      btn.setAttribute('aria-disabled', btn.disabled ? 'true' : 'false');
    });
  }

  const typewriterMode = createTypewriterMode({
    state,
    onStopChange: () => {
      setMarginReleaseState({ enabled: true });
    },
    onArmChange: (available) => {
      const active = state.typewriterMarginRelease && marginReleaseState.active;
      setMarginReleaseState({ available, active, enabled: true });
    },
    onUse: () => {
      setMarginReleaseState({ active: true, available: true, enabled: true });
    },
    playBell: (soundId, volume) => bellPlayer.play(soundId, volume),
    onStopSound: () => {
      if (state.realTypewriterStopEnabled === false) return;
      bellPlayer.playStop(state.realTypewriterStopSound, state.realTypewriterStopVolume);
    },
  });
  setMarginReleaseState({ available: false, active: false, enabled: true });

  marginReleaseButtons().forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      typewriterMode.activateMarginRelease();
      typewriterMode.afterCaretMove(getCurrentBounds());
      updateCaretPosition();
      focusStage();
    });
  });

  function snapRowMuToStep(rowMu, bounds) {
    const step = state.lineStepMu;
    const k = Math.round((rowMu - bounds.Tmu) / step);
    return clamp(bounds.Tmu + k * step, bounds.Tmu, bounds.Bmu);
  }

  function baseCaretHeightPx() {
    return getGridDiv() * getGridHeight();
  }

  function updateCaretPosition() {
    typewriterMode.afterCaretMove(getCurrentBounds());
    const p = state.pages[state.caret.page];
    if (!p) return;
    const layoutScale = layoutZoomFactor();
    const projectedCaret = projectPointWithLineSlant({
      x: state.caret.col * getCharWidth(),
      y: state.caret.rowMu * getGridHeight(),
      angleDeg: p.lineSlantDeg,
      centerX: app.PAGE_W / 2,
      centerY: app.PAGE_H / 2,
    });
    const caretLeft = projectedCaret.x * layoutScale;
    const caretTop = (projectedCaret.y - getBaselineOffsetCell()) * layoutScale;
    const caretHeight = baseCaretHeightPx() * layoutScale;
    const caretWidth = Math.max(1, Math.round(2 * layoutScale));
    viewUpdateCaret({
      pageEl: p.pageEl,
      left: caretLeft,
      top: caretTop,
      height: caretHeight,
      width: caretWidth,
    });
    if (!isZooming()) requestHammerNudge();
    const caretPage = Number.isInteger(state?.caret?.page) ? state.caret.page : -1;
    const shouldVirtualize = caretPage !== lastVirtualizedCaretPage;
    lastVirtualizedCaretPage = caretPage;
    if (shouldVirtualize) {
      requestVirtualization();
    }
  }

  function clampCaretToBounds() {
    const bounds = getCurrentBounds();
    state.caret.col = clamp(state.caret.col, bounds.L, bounds.R);
    state.caret.rowMu = snapRowMuToStep(clamp(state.caret.rowMu, bounds.Tmu, bounds.Bmu), bounds);
    typewriterMode.afterCaretMove(bounds);
    updateCaretPosition();
  }

  function overtypeCharacter(page, rowMu, col, ch, ink, options = undefined) {
    const rowMap = ensureRowExists(page, rowMu);
    let stack = rowMap.get(col);
    if (!stack) {
      stack = [];
      rowMap.set(col, stack);
    }
    const pageIndex = resolvePageIndex(page);
    recordOvertypeBaseline(pageIndex, rowMu, col, stack.length);
    const normalizedInk = ink || 'b';
    const jitterSalt = options?.jitterSalt;
    stack.push(createGlyphEntry(ch, normalizedInk, jitterSalt));
    markRowAsDirty(page, rowMu);
  }

  function shiftRow(page, rowMu, startCol, delta) {
    if (!delta) return false;
    const rowMap = page.grid.get(rowMu);
    if (!rowMap) return false;
    const cols = Array.from(rowMap.keys())
      .filter((c) => c >= startCol)
      .sort((a, b) => (delta > 0 ? b - a : a - b));
    if (!cols.length) return false;
    let changed = false;
    for (const col of cols) {
      const stack = rowMap.get(col);
      if (!stack) continue;
      rowMap.delete(col);
      const target = col + delta;
      const existing = rowMap.get(target);
      if (existing && Array.isArray(existing)) {
        existing.push(...stack);
      } else {
        rowMap.set(target, stack);
      }
      changed = true;
    }
    if (changed) markRowAsDirty(page, rowMu);
    return changed;
  }

  function ensurePage(index) {
    if (!state.pages[index]) addPage(index);
    return state.pages[index];
  }

  function shiftRowsUpFrom(pageIndex, startRowMu, deltaMu) {
    if (!Number.isFinite(deltaMu) || deltaMu <= 0) return;
    const bounds = getCurrentBounds();
    const page = ensurePage(pageIndex);
    const rows = page.grid ? Array.from(page.grid.keys()).filter((r) => r >= startRowMu) : [];
    rows.sort((a, b) => a - b);
    for (const row of rows) {
      const target = row - deltaMu;
      const rowMap = page.grid.get(row);
      if (!rowMap) continue;
      page.grid.delete(row);
      if (target >= bounds.Tmu) {
        page.grid.set(target, rowMap);
        markRowAsDirty(page, target);
      } else if (pageIndex > 0) {
        // move into previous page's bottom region
        const prevPage = ensurePage(pageIndex - 1);
        const destRow = bounds.Bmu - (bounds.Tmu - target - state.lineStepMu);
        const destMap = prevPage.grid.get(destRow);
        if (destMap) {
          for (const [col, stack] of rowMap.entries()) {
            const existing = destMap.get(col) || [];
            destMap.set(col, existing.concat(stack));
          }
        } else {
          prevPage.grid.set(destRow, rowMap);
        }
        markRowAsDirty(prevPage, destRow);
      }
      markRowAsDirty(page, row);
    }
  }

  function shiftRowsDownFrom(pageIndex, startRowMu, deltaMu) {
    if (!Number.isFinite(deltaMu) || deltaMu <= 0) return;
    const bounds = getCurrentBounds();
    const page = ensurePage(pageIndex);
    const rows = page.grid ? Array.from(page.grid.keys()).filter((r) => r >= startRowMu) : [];
    rows.sort((a, b) => b - a);
    for (const row of rows) {
      const target = row + deltaMu;
      const rowMap = page.grid.get(row);
      if (!rowMap) continue;
      page.grid.delete(row);
      if (target <= bounds.Bmu) {
        page.grid.set(target, rowMap);
        markRowAsDirty(page, target);
      } else {
        // Overflow into next page
        const overflowOffset = target - bounds.Bmu - state.lineStepMu;
        shiftRowsDownFrom(pageIndex + 1, bounds.Tmu, deltaMu);
        const nextPage = ensurePage(pageIndex + 1);
        const destRow = bounds.Tmu + Math.max(0, overflowOffset);
        const destMap = nextPage.grid.get(destRow);
        if (destMap) {
          // merge if destination already exists
          for (const [col, stack] of rowMap.entries()) {
            const existing = destMap.get(col) || [];
            destMap.set(col, existing.concat(stack));
          }
        } else {
          nextPage.grid.set(destRow, rowMap);
        }
        markRowAsDirty(nextPage, destRow);
      }
      markRowAsDirty(page, row);
    }
  }

  function splitLineAtCaret(bounds) {
    const page = state.pages[state.caret.page] || addPage();
    const rowMap = page.grid.get(state.caret.rowMu);
    const caretCol = state.caret.col;
    const cols = rowMap
      ? Array.from(rowMap.keys())
          .filter((c) => c >= caretCol)
          .sort((a, b) => a - b)
      : [];

    let targetPageIndex = state.caret.page;
    let targetRowMu = state.caret.rowMu + state.lineStepMu;
    let targetPage = page;
    if (targetRowMu > bounds.Bmu) {
      targetPageIndex += 1;
      targetPage = state.pages[targetPageIndex] || addPage();
      targetRowMu = bounds.Tmu;
      viewSetActivePageIndex(targetPageIndex);
      requestVirtualization();
      positionRulers();
    }

    if (cols.length) {
      const stacks = cols.map((c) => {
        const stack = rowMap.get(c);
        rowMap.delete(c);
        return stack;
      });
      if (rowMap && !rowMap.size) page.grid.delete(state.caret.rowMu);
      let writeCol = bounds.L;
      const targetRowMap = ensureRowExists(targetPage, targetRowMu);
      stacks.forEach((stack) => {
        if (!stack) return;
        targetRowMap.set(writeCol, stack);
        writeCol += 1;
      });
      markRowAsDirty(page, state.caret.rowMu);
      markRowAsDirty(targetPage, targetRowMu);
    }

    state.caret.page = targetPageIndex;
    state.caret.rowMu = targetRowMu;
    state.caret.col = bounds.L;
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
  const BULK_INSERT_SLICE_CHAR_BUDGET = 2048;
  const BULK_INSERT_SLICE_TIME_BUDGET_MS = 8;

  function isWhitespaceChar(ch) {
    return /\s/.test(ch);
  }

  function insertStringFastSync(text, onComplete = null) {
    const bounds = getCurrentBounds();

    let pageIndex = state.caret.page;
    let page = state.pages[pageIndex] || addPage();
    let rowMu = state.caret.rowMu;
    let startCol = state.caret.col;
    const ink = state.ink;

    const prevFreeze = getFreezeVirtual();
    setFreezeVirtual(true);
    try {
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

      const strictTypewriter = state.realTypewriterEnabled && !state.realTypewriterBackspaceEnabled;

      if (strictTypewriter) {
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (ch === '\n') {
            newline();
            continue;
          }
          const currentPage = state.pages[state.caret.page] || addPage();
          overtypeCharacter(currentPage, state.caret.rowMu, state.caret.col, ch, state.ink);
          advanceCaret();
        }
        return;
      }

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (ch === '\n') {
          flush();
          newline();
          continue;
        }

        buf += ch;
        if (isWhitespaceChar(ch)) lastSpacePos = buf.length - 1;

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
            lastSpacePos = isWhitespaceChar(ch) ? 0 : -1;
          }
        }
      }
      flush();

      state.caret = { page: pageIndex, rowMu, col: startCol };
    } finally {
      setFreezeVirtual(prevFreeze);
      updateCaretPosition();
      positionRulers();
      requestVirtualization();
      markDocumentDirty(state);
      saveStateDebounced();
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }
  }

  function insertStringFastProgressive(text, { onComplete } = {}) {
    const bounds = getCurrentBounds();

    let pageIndex = state.caret.page;
    let page = state.pages[pageIndex] || addPage();
    let rowMu = state.caret.rowMu;
    let startCol = state.caret.col;
    const ink = state.ink;
    let i = 0;
    let buf = '';
    let lastSpacePos = -1;
    let finalized = false;

    const prevFreeze = getFreezeVirtual();
    setFreezeVirtual(true);

    const now = () => {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
      }
      return Date.now();
    };

    const schedule = (callback) => {
      if (typeof requestAnimationFrame === 'function') {
        return requestAnimationFrame(callback);
      }
      return setTimeout(callback, 0);
    };

    const newline = () => {
      startCol = bounds.L;
      rowMu += state.lineStepMu;
      if (rowMu > bounds.Bmu) {
        pageIndex++;
        page = state.pages[pageIndex] || addPage();
        rowMu = bounds.Tmu;
      }
    };

    const flush = () => {
      if (buf.length) {
        writeRunToRow(page, rowMu, startCol, buf, ink);
        startCol += buf.length;
        buf = '';
        lastSpacePos = -1;
      }
    };

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      flush();
      state.caret = { page: pageIndex, rowMu, col: startCol };
      setFreezeVirtual(prevFreeze);
      updateCaretPosition();
      positionRulers();
      requestVirtualization();
      markDocumentDirty(state);
      saveStateDebounced();
      if (typeof onComplete === 'function') {
        onComplete();
      }
    };

    const fail = (err) => {
      console.error('Typomatique: progressive paste failed.', err);
      finalize();
    };

    const processChar = (ch) => {
      if (ch === '\n') {
        flush();
        newline();
        return;
      }

      buf += ch;
      if (isWhitespaceChar(ch)) lastSpacePos = buf.length - 1;

      const colForCh = startCol + buf.length - 1;
      if (colForCh <= bounds.R) return;

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
        lastSpacePos = isWhitespaceChar(ch) ? 0 : -1;
      }
    };

    const processSlice = () => {
      if (finalized) return;
      const sliceStart = now();
      let processed = 0;
      let error = null;

      beginBatch();
      try {
        while (i < text.length) {
          processChar(text[i]);
          i += 1;
          processed += 1;

          if (processed >= BULK_INSERT_SLICE_CHAR_BUDGET) {
            if ((now() - sliceStart) >= BULK_INSERT_SLICE_TIME_BUDGET_MS) {
              break;
            }
            processed = 0;
          }
        }
      } catch (err) {
        error = err;
      } finally {
        endBatch();
      }

      if (error) {
        fail(error);
        return;
      }

      if (i >= text.length) {
        finalize();
        return;
      }

      schedule(processSlice);
    };

    schedule(processSlice);
    return true;
  }

  function insertStringFast(s, options = {}) {
    const text = (s || '').replace(/\r\n?/g, '\n');
    if (!text.length) {
      if (typeof options?.onComplete === 'function') {
        options.onComplete();
      }
      return false;
    }

    const progressive = options?.progressive === true;
    const strictTypewriter = state.realTypewriterEnabled && !state.realTypewriterBackspaceEnabled;
    if (progressive && !strictTypewriter) {
      return insertStringFastProgressive(text, options);
    }

    insertStringFastSync(text, options?.onComplete);
    return false;
  }


  function advanceCaret() {
    const strictTypewriter = state.realTypewriterEnabled && !state.realTypewriterBackspaceEnabled;
    const bounds = getCurrentBounds();
    const nextCol = state.caret.col + 1;
    if (strictTypewriter) {
      if (typewriterMode.shouldHoldAtMargin(nextCol, bounds)) {
        typewriterMode.afterCaretMove(bounds);
        updateCaretPosition();
        return;
      }
      state.caret.col = clamp(nextCol, bounds.L, bounds.pageMaxStart);
      typewriterMode.afterCaretMove(bounds);
      updateCaretPosition();
      return;
    }

    state.caret.col = nextCol;
    if (state.caret.col > bounds.R) {
      const moved = attemptWordWrapAtOverflow(state.caret.rowMu, state.caret.page, bounds, true);
      if (!moved) {
        state.caret.col = bounds.L;
        state.caret.rowMu += state.lineStepMu;
        if (state.caret.rowMu > bounds.Bmu) {
          state.caret.page++;
          const np = state.pages[state.caret.page] || addPage();
          viewSetActivePageIndex(np.index);
          requestVirtualization();
          state.caret.rowMu = bounds.Tmu;
          state.caret.col = bounds.L;
          positionRulers();
        }
      }
    }
    typewriterMode.afterCaretMove(bounds);
    updateCaretPosition();
  }

  function handleNewline() {
    const bounds = getCurrentBounds();
    if (state.realTypewriterBackspaceEnabled) {
      typewriterMode.resetForNewLine();
      shiftRowsDownFrom(state.caret.page, state.caret.rowMu + state.lineStepMu, state.lineStepMu);
      splitLineAtCaret(bounds);
    } else {
      typewriterMode.resetForNewLine();
      state.caret.col = bounds.L;
      state.caret.rowMu += state.lineStepMu;
      if (state.caret.rowMu > bounds.Bmu) {
        state.caret.page++;
        const np = state.pages[state.caret.page] || addPage();
        viewSetActivePageIndex(np.index);
        requestVirtualization();
        state.caret.rowMu = bounds.Tmu;
        state.caret.col = bounds.L;
        positionRulers();
      }
    }
    typewriterMode.afterCaretMove(getCurrentBounds());
    updateCaretPosition();
  }

  function handleBackspace() {
    const bounds = getCurrentBounds();
    const prevKey = `${state.caret.page}:${state.caret.rowMu}`;
    let nextPage = state.caret.page;
    let nextRowMu = state.caret.rowMu;
    let nextCol = state.caret.col;
    let mergedLine = false;

    if (nextCol > bounds.L) {
      nextCol -= 1;
    } else if (state.realTypewriterBackspaceEnabled) {
      // merge with previous line
      let prevPage = nextPage;
      let prevRowMu = nextRowMu - state.lineStepMu;
      if (prevRowMu < bounds.Tmu && nextPage > 0) {
        prevPage = nextPage - 1;
        prevRowMu = bounds.Bmu;
      }
      if (prevRowMu >= bounds.Tmu) {
        const currPage = ensurePage(state.caret.page);
        const currRowMap = currPage.grid.get(state.caret.rowMu);
        const targetPage = ensurePage(prevPage);
        const targetRowMap = ensureRowExists(targetPage, prevRowMu);
        const existingCols = targetRowMap.size ? Array.from(targetRowMap.keys()) : [];
        const appendStart = existingCols.length ? Math.max(...existingCols) + 1 : bounds.L;
        if (currRowMap) {
          const cols = Array.from(currRowMap.keys()).sort((a, b) => a - b);
          cols.forEach((col) => {
            const stack = currRowMap.get(col);
            currRowMap.delete(col);
            targetRowMap.set(appendStart + (col - bounds.L), stack);
          });
          if (!currRowMap.size) currPage.grid.delete(state.caret.rowMu);
        }
        shiftRowsUpFrom(state.caret.page, state.caret.rowMu + state.lineStepMu, state.lineStepMu);
        markRowAsDirty(targetPage, prevRowMu);
        markRowAsDirty(currPage, state.caret.rowMu);
        nextPage = prevPage;
        nextRowMu = prevRowMu;
        nextCol = appendStart;
        mergedLine = true;
      } else if (nextRowMu > bounds.Tmu) {
        nextRowMu -= state.lineStepMu;
        nextCol = bounds.R;
      } else if (nextPage > 0) {
        nextPage -= 1;
        viewSetActivePageIndex(nextPage);
        nextRowMu = bounds.Bmu;
        nextCol = bounds.R;
        positionRulers();
      }
    } else if (nextRowMu > bounds.Tmu) {
      nextRowMu -= state.lineStepMu;
      nextCol = bounds.R;
    } else if (nextPage > 0) {
      nextPage -= 1;
      viewSetActivePageIndex(nextPage);
      nextRowMu = bounds.Bmu;
      nextCol = bounds.R;
      positionRulers();
    }

    const movedRow = prevKey !== `${nextPage}:${nextRowMu}`;
    state.caret.page = nextPage;
    state.caret.rowMu = nextRowMu;
    state.caret.col = nextCol;

    if (state.realTypewriterBackspaceEnabled && !mergedLine) {
      const page = state.pages[state.caret.page] || addPage();
      eraseCharacters(page, state.caret.rowMu, state.caret.col, 1);
      shiftRow(page, state.caret.rowMu, state.caret.col + 1, -1);
    }

    if (movedRow) typewriterMode.resetForNewLine();
    typewriterMode.afterCaretMove(getCurrentBounds());
    updateCaretPosition();
  }

  function moveCaretByLines(deltaLines) {
    if (!Number.isFinite(deltaLines) || deltaLines === 0) return;

    const bounds = getCurrentBounds();
    const step = Math.max(1, state.lineStepMu || 1);
    const verticalRange = Math.max(0, bounds.Bmu - bounds.Tmu);
    const linesPerPage = Math.max(1, Math.floor(verticalRange / step) + 1);
    const normalizeLine = (rowMu) =>
      clamp(Math.round((rowMu - bounds.Tmu) / step), 0, linesPerPage - 1);

    let nextLine = normalizeLine(state.caret.rowMu) + deltaLines;
    let nextPageIndex = state.caret.page;
    const hasPage = (idx) => idx >= 0 && idx < state.pages.length && !!state.pages[idx];

    while (nextLine < 0 && nextPageIndex > 0 && hasPage(nextPageIndex - 1)) {
      nextPageIndex -= 1;
      nextLine += linesPerPage;
    }

    while (nextLine >= linesPerPage && hasPage(nextPageIndex + 1)) {
      nextPageIndex += 1;
      nextLine -= linesPerPage;
    }

    nextLine = clamp(nextLine, 0, linesPerPage - 1);
    const targetRowMu = snapRowMuToStep(bounds.Tmu + nextLine * step, bounds);
    state.caret.rowMu = clamp(targetRowMu, bounds.Tmu, bounds.Bmu);
    state.caret.col = clamp(state.caret.col, bounds.L, bounds.R);

    const prevPageIndex = state.caret.page;
    if (nextPageIndex !== prevPageIndex && hasPage(nextPageIndex)) {
      state.caret.page = nextPageIndex;
      const targetPage = state.pages[nextPageIndex];
      if (targetPage) {
        viewSetActivePageIndex(targetPage.index);
      } else {
        viewSetActivePageIndex(nextPageIndex);
      }
      requestVirtualization();
      positionRulers();
    }

    const moved = nextPageIndex !== prevPageIndex || state.caret.rowMu !== targetRowMu;
    if (moved) typewriterMode.resetForNewLine();
    typewriterMode.afterCaretMove(getCurrentBounds());
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
    markDocumentDirty(state);
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
          tokens.push({
            layers: stack.map((s) => ({
              ch: s.char,
              ink: s.ink || 'b',
              salt: Number.isFinite(s?.jitterSalt) ? (s.jitterSalt >>> 0) : undefined,
            })),
          });
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
    // Skip wrapping when margin release is active for this line.
    if (state.typewriterMarginRelease) return false;
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

    const session = getOvertypeSessionForRow(pageIndex, prevRowMu);
    const movementPlan = [];
    for (let c = start; c <= maxCol; c++) {
      const stack = rowMap.get(c);
      if (!stack || !stack.length) continue;
      let baseDepth = 0;
      if (session) {
        if (session.touched.has(c)) baseDepth = session.touched.get(c);
        else baseDepth = stack.length;
      }
      if (!session) baseDepth = 0;
      if (baseDepth < 0) baseDepth = 0;
      if (baseDepth >= stack.length) continue;
      movementPlan.push({ col: c, baseDepth });
    }

    if (!movementPlan.length && session) {
      for (let c = start; c <= maxCol; c++) {
        const stack = rowMap.get(c);
        if (!stack || !stack.length) continue;
        movementPlan.push({ col: c, baseDepth: 0, legacy: true });
      }
    }
    if (!movementPlan.length) return false;

    let destPageIndex = pageIndex;
    let destRowMu = prevRowMu + state.lineStepMu;
    if (destRowMu > bounds.Bmu) {
      destPageIndex++;
      const np = state.pages[destPageIndex] || addPage();
      viewSetActivePageIndex(np.index);
      requestVirtualization();
      destRowMu = bounds.Tmu;
      positionRulers();
    }
    const destPage = state.pages[destPageIndex] || addPage();
    const destRowMap = ensureRowExists(destPage, destRowMu);

    let destCol = bounds.L;
    let movedAny = false;
    const nextSessionTouched = mutateCaret ? new Map() : null;
    for (const plan of movementPlan) {
      const stack = rowMap.get(plan.col);
      if (!stack || !stack.length) continue;
      const baseDepth = Math.max(0, Math.min(plan.baseDepth, stack.length));
      if (baseDepth >= stack.length) continue;
      const movingEntries = stack.splice(baseDepth);
      if (!movingEntries.length) continue;
      let dstack = destRowMap.get(destCol);
      if (!dstack) {
        dstack = [];
        destRowMap.set(destCol, dstack);
      }
      const destBaseDepth = dstack.length;
      for (const s of movingEntries) {
        dstack.push(cloneGlyphEntry(s));
      }
      if (!stack.length) rowMap.delete(plan.col);
      if (session) session.touched.delete(plan.col);
      if (nextSessionTouched) {
        nextSessionTouched.set(destCol, destBaseDepth);
      }
      destCol++;
      movedAny = true;
    }

    if (!movedAny) return false;

    markRowAsDirty(page, prevRowMu);
    markRowAsDirty(destPage, destRowMu);

    if (session && overtypeSession === session) {
      overtypeSession = null;
    }
    if (mutateCaret) {
      beginOvertypeSessionForRow(destPageIndex, destRowMu, nextSessionTouched || new Map());
    }

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
        viewSetActivePageIndex(page.index);
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
          overtypeCharacter(page, rowMu, col, L.ch, L.ink || 'b', { jitterSalt: L.salt });
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
    resetOvertypeSession();
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
    markDocumentDirty(state);
    saveStateDebounced();
    endBatch();
  }

  function serializeState() {
    return serializeDocumentState(state, { getActiveFontName });
  }

  function serializeStateBase() {
    return serializeDocumentStateBase(state, { getActiveFontName });
  }

  function serializePageState(pageIndex) {
    const index = Number.isInteger(pageIndex) ? pageIndex : 0;
    return serializeDocumentPage(state.pages[index]);
  }

  function deserializeState(data) {
    resetOvertypeSession();
    return deserializeDocumentState(data, {
      state,
      app,
      getGridDiv,
      prepareCanvas,
      makePageRecord,
      computeColsFromCpi,
      setActiveFontName,
      applyPaperSizeSelection: applyPaperSizeSelectionFn,
      scheduleMetricsUpdate: scheduleMetricsUpdateFn,
    });
  }

  function createNewDocument(options = {}) {
    const { documentId, documentTitle, skipSave } = options || {};
    resetOvertypeSession();
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
    state.savedInkStyles = [];
    state.currentInkStyle = null;
    resetInkEffectsState(state);
    state.pageNumbering = createDefaultPageNumberingSettings();
    beginBatch();
    state.paperOffset = { x: 0, y: 0 };
    setPaperOffset(0, 0);
    state.pages = [];
    state.caret = { page: 0, rowMu: 0, col: 0 };
    state.altSeed = ((Math.random() * 0xFFFFFFFF) >>> 0);
    state.glyphJitterSeed = ((Math.random() * 0xFFFFFFFF) >>> 0);
    state.savedInkStyles = [];
    const primaryPage = viewRebuildStageDom({
      pageIndex: 0,
      pageHeight: app.PAGE_H,
      showMarginBox: state.showMarginBox,
      prepareCanvas,
    });
    const wrap = primaryPage?.wrap;
    const pageEl = primaryPage?.pageEl;
    const cv = primaryPage?.canvas;
    const mb = primaryPage?.marginBox;
    const page = makePageRecord(0, wrap, pageEl, cv, mb);
    page.canvas.style.visibility = 'hidden';
    state.pages.push(page);
    applyDefaultMargins();
    recalcMetrics(getActiveFontName());
    if (typeof rendererBridge.rebuildAllAtlases === 'function') {
      rendererBridge.rebuildAllAtlases();
    }
    for (const p of state.pages) {
      configureCanvasContext(p.ctx);
      configureCanvasContext(p.backCtx);
      p.dirtyAll = true;
      schedulePaint(p);
    }
    renderMargins();
    clampCaretToBounds();
    updateCaretPosition();
    viewToggleRulers(state.showRulers);
    positionRulers();
    requestVirtualization();
    if (!skipSave) {
      markDocumentDirty(state);
      saveStateNow();
    }
    endBatch();
    return state.documentId;
  }

  function setInk(ink) {
    const normalized = normalizeInkId(ink);
    state.ink = normalized;
    viewSetInkState(normalized);
    markDocumentDirty(state);
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
    shiftRow,
    moveCaretByLines,
    rewrapDocumentToCurrentBounds,
    serializeState,
    serializeStateBase,
    serializePageState,
    deserializeState,
    getDirtyPageIndices: () => getDirtyPageIndices(state),
    syncSavedPageRevisions: (pageIndices = null) => syncSavedPageRevisions(state, pageIndices),
    setInk,
    createNewDocument,
  };
}
