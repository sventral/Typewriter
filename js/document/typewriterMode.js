import { clamp } from '../utils/math.js';

export function createTypewriterMode({
  state,
  onStopChange = () => {},
  playBell = () => {},
  onArmChange = () => {},
  onUse = () => {},
  onStopSound = () => {},
}) {
  let warnedRowKey = null;
  let armed = false;
  let lastCaretKey = null;
  let lastCaretCol = null;

  const rowKey = () => `${state.caret?.page ?? 0}:${state.caret?.rowMu ?? 0}`;

  function clearWarningIfRowChanged(currentKey) {
    if (!currentKey) return;
    if (warnedRowKey && warnedRowKey !== currentKey) {
      warnedRowKey = null;
    }
    if (lastCaretKey && lastCaretKey !== currentKey) {
      lastCaretCol = null;
    }
  }

  function setStop(active) {
    onStopChange(!!active);
  }

  function setArmed(value) {
    armed = !!value;
    onArmChange(armed);
  }

  function clearWarnings() {
    warnedRowKey = null;
    lastCaretCol = null;
    lastCaretKey = null;
  }

  function marginLeadThreshold(bounds) {
    const lead = clamp(Math.round(Number(state.realTypewriterBellLead ?? 0)), 0, 40);
    if (lead <= 0) return null;
    const rightLimit = Number.isFinite(bounds?.Rstrict) ? bounds.Rstrict : bounds.R;
    return Math.max(bounds.L, rightLimit - lead + 1);
  }

  function isCaretInLead(bounds) {
    const threshold = marginLeadThreshold(bounds);
    if (threshold == null) return false;
    return state.caret.col >= threshold;
  }

  function isInMarginZone(bounds) {
    const rightLimit = Number.isFinite(bounds?.Rstrict) ? bounds.Rstrict : bounds.R;
    return isCaretInLead(bounds) || state.caret.col >= rightLimit;
  }

  function maybeRingBell(bounds) {
    const threshold = marginLeadThreshold(bounds);
    if (threshold == null) return;
    const key = rowKey();
    clearWarningIfRowChanged(key);
    if (warnedRowKey === key) {
      lastCaretKey = key;
      lastCaretCol = state.caret.col;
      return;
    }

    const previousCol = lastCaretKey === key ? lastCaretCol : null;
    const movedForward = Number.isFinite(previousCol) && state.caret.col > previousCol;
    const crossedIntoLead = movedForward && previousCol < threshold && state.caret.col >= threshold;
    if (crossedIntoLead) {
      warnedRowKey = key;
      if (state.realTypewriterEnabled && state.realTypewriterBellEnabled) {
        playBell(state.realTypewriterBellSound, state.realTypewriterBellVolume);
      }
      setArmed(true);
    }
    lastCaretKey = key;
    lastCaretCol = state.caret.col;
  }

  function shouldHoldAtMargin(nextCol, bounds) {
    if (!state.realTypewriterEnabled) return false;
    if (state.typewriterMarginRelease) return false;
    if (nextCol > bounds.R) {
      setStop(true);
      onStopSound();
      return true;
    }
    return false;
  }

  function afterCaretMove(bounds) {
    const inMarginZone = isInMarginZone(bounds);

    if (state.typewriterMarginRelease && !inMarginZone) {
      state.typewriterMarginRelease = false;
      clearWarnings();
    }

    maybeRingBell(bounds);

    const atStop = !state.typewriterMarginRelease && state.caret.col >= bounds.R;
    const shouldArm = !state.typewriterMarginRelease && inMarginZone;

    if (state.realTypewriterEnabled) {
      setStop(atStop);
    } else {
      setStop(false);
    }

    setArmed(shouldArm);
  }

  function resetForNewLine() {
    state.typewriterMarginRelease = false;
    clearWarnings();
    setStop(false);
    setArmed(false);
  }

  function activateMarginRelease() {
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
      lastCaretCol = null;
      lastCaretKey = null;
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
