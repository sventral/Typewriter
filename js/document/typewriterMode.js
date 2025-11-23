import { clamp } from '../utils/math.js';

export function createTypewriterMode({
  state,
  onStopChange = () => {},
  playBell = () => {},
}) {
  let warnedRowKey = null;

  const rowKey = () => `${state.caret?.page ?? 0}:${state.caret?.rowMu ?? 0}`;

  function clearWarningIfRowChanged(currentKey) {
    if (!currentKey) return;
    if (warnedRowKey && warnedRowKey !== currentKey) {
      warnedRowKey = null;
    }
  }

  function setStop(active) {
    onStopChange(!!active);
  }

  function maybeRingBell(bounds) {
    if (!state.realTypewriterEnabled) return;
    const lead = clamp(Math.round(Number(state.realTypewriterBellLead ?? 0)), 0, 40);
    if (lead <= 0) return;
    const key = rowKey();
    clearWarningIfRowChanged(key);
    const threshold = Math.max(bounds.L, bounds.R - lead + 1);
    if (warnedRowKey === key) return;
    if (state.caret.col >= threshold) {
      warnedRowKey = key;
      playBell(state.realTypewriterBellSound, state.realTypewriterBellVolume);
    }
  }

  function shouldHoldAtMargin(nextCol, bounds) {
    if (!state.realTypewriterEnabled) return false;
    if (state.typewriterMarginRelease) return false;
    if (nextCol > bounds.R) {
      setStop(true);
      return true;
    }
    return false;
  }

  function afterCaretMove(bounds) {
    if (!state.realTypewriterEnabled) {
      setStop(false);
      return;
    }
    maybeRingBell(bounds);
    const atStop = !state.typewriterMarginRelease && state.caret.col >= bounds.R;
    setStop(atStop);
  }

  function resetForNewLine() {
    state.typewriterMarginRelease = false;
    warnedRowKey = null;
    setStop(false);
  }

  function activateMarginRelease() {
    if (!state.realTypewriterEnabled) return;
    state.typewriterMarginRelease = true;
    setStop(false);
  }

  function handleRowChange(bounds) {
    clearWarningIfRowChanged(rowKey());
    afterCaretMove(bounds);
  }

  function handleSettingsDisabled() {
    if (!state.realTypewriterEnabled) {
      state.typewriterMarginRelease = false;
      warnedRowKey = null;
      setStop(false);
    }
  }

  return {
    shouldHoldAtMargin,
    afterCaretMove,
    resetForNewLine,
    activateMarginRelease,
    handleRowChange,
    handleSettingsDisabled,
    clearStop: () => setStop(false),
  };
}
