// LOWERED: Detect lag sooner. 100ms is enough to feel "sticky".
import { isSafari } from '../utils/platform.js';

const DEFAULT_THRESHOLD_MS = 100; 

// LOWERED: Drastically reduced from 60ms to 24ms. 
// This means a frame must be faster than ~40fps to count as "smooth". 
// If the browser is struggling to paint text (even if JS is idle), frames often hit 30-40ms.
// This setting forces the monitor to stay active during those heavy paint operations.
const DEFAULT_RECOVERY_THRESHOLD_MS = 24; 

// INCREASED: Wait 60 frames (approx 1 second) of continuous smooth performance.
const DEFAULT_RECOVERY_FRAMES = 60; 

const SAFARI_RECOVERY_THRESHOLD_MS = 36;
const SAFARI_RECOVERY_FRAMES = 40;
const SAFARI_CHECK_WINDOW_MS = 3200;
const SAFARI_AUTO_RECOVER_MS = 1400;

const MIN_ZOOM_FOR_NOTICE = 1.08;
const MIN_ZOOM_DELTA = 0.05;
const CHECK_WINDOW_MS = 6000;

function isBrowserEnvironment() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function ensureLagElement(app) {
  if (app?.lagNotice) return app.lagNotice;
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById('lagNotice');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'lagNotice';
  el.className = 'lag-notice';
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-hidden', 'true');
  if (document.body) {
    document.body.appendChild(el);
  }
  return el;
}

function createLagNotice(app) {
  const element = ensureLagElement(app);
  if (!element) return null;

  function hide({ immediate = false } = {}) {
    element.classList.remove('lag-notice--visible');
    element.setAttribute('aria-hidden', 'true');
    if (immediate) {
      element.textContent = '';
    }
  }

  const labelForZoom = (zoom) => {
    if (!Number.isFinite(zoom)) return 'zoom change';
    return `${Math.round(zoom * 100)}% zoom`;
  };

  function showPending({ zoom, reason }) {
    const zoomLabel = labelForZoom(zoom);
    const context = reason === 'zoom-redraw' ? 'rendering' : 'zoom';
    element.textContent = `Page resyncing (${zoomLabel} · preparing ${context})`;
    element.setAttribute('aria-hidden', 'false');
    element.classList.add('lag-notice--visible');
  }

  function showLag({ zoom, frameGapMs, via, reason }) {
    const zoomLabel = labelForZoom(zoom);
    const stallLabel = Number.isFinite(frameGapMs) ? `${Math.round(frameGapMs)}ms stall` : 'stall detected';
    const viaLabel = via === 'task' ? 'main thread task' : 'frame pacing';
    const context = reason === 'zoom-redraw' ? 'rendering' : 'zoom';
    element.textContent = `Page still resyncing (${stallLabel} · ${zoomLabel} · ${viaLabel} ${context})`;
    element.setAttribute('aria-hidden', 'false');
    element.classList.add('lag-notice--visible');
  }

  return { showPending, showLag, hide, node: element };
}

export function createZoomLagMonitor({
  app,
  thresholdMs = DEFAULT_THRESHOLD_MS,
  recoveryThresholdMs = DEFAULT_RECOVERY_THRESHOLD_MS,
  minZoom = MIN_ZOOM_FOR_NOTICE,
  minDelta = MIN_ZOOM_DELTA,
  checkWindowMs = CHECK_WINDOW_MS,
  recoveryFrameCount = DEFAULT_RECOVERY_FRAMES,
  isLagAssistEnabled,
  onLagStateChange,
} = {}) {
  if (!isBrowserEnvironment()) return null;
  if (typeof requestAnimationFrame !== 'function') return null;
  const notice = createLagNotice(app);
  if (!notice) return null;

  const safari = isSafari();
  const stallThreshold = thresholdMs;
  const recoveryThreshold = safari
    ? Math.max(recoveryThresholdMs, SAFARI_RECOVERY_THRESHOLD_MS)
    : recoveryThresholdMs;
  const recoveryFrames = safari
    ? Math.min(recoveryFrameCount, SAFARI_RECOVERY_FRAMES)
    : recoveryFrameCount;
  const monitorWindowMs = safari
    ? Math.min(checkWindowMs, SAFARI_CHECK_WINDOW_MS)
    : checkWindowMs;
  const autoRecoverMs = safari ? SAFARI_AUTO_RECOVER_MS : 0;

  const state = {
    disposed: false,
    rafHandle: 0,
    perfObserver: null,
    lastFrameTs: 0,
    lagActive: false,
    smoothFrames: 0,
    armedUntil: 0,
    cachedZoom: 1,
    lastReason: 'zoom',
    preLagActive: false,
    lastStallTs: 0,
  };

  const lagAssistEnabled = () => {
    if (typeof isLagAssistEnabled === 'function') {
      try {
        return !!isLagAssistEnabled();
      } catch (err) {
        return true;
      }
    }
    return true;
  };

  const longTaskSupported =
    typeof PerformanceObserver === 'function'
    && Array.isArray(PerformanceObserver.supportedEntryTypes)
    && PerformanceObserver.supportedEntryTypes.includes('longtask');
  const emitLagState = (phase) => {
    if (typeof onLagStateChange === 'function') {
      onLagStateChange(phase);
    }
  };

  function isArmed(ts = now()) {
    return state.armedUntil && ts <= state.armedUntil;
  }

  function cancelRaf() {
    if (state.rafHandle && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(state.rafHandle);
    }
    state.rafHandle = 0;
  }

  function disconnectObserver() {
    if (state.perfObserver) {
      state.perfObserver.disconnect();
      state.perfObserver = null;
    }
  }

  function hideNotice(immediate = false) {
    state.lagActive = false;
    state.preLagActive = false;
    state.smoothFrames = 0;
    state.lastStallTs = 0;
    notice.hide({ immediate });
    emitLagState('idle');
  }

  function stopWatchersIfIdle() {
    if (state.lagActive || isArmed()) {
      return;
    }
    cancelRaf();
    disconnectObserver();
    state.lastFrameTs = 0;
    if (state.preLagActive) {
      hideNotice();
    }
  }

  function ensurePerformanceObserver() {
    if (!lagAssistEnabled()) return;
    if (!longTaskSupported || state.perfObserver) return;
    try {
      state.perfObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          const startTs = entry.startTime;
          const endTs = startTs + entry.duration;
          if (!state.lagActive && !isArmed(endTs)) {
            return;
          }
          recordStall({ duration: entry.duration, via: 'task' });
        });
      });
      state.perfObserver.observe({ entryTypes: ['longtask'] });
    } catch (err) {
      state.perfObserver = null;
    }
  }

  function scheduleLoop() {
    if (state.rafHandle || typeof requestAnimationFrame !== 'function') return;
    state.rafHandle = requestAnimationFrame(step);
  }

  function recordStall({ duration, via = 'frame' }) {
    const ms = Number.isFinite(duration) && duration > 0 ? duration : thresholdMs;
    state.lagActive = true;
    state.preLagActive = false;
    state.smoothFrames = 0;
    state.lastStallTs = now();
    notice.showLag({
      zoom: state.cachedZoom,
      frameGapMs: ms,
      via,
      reason: state.lastReason,
    });
    emitLagState('lag');
  }

  function handleRecovery(gap) {
    if (!state.lagActive) return;
    if (gap <= recoveryThreshold) {
      state.smoothFrames += 1;
      if (state.smoothFrames >= recoveryFrames) {
        hideNotice();
        // We’re back to stable; drop the armed window early to avoid
        // running RAF/perf observers for the full checkWindowMs.
        state.armedUntil = 0;
        stopWatchersIfIdle();
      }
    } else {
      state.smoothFrames = 0;
    }
  }

  function step(timestamp) {
    if (state.disposed) return;
    if (!lagAssistEnabled()) {
      resetLoop();
      return;
    }
    state.rafHandle = 0;
    const armed = isArmed();
    if (!state.lagActive && !armed) {
      state.lastFrameTs = timestamp;
      stopWatchersIfIdle();
      return;
    }
    if (!state.lastFrameTs) {
      state.lastFrameTs = timestamp;
      scheduleLoop();
      return;
    }
    const gap = timestamp - state.lastFrameTs;
    state.lastFrameTs = timestamp;
    if (armed && gap >= stallThreshold) {
      recordStall({ duration: gap, via: 'frame' });
    } else {
      handleRecovery(gap);
    }
    if (autoRecoverMs) {
      const sinceStall = state.lastStallTs ? timestamp - state.lastStallTs : 0;
      if (state.lagActive && sinceStall >= autoRecoverMs) {
        hideNotice();
        state.armedUntil = 0;
        stopWatchersIfIdle();
        return;
      }
    }
    scheduleLoop();
  }

  function resetLoop() {
    cancelRaf();
    disconnectObserver();
    state.lastFrameTs = 0;
    hideNotice(true);
    state.armedUntil = 0;
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      resetLoop();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);

  function trackZoomEvent({ zoom, delta = 0, reason = 'zoom-change' } = {}) {
    if (state.disposed) return;
    if (!lagAssistEnabled()) {
      resetLoop();
      return;
    }
    const numericZoom = Number.isFinite(zoom) ? zoom : state.cachedZoom;
    const deltaAbs = Number.isFinite(delta) ? Math.abs(delta) : 0;

    // Always monitor explicit redraws regardless of zoom level or delta.
    // For interactive scrubbing ('zoom-change'), ignore small deltas at low zoom to reduce noise.
    const forceMonitor = reason === 'zoom-redraw';
    if (!forceMonitor && numericZoom < minZoom && deltaAbs < minDelta) return;
    if (numericZoom > 0) {
      state.cachedZoom = numericZoom;
    }
    state.lastReason = reason;
    state.armedUntil = Math.max(state.armedUntil, now() + monitorWindowMs);
    state.preLagActive = true;
    notice.showPending({ zoom: state.cachedZoom, reason: state.lastReason });
    emitLagState('pending');
    ensurePerformanceObserver();
    scheduleLoop();
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    resetLoop();
  }

  function syncEnabledState() {
    if (!lagAssistEnabled()) {
      resetLoop();
    }
  }

  if (typeof window !== 'undefined') {
    window.__typewriterLagMonitor = {
      trackZoomEvent,
      dispose,
      syncEnabledState,
      debug: () => ({ ...state }),
    };
  }

  return { trackZoomEvent, dispose, syncEnabledState };
}
