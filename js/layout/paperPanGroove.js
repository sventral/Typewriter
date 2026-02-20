import { clamp } from '../utils/math.js';

const DEFAULTS = Object.freeze({
  intentFloor: 0.12,
  horizontalIntentRatio: 1.3,
  verticalIntentRatio: 1.0,
  graceMs: 520,
  verticalReturnDelayMs: 70,
  returnLerp: 0.32,
  returnThresholdPx: 0.18,
  centerDeadZonePx: 0.2,
  neutralScale: 0.12,
  awayScaleMin: 0.08,
  awayScaleMax: 0.28,
  towardScaleMin: 0.26,
  towardScaleMax: 0.52,
  verticalCenterSnapPx: 2.4,
  verticalPullScale: 0.58,
});

export function createPaperPanGrooveController(options = {}) {
  const {
    isEnabled = () => true,
    getPaperOffsetX = () => 0,
    getHorizontalLimits = () => ({ minX: -1, maxX: 1 }),
    setPaperOffsetX = () => {},
    requestFrame = (cb) => (
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(cb)
        : setTimeout(() => cb(Date.now()), 16)
    ),
    cancelFrame = (id) => (
      typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame(id)
        : clearTimeout(id)
    ),
    scheduleTimer = (cb, delayMs) => setTimeout(cb, delayMs),
    clearTimer = (id) => clearTimeout(id),
    now = () => Date.now(),
    config = {},
  } = options;

  const cfg = { ...DEFAULTS, ...(config || {}) };
  let returnFrameHandle = 0;
  let returnTimerHandle = 0;
  let inhibitReturnUntil = 0;

  function clearPendingReturnTimer() {
    if (!returnTimerHandle) return;
    clearTimer(returnTimerHandle);
    returnTimerHandle = 0;
  }

  function stopReturnAnimation() {
    if (!returnFrameHandle) return;
    cancelFrame(returnFrameHandle);
    returnFrameHandle = 0;
  }

  function clearReturnMotion() {
    clearPendingReturnTimer();
    stopReturnAnimation();
  }

  function autoReturnAllowed() {
    return now() >= inhibitReturnUntil;
  }

  function suppressAutoReturn(durationMs = 650) {
    const duration = Math.max(0, Number(durationMs) || 0);
    inhibitReturnUntil = now() + duration;
    clearReturnMotion();
  }

  function nearCenter(x) {
    return Math.abs(x) <= cfg.returnThresholdPx;
  }

  function startReturnAnimation() {
    if (!isEnabled()) return;
    if (!autoReturnAllowed()) return;
    stopReturnAnimation();

    const step = () => {
      returnFrameHandle = 0;
      if (!isEnabled()) return;
      if (!autoReturnAllowed()) return;
      const currentX = Number(getPaperOffsetX()) || 0;
      if (nearCenter(currentX)) {
        if (currentX !== 0) setPaperOffsetX(0);
        return;
      }
      const nextX = currentX * (1 - cfg.returnLerp);
      if (!Number.isFinite(nextX) || Math.abs(nextX - currentX) < 1e-4) {
        setPaperOffsetX(0);
        return;
      }
      setPaperOffsetX(nextX);
      returnFrameHandle = requestFrame(step);
    };

    returnFrameHandle = requestFrame(step);
  }

  function scheduleReturn(delayMs) {
    if (!isEnabled()) return;
    if (!autoReturnAllowed()) return;
    const delay = Math.max(0, Number(delayMs) || 0);
    clearPendingReturnTimer();
    if (delay <= 0) {
      startReturnAnimation();
      return;
    }
    returnTimerHandle = scheduleTimer(() => {
      returnTimerHandle = 0;
      startReturnAnimation();
    }, delay);
  }

  function horizontalDistanceNorm(currentX) {
    const limits = getHorizontalLimits() || {};
    const minX = Number.isFinite(limits.minX) ? limits.minX : 0;
    const maxX = Number.isFinite(limits.maxX) ? limits.maxX : 0;
    const span = Math.max(1, Math.abs(minX), Math.abs(maxX));
    return clamp(Math.abs(currentX) / span, 0, 1);
  }

  function applyHorizontalResistance(dx, currentX) {
    const absX = Math.abs(currentX);
    const norm = horizontalDistanceNorm(currentX);
    if (absX <= cfg.centerDeadZonePx) {
      return dx * cfg.neutralScale;
    }
    // `setPaperOffset` applies `x - dx/zoom`, so `currentX * dx < 0` means moving further from center.
    const movingAwayFromCenter = currentX * dx < 0;
    if (movingAwayFromCenter) {
      const scale = cfg.awayScaleMax - (cfg.awayScaleMax - cfg.awayScaleMin) * norm;
      return dx * clamp(scale, cfg.awayScaleMin, cfg.awayScaleMax);
    }
    const scale = cfg.towardScaleMax - (cfg.towardScaleMax - cfg.towardScaleMin) * norm;
    return dx * clamp(scale, cfg.towardScaleMin, cfg.towardScaleMax);
  }

  function applyVerticalGroovePull() {
    if (!isEnabled()) return;
    if (!autoReturnAllowed()) return;
    const currentX = Number(getPaperOffsetX()) || 0;
    const absX = Math.abs(currentX);
    if (absX <= cfg.verticalCenterSnapPx) {
      if (absX > cfg.returnThresholdPx) {
        setPaperOffsetX(0);
      }
      return;
    }
    setPaperOffsetX(currentX * cfg.verticalPullScale);
  }

  function filterWheelDeltas(rawDx, rawDy) {
    const sourceDx = Number.isFinite(rawDx) ? rawDx : 0;
    const sourceDy = Number.isFinite(rawDy) ? rawDy : 0;
    if (!isEnabled()) {
      clearReturnMotion();
      return {
        dx: sourceDx,
        dy: sourceDy,
        horizontalIntent: false,
        verticalIntent: false,
        pullToGroove: false,
      };
    }

    const absX = Math.abs(sourceDx);
    const absY = Math.abs(sourceDy);
    const horizontalIntent = absX >= cfg.intentFloor && absX > absY * cfg.horizontalIntentRatio;
    const verticalIntent = absY >= cfg.intentFloor && absY >= absX * cfg.verticalIntentRatio;

    let dx = sourceDx;
    if (absX > cfg.intentFloor) {
      const currentX = Number(getPaperOffsetX()) || 0;
      dx = horizontalIntent
        ? applyHorizontalResistance(dx, currentX)
        : dx * cfg.neutralScale;
    }

    if (verticalIntent) {
      dx = 0;
      scheduleReturn(cfg.verticalReturnDelayMs);
    } else if (horizontalIntent) {
      clearReturnMotion();
      scheduleReturn(cfg.graceMs);
    }

    return {
      dx,
      dy: sourceDy,
      horizontalIntent,
      verticalIntent,
      pullToGroove: verticalIntent,
    };
  }

  function notifyVerticalIntent() {
    if (!isEnabled()) return;
    scheduleReturn(cfg.verticalReturnDelayMs);
  }

  function syncEnabledState() {
    if (isEnabled()) return;
    clearReturnMotion();
  }

  return {
    filterWheelDeltas,
    notifyVerticalIntent,
    applyVerticalGroovePull,
    suppressAutoReturn,
    syncEnabledState,
    dispose: clearReturnMotion,
  };
}
