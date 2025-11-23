import { clamp } from '../utils/math.js';

export function createTypewriterMode({
  state,
  onStopChange = () => {},
  playBell = () => {},
  onArmChange = () => {},
  onUse = () => {},
}) {
  let warnedRowKey = null;
  let armed = false;

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

  function setArmed(value) {
    armed = !!value;
    onArmChange(armed);
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
      setArmed(true);
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
      setArmed(false);
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
    setArmed(false);
  }

  function activateMarginRelease() {
    if (!state.realTypewriterEnabled) return;
    state.typewriterMarginRelease = true;
    setStop(false);
    setArmed(false);
    onUse();
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
      setArmed(false);
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
