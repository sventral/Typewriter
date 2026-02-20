const CHROME_HIDE_DELAY_MS = 680;
const MOUSE_MOVE_THRESHOLD_PX = 2;

export function createDistractionFreeModeController({ state }) {
  let hideTimer = 0;
  let chromeHidden = false;
  let listenersBound = false;
  let lastMouseX = null;
  let lastMouseY = null;

  function isModeEnabled() {
    return state?.distractionFreeModeEnabled === true;
  }

  function shouldHideBackground() {
    return isModeEnabled()
      && chromeHidden
      && state?.distractionFreeHideBackgroundEnabled === true;
  }

  function clearHideTimer() {
    if (!hideTimer) return;
    clearTimeout(hideTimer);
    hideTimer = 0;
  }

  function applyClassState() {
    const body = document.body;
    if (!body) return;
    const enabled = isModeEnabled();
    const hideChrome = enabled && chromeHidden;
    body.classList.toggle('distraction-free-mode-enabled', enabled);
    body.classList.toggle('distraction-free-mode-hidden', hideChrome);
    body.classList.toggle('distraction-free-mode-background-hidden', shouldHideBackground());
  }

  function setChromeHidden(value) {
    const hidden = !!value;
    if (chromeHidden === hidden) return;
    chromeHidden = hidden;
    applyClassState();
  }

  function revealChrome() {
    clearHideTimer();
    setChromeHidden(false);
  }

  function scheduleChromeHide() {
    if (!isModeEnabled()) return;
    if (chromeHidden || hideTimer) return;
    hideTimer = setTimeout(() => {
      hideTimer = 0;
      if (!isModeEnabled()) return;
      setChromeHidden(true);
    }, CHROME_HIDE_DELAY_MS);
  }

  function isMousePointerEvent(event) {
    if (!event) return false;
    if (typeof event.pointerType !== 'string' || event.pointerType === '') return true;
    return event.pointerType === 'mouse';
  }

  function handleMouseMove(event) {
    if (!isModeEnabled()) return;
    if (!isMousePointerEvent(event)) return;
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      revealChrome();
      return;
    }
    if (Number.isFinite(lastMouseX) && Number.isFinite(lastMouseY)) {
      const moved = Math.abs(x - lastMouseX) >= MOUSE_MOVE_THRESHOLD_PX
        || Math.abs(y - lastMouseY) >= MOUSE_MOVE_THRESHOLD_PX;
      lastMouseX = x;
      lastMouseY = y;
      if (!moved) return;
      revealChrome();
      return;
    }
    lastMouseX = x;
    lastMouseY = y;
    revealChrome();
  }

  function handleMouseAction(event) {
    if (!isModeEnabled()) return;
    if (!isMousePointerEvent(event)) return;
    revealChrome();
  }

  function syncDistractionFreeModeState() {
    if (!isModeEnabled()) {
      clearHideTimer();
      setChromeHidden(false);
    }
    applyClassState();
  }

  function bindDistractionFreeListeners() {
    if (listenersBound) return;
    listenersBound = true;
    window.addEventListener('pointermove', handleMouseMove, { passive: true });
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('pointerdown', handleMouseAction, { passive: true });
    window.addEventListener('mousedown', handleMouseAction, { passive: true });
    window.addEventListener('wheel', handleMouseAction, { passive: true });
    window.addEventListener('blur', revealChrome, { passive: true });
    syncDistractionFreeModeState();
  }

  return {
    bindDistractionFreeListeners,
    syncDistractionFreeModeState,
    notifyTypingActivity: scheduleChromeHide,
  };
}
