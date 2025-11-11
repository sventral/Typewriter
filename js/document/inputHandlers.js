import { markDocumentDirty } from '../state/saveRevision.js';

const NUM_INPUT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Backspace',
  'Delete',
  'Tab',
]);

const TYPED_RUN_MAXLEN = 20;
const TYPED_RUN_TIMEOUT = 500;
const EXPAND_PASTE_WINDOW = 350;
const BS_WINDOW = 250;
const STRAY_V_WINDOW = 30;

function isToolbarInput(el) {
  if (!el) return false;
  const id = el.id || '';
  return (
    id === 'sizeInput' ||
    id === 'lhInput' ||
    id === 'cpiSelect' ||
    id === 'showMarginBoxCb' ||
    id === 'wordWrapCb' ||
    id === 'mmLeft' ||
    id === 'mmRight' ||
    id === 'mmTop' ||
    id === 'mmBottom' ||
    id === 'stageWidthPct' ||
    id === 'stageHeightPct' ||
    id.includes('Slider')
  );
}

function isEditableTarget(target) {
  if (!target) return false;
  if (isToolbarInput(target)) return false;
  const tag = (target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  const dlg =
    target.closest &&
    (target.closest('dialog.settings-modal') || target.closest('aside.side-panel'));
  if (dlg && (dlg.open || dlg.classList.contains('is-open'))) return true;
  return false;
}

function isDigitKey(key) {
  return key.length === 1 && /[0-9]/.test(key);
}

export function createInputController({
  state,
  typedRun,
  getCurrentBounds,
  advanceCaret,
  handleNewline,
  handleBackspace,
  insertTextFast,
  overtypeCharacter,
  eraseCharacters,
  addPage,
  updateCaretPosition,
  beginBatch,
  endBatch,
  beginTypingFrameBatch,
  saveStateDebounced,
  focusStage,
  applySubmittedChanges,
  applyLineHeight,
  clamp,
  counters,
}) {
  if (!state || !typedRun || typeof getCurrentBounds !== 'function') {
    throw new Error('createInputController: missing required dependencies');
  }

  function resetTypedRun() {
    typedRun.active = false;
  }

  function noteTypedCharPreInsert() {
    const now = performance.now();
    const caret = state.caret;
    const contiguous =
      typedRun.active &&
      typedRun.page === caret.page &&
      typedRun.rowMu === caret.rowMu &&
      caret.col === typedRun.startCol + typedRun.length &&
      now - typedRun.lastTs <= TYPED_RUN_TIMEOUT &&
      typedRun.length < TYPED_RUN_MAXLEN;

    if (contiguous) {
      typedRun.length += 1;
      typedRun.lastTs = now;
    } else {
      typedRun.active = true;
      typedRun.page = caret.page;
      typedRun.rowMu = caret.rowMu;
      typedRun.startCol = caret.col;
      typedRun.length = 1;
      typedRun.lastTs = now;
    }
  }

  function consumeBackspaceBurstIfAny() {
    const now = performance.now();
    const burstTs = counters.getBsBurstTs();
    const burstCount = counters.getBsBurstCount();
    if (now - burstTs < BS_WINDOW && burstCount > 0) {
      const page = state.pages[state.caret.page] || addPage();
      eraseCharacters(page, state.caret.rowMu, state.caret.col, burstCount);
      counters.setBsBurstCount(0);
      counters.setBsBurstTs(0);
      resetTypedRun();
      return true;
    }
    return false;
  }

  function handleKeyDown(e) {
    if (isEditableTarget(e.target)) return;

    if (e.target && isToolbarInput(e.target)) {
      const key = e.key;
      const allowDecimal = e.target.id === 'lhInput';
      if (key === 'Enter') {
        e.preventDefault();
        if (e.target.id === 'lhInput') applyLineHeight();
        else applySubmittedChanges();
        focusStage();
        return;
      }
      if (
        NUM_INPUT_KEYS.has(key) ||
        isDigitKey(key) ||
        (key === ',' && allowDecimal) ||
        (key === '.' && allowDecimal)
      ) {
        return;
      }
      try { e.target.blur(); } catch {}
      focusStage();
    }

    const key = e.key;
    const bounds = getCurrentBounds();

    if (e.metaKey || e.ctrlKey) {
      const lastDigitTs = counters.getLastDigitTs();
      const lastDigitCaret = counters.getLastDigitCaret();
      if (key.toLowerCase() === 'v' && performance.now() - lastDigitTs < 180 && lastDigitCaret) {
        state.caret = { ...lastDigitCaret };
        updateCaretPosition();
      }
      return;
    }

    if (key === 'Enter') {
      e.preventDefault();
      resetTypedRun();
      handleNewline();
      markDocumentDirty(state);
      saveStateDebounced();
      return;
    }

    if (key === 'Backspace') {
      e.preventDefault();
      const now = performance.now();
      const burstTs = counters.getBsBurstTs();
      const burstCount = counters.getBsBurstCount();
      if (now - burstTs < 200) counters.setBsBurstCount(burstCount + 1);
      else counters.setBsBurstCount(1);
      counters.setBsBurstTs(now);
      beginTypingFrameBatch();
      handleBackspace();
      resetTypedRun();
      markDocumentDirty(state);
      saveStateDebounced();
      return;
    }

    if (key === 'ArrowLeft') {
      e.preventDefault();
      resetTypedRun();
      state.caret.col = clamp(state.caret.col - 1, bounds.L, bounds.R);
      updateCaretPosition();
      return;
    }

    if (key === 'ArrowRight') {
      e.preventDefault();
      resetTypedRun();
      state.caret.col = clamp(state.caret.col + 1, bounds.L, bounds.R);
      updateCaretPosition();
      return;
    }

    if (key === 'ArrowUp') {
      e.preventDefault();
      resetTypedRun();
      state.caret.rowMu = clamp(state.caret.rowMu - state.lineStepMu, bounds.Tmu, bounds.Bmu);
      updateCaretPosition();
      return;
    }

    if (key === 'ArrowDown') {
      e.preventDefault();
      resetTypedRun();
      state.caret.rowMu = clamp(state.caret.rowMu + state.lineStepMu, bounds.Tmu, bounds.Bmu);
      updateCaretPosition();
      return;
    }

    if (key === 'Tab') {
      e.preventDefault();
      resetTypedRun();
      for (let i = 0; i < 5; i += 1) advanceCaret();
      markDocumentDirty(state);
      saveStateDebounced();
      return;
    }

    if (key.length === 1) {
      e.preventDefault();
      const lastPasteTs = counters.getLastPasteTs();
      if (key === 'v' && performance.now() - lastPasteTs < STRAY_V_WINDOW) return;

      if (/[0-9]/.test(key)) {
        counters.setLastDigitTs(performance.now());
        counters.setLastDigitCaret({ ...state.caret });
      } else {
        counters.setLastDigitTs(0);
        counters.setLastDigitCaret(null);
      }

      beginTypingFrameBatch();
      consumeBackspaceBurstIfAny();
      noteTypedCharPreInsert();
      const page = state.pages[state.caret.page] || addPage();
      overtypeCharacter(page, state.caret.rowMu, state.caret.col, key, state.ink);
      advanceCaret();
      markDocumentDirty(state);
      saveStateDebounced();
    }
  }

  function handlePaste(e) {
    if (isEditableTarget(e.target)) return;

    const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    if (!text) return;

    e.preventDefault();
    const now = performance.now();
    counters.setLastPasteTs(now);

    beginBatch();

    if (!consumeBackspaceBurstIfAny()) {
      const fresh =
        typedRun.active &&
        typedRun.page === state.caret.page &&
        typedRun.rowMu === state.caret.rowMu &&
        now - typedRun.lastTs <= EXPAND_PASTE_WINDOW &&
        typedRun.length > 0 &&
        typedRun.length <= TYPED_RUN_MAXLEN;

      if (fresh) {
        state.caret.col = typedRun.startCol;
        updateCaretPosition();
        const page = state.pages[state.caret.page] || addPage();
        eraseCharacters(page, state.caret.rowMu, state.caret.col, typedRun.length);
        resetTypedRun();
      }
    }

    insertTextFast(text);

    resetTypedRun();
    endBatch();
  }

  return {
    handleKeyDown,
    handlePaste,
    resetTypedRun,
  };
}
