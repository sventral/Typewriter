const DEFAULT_THRESHOLD_MS = 180;
const DEFAULT_RECOVERY_THRESHOLD_MS = 60;
const DEFAULT_RECOVERY_FRAMES = 3;
const MIN_ZOOM_FOR_NOTICE = 1.08;
const MIN_ZOOM_DELTA = 0.05;
const CHECK_WINDOW_MS = 3000;

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

  const longTaskSupported = typeof PerformanceObserver === 'function';
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
    if (gap <= recoveryThresholdMs) {
      state.smoothFrames += 1;
      if (state.smoothFrames >= recoveryFrameCount) {
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
    if (armed && gap >= thresholdMs) {
      recordStall({ duration: gap, via: 'frame' });
    } else {
      handleRecovery(gap);
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
    if (numericZoom < minZoom && deltaAbs < minDelta) return;
    if (numericZoom > 0) {
      state.cachedZoom = numericZoom;
    }
    state.lastReason = reason;
    state.armedUntil = Math.max(state.armedUntil, now() + checkWindowMs);
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
