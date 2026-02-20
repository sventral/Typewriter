const CHROME_HIDE_DELAY_MS = 680;
const MOUSE_MOVE_THRESHOLD_PX = 3;
const TARGET_REVEAL_IDLE_MS = 1800;
const POINTER_HISTORY_WINDOW_MS = 1600;
const ERRATIC_MIN_DISTANCE_PX = 260;
const ERRATIC_MIN_DIRECTION_CHANGES = 4;
const ERRATIC_MIN_QUADRANT_COUNT = 3;
const ERRATIC_DIRECTION_CHANGE_DEG = 68;
const TARGET_ZONE_EDGE_X_PX = 230;
const TARGET_ZONE_EDGE_Y_TOP_PX = 200;
const TARGET_ZONE_EDGE_Y_BOTTOM_PX = 240;
const TARGET_INTENT_MIN_DISTANCE_PX = 7;
const RESTORE_PHASE_MS = 340;

const TARGET_IDS = Object.freeze({
  docs: 'docs',
  rulers: 'rulers',
  zoom: 'zoom',
  ink: 'ink',
});

const TARGET_CLASS_BY_ID = Object.freeze({
  [TARGET_IDS.docs]: 'distraction-free-mode-target-docs',
  [TARGET_IDS.rulers]: 'distraction-free-mode-target-rulers',
  [TARGET_IDS.zoom]: 'distraction-free-mode-target-zoom',
  [TARGET_IDS.ink]: 'distraction-free-mode-target-ink',
});

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function angleBetweenVectors(a, b) {
  if (!a || !b) return 0;
  if (!Number.isFinite(a.mag) || !Number.isFinite(b.mag) || a.mag <= 0 || b.mag <= 0) {
    return 0;
  }
  const dot = a.dx * b.dx + a.dy * b.dy;
  const ratio = clamp(dot / (a.mag * b.mag), -1, 1);
  return Math.acos(ratio);
}

export function createDistractionFreeModeController({
  state,
  applyAppearance = () => {},
  onModeDisabled = () => {},
}) {
  let hideTimer = 0;
  let targetRevealTimer = 0;
  let restorePhaseTimer = 0;
  let chromeHidden = false;
  let listenersBound = false;
  let lastMouseX = null;
  let lastMouseY = null;
  let activeTarget = '';
  const pointerTrail = [];

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

  function clearTargetRevealTimer() {
    if (!targetRevealTimer) return;
    clearTimeout(targetRevealTimer);
    targetRevealTimer = 0;
  }

  function clearRestorePhase({ removeClass = true } = {}) {
    if (restorePhaseTimer) {
      clearTimeout(restorePhaseTimer);
      restorePhaseTimer = 0;
    }
    if (!removeClass) return;
    const body = document.body;
    body?.classList.remove('distraction-free-mode-restoring');
  }

  function resetPointerHistory() {
    pointerTrail.length = 0;
    lastMouseX = null;
    lastMouseY = null;
  }

  function getViewportSize() {
    const doc = document.documentElement;
    const width = Math.max(1, window.innerWidth || doc?.clientWidth || 1);
    const height = Math.max(1, window.innerHeight || doc?.clientHeight || 1);
    return { width, height };
  }

  function inferTargetByPosition(x, y, width, height) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return '';
    if (x <= TARGET_ZONE_EDGE_X_PX && y <= TARGET_ZONE_EDGE_Y_TOP_PX) {
      return TARGET_IDS.docs;
    }
    if (x <= TARGET_ZONE_EDGE_X_PX && y >= (height - TARGET_ZONE_EDGE_Y_BOTTOM_PX)) {
      return TARGET_IDS.rulers;
    }
    if (x >= (width - TARGET_ZONE_EDGE_X_PX) && y <= TARGET_ZONE_EDGE_Y_TOP_PX) {
      return TARGET_IDS.zoom;
    }
    if (x >= (width - TARGET_ZONE_EDGE_X_PX) && y >= (height - TARGET_ZONE_EDGE_Y_BOTTOM_PX)) {
      return TARGET_IDS.ink;
    }
    return '';
  }

  function getTargetAnchor(id, width, height) {
    const insetX = 56;
    const insetY = 64;
    if (id === TARGET_IDS.docs) return { x: insetX, y: insetY };
    if (id === TARGET_IDS.rulers) return { x: insetX, y: Math.max(insetY, height - 74) };
    if (id === TARGET_IDS.zoom) return { x: Math.max(insetX, width - 56), y: insetY };
    return { x: Math.max(insetX, width - 56), y: Math.max(insetY, height - 82) };
  }

  function prunePointerTrail(ts) {
    while (pointerTrail.length && (ts - pointerTrail[0].ts) > POINTER_HISTORY_WINDOW_MS) {
      pointerTrail.shift();
    }
  }

  function pushPointerSample(x, y) {
    const ts = nowMs();
    if (!Number.isFinite(lastMouseX) || !Number.isFinite(lastMouseY)) {
      lastMouseX = x;
      lastMouseY = y;
      prunePointerTrail(ts);
      return null;
    }
    const dx = x - lastMouseX;
    const dy = y - lastMouseY;
    const mag = Math.hypot(dx, dy);
    lastMouseX = x;
    lastMouseY = y;
    if (!Number.isFinite(mag) || mag < MOUSE_MOVE_THRESHOLD_PX) {
      prunePointerTrail(ts);
      return null;
    }
    const sample = { x, y, dx, dy, mag, ts };
    pointerTrail.push(sample);
    prunePointerTrail(ts);
    return sample;
  }

  function inferTargetFromMovement(sample) {
    if (!sample) return '';
    const { width, height } = getViewportSize();
    const zoneTarget = inferTargetByPosition(sample.x, sample.y, width, height);
    if (zoneTarget) return zoneTarget;
    if (sample.mag < TARGET_INTENT_MIN_DISTANCE_PX) return '';

    const prevX = sample.x - sample.dx;
    const prevY = sample.y - sample.dy;
    let bestTarget = '';
    let bestScore = -Infinity;
    const targetValues = Object.values(TARGET_IDS);
    for (let i = 0; i < targetValues.length; i += 1) {
      const targetId = targetValues[i];
      const anchor = getTargetAnchor(targetId, width, height);
      const toAnchorX = anchor.x - prevX;
      const toAnchorY = anchor.y - prevY;
      const beforeDistance = Math.hypot(toAnchorX, toAnchorY);
      if (!Number.isFinite(beforeDistance) || beforeDistance <= 0.5) {
        return targetId;
      }
      const afterDistance = Math.hypot(anchor.x - sample.x, anchor.y - sample.y);
      const directionScore = (sample.dx * toAnchorX + sample.dy * toAnchorY) / (sample.mag * beforeDistance);
      const approachScore = (beforeDistance - afterDistance) / sample.mag;
      if (directionScore < 0.42 || approachScore < 0.14) continue;
      const score = (directionScore * 0.65) + (approachScore * 0.35);
      if (score > bestScore) {
        bestScore = score;
        bestTarget = targetId;
      }
    }
    return bestScore >= 0.48 ? bestTarget : '';
  }

  function countVisitedQuadrants() {
    const { width, height } = getViewportSize();
    const midX = width / 2;
    const midY = height / 2;
    const visited = new Set();
    for (let i = 0; i < pointerTrail.length; i += 1) {
      const sample = pointerTrail[i];
      const east = sample.x >= midX ? 1 : 0;
      const south = sample.y >= midY ? 1 : 0;
      visited.add((south * 2) + east);
    }
    return visited.size;
  }

  function pointerMovementIsErratic() {
    if (pointerTrail.length < 6) return false;
    let totalDistance = 0;
    for (let i = 0; i < pointerTrail.length; i += 1) {
      totalDistance += pointerTrail[i].mag;
    }
    if (totalDistance < ERRATIC_MIN_DISTANCE_PX) return false;

    const minDirectionChangeRad = (ERRATIC_DIRECTION_CHANGE_DEG * Math.PI) / 180;
    let directionChanges = 0;
    for (let i = 1; i < pointerTrail.length; i += 1) {
      const prev = pointerTrail[i - 1];
      const curr = pointerTrail[i];
      const delta = angleBetweenVectors(prev, curr);
      if (delta >= minDirectionChangeRad) directionChanges += 1;
    }
    if (directionChanges < ERRATIC_MIN_DIRECTION_CHANGES) return false;
    return countVisitedQuadrants() >= ERRATIC_MIN_QUADRANT_COUNT;
  }

  function shouldKeepTargetVisible(targetId) {
    if (targetId === TARGET_IDS.docs) {
      return !!(document.querySelector('.ink-file-toolbar.ink-file-toolbar--open')
        || document.querySelector('#inkFileDocMenuPopup.open'));
    }
    if (targetId === TARGET_IDS.ink) {
      return !!document.querySelector('#inkSettingsPanel.is-open');
    }
    return false;
  }

  function scheduleTargetRevealClear() {
    clearTargetRevealTimer();
    if (!activeTarget || !chromeHidden || !isModeEnabled()) return;
    targetRevealTimer = setTimeout(() => {
      targetRevealTimer = 0;
      if (!activeTarget || !chromeHidden || !isModeEnabled()) return;
      if (shouldKeepTargetVisible(activeTarget)) {
        scheduleTargetRevealClear();
        return;
      }
      activeTarget = '';
      applyClassState();
    }, TARGET_REVEAL_IDLE_MS);
  }

  function beginRestorePhase() {
    const body = document.body;
    if (!body) return;
    clearRestorePhase({ removeClass: false });
    body.classList.add('distraction-free-mode-restoring');
    restorePhaseTimer = setTimeout(() => {
      restorePhaseTimer = 0;
      document.body?.classList.remove('distraction-free-mode-restoring');
    }, RESTORE_PHASE_MS);
  }

  function applyClassState() {
    const body = document.body;
    if (!body) return;
    const enabled = isModeEnabled();
    const hideChrome = enabled && chromeHidden;
    body.classList.toggle('distraction-free-mode-enabled', enabled);
    body.classList.toggle('distraction-free-mode-hidden', hideChrome);
    body.classList.toggle('distraction-free-mode-background-hidden', shouldHideBackground());
    const targetValues = Object.values(TARGET_IDS);
    for (let i = 0; i < targetValues.length; i += 1) {
      const id = targetValues[i];
      body.classList.toggle(TARGET_CLASS_BY_ID[id], hideChrome && activeTarget === id);
    }
    if (!enabled) {
      clearRestorePhase();
    }
  }

  function setTargetReveal(targetId) {
    const normalized = TARGET_CLASS_BY_ID[targetId] ? targetId : '';
    if (activeTarget === normalized) {
      if (normalized) scheduleTargetRevealClear();
      return;
    }
    activeTarget = normalized;
    if (activeTarget) {
      scheduleTargetRevealClear();
    } else {
      clearTargetRevealTimer();
    }
    applyClassState();
  }

  function setChromeHidden(value, { restored = false } = {}) {
    const hidden = !!value;
    if (chromeHidden === hidden) return;
    chromeHidden = hidden;
    clearHideTimer();
    clearTargetRevealTimer();
    activeTarget = '';
    resetPointerHistory();
    if (restored) {
      beginRestorePhase();
    } else if (!hidden) {
      clearRestorePhase();
    }
    applyClassState();
    if (typeof applyAppearance === 'function') {
      applyAppearance();
    }
  }

  function restoreChrome({ restored = false } = {}) {
    clearHideTimer();
    setChromeHidden(false, { restored });
  }

  function scheduleChromeHide() {
    if (!isModeEnabled()) return;
    if (hideTimer) return;
    hideTimer = setTimeout(() => {
      hideTimer = 0;
      if (!isModeEnabled()) return;
      setTargetReveal('');
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
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const sample = pushPointerSample(x, y);
    if (!sample || !chromeHidden) return;

    const targetId = inferTargetFromMovement(sample);
    if (targetId) {
      setTargetReveal(targetId);
      return;
    }
    if (pointerMovementIsErratic()) {
      restoreChrome({ restored: true });
    }
  }

  function handleMouseAction(event) {
    if (!isModeEnabled()) return;
    if (!isMousePointerEvent(event)) return;
    if (!chromeHidden) return;
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const { width, height } = getViewportSize();
    const targetId = inferTargetByPosition(x, y, width, height);
    if (targetId) {
      setTargetReveal(targetId);
    }
  }

  function handleShortcutKeydown(event) {
    if (!isModeEnabled()) return;
    const isEscape = event?.key === 'Escape' || event?.key === 'Esc';
    if (!event?.metaKey || !isEscape) return;
    event.preventDefault();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    } else if (typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
    state.distractionFreeModeEnabled = false;
    clearHideTimer();
    clearTargetRevealTimer();
    setChromeHidden(false, { restored: true });
    applyClassState();
    if (typeof applyAppearance === 'function') {
      applyAppearance();
    }
    if (typeof onModeDisabled === 'function') {
      onModeDisabled({ reason: 'shortcut' });
    }
  }

  function syncDistractionFreeModeState() {
    if (!isModeEnabled()) {
      clearHideTimer();
      clearTargetRevealTimer();
      setChromeHidden(false);
      resetPointerHistory();
      clearRestorePhase();
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
    window.addEventListener('keydown', handleShortcutKeydown, { capture: true });
    window.addEventListener('blur', () => restoreChrome({ restored: false }), { passive: true });
    syncDistractionFreeModeState();
  }

  return {
    bindDistractionFreeListeners,
    syncDistractionFreeModeState,
    notifyTypingActivity: scheduleChromeHide,
  };
}
