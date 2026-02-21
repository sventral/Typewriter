import { clamp } from '../utils/math.js';

const DEFAULTS = Object.freeze({
  intentFloor: 0.12,
  horizontalIntentRatio: 1.22,
  verticalIntentRatio: 1.08,
  horizontalRelaxMs: 1300,
  horizontalGraceMs: 1350,
  verticalStreakWindowMs: 210,
  verticalEngageStreak: 2,
  verticalEngageHoldMs: 900,
  verticalReturnDelayMs: 110,
  returnLerp: 0.2,
  returnThresholdPx: 0.2,
  centerDeadZonePx: 0.22,
  baseHorizontalScale: 0.8,
  baseNeutralScale: 0.62,
  relaxedHorizontalScale: 0.93,
  relaxedNeutralScale: 0.8,
  grooveNeutralScale: 0.24,
  grooveAwayScaleMin: 0.25,
  grooveAwayScaleMax: 0.56,
  grooveTowardScaleMin: 0.5,
  grooveTowardScaleMax: 0.82,
  verticalCrossDeadZone: 1.2,
  verticalCrossAxisScale: 0.18,
  verticalCrossAxisRatio: 0.12,
  grooveSpacingVisualPx: 150,
  grooveSpacingMinPx: 26,
  grooveSpacingMaxPx: 180,
  grooveCenterCaptureVisualPx: 70,
  grooveSnapVisualPx: 8,
  centerGroovePullScale: 0.82,
  sideGroovePullScale: 0.93,
  pullScaleZoomRelax: 0.09,
  explicitVerticalReleaseMs: 140,
});

export function createPaperPanGrooveController(options = {}) {
  const {
    isEnabled = () => true,
    getPaperOffsetX = () => 0,
    getZoom = () => 1,
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
  let horizontalRelaxUntil = 0;
  let verticalEngagedUntil = 0;
  let verticalIntentStreak = 0;
  let lastVerticalIntentTs = 0;
  let activeGrooveX = 0;

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

  function autoReturnAllowed(ts = now()) {
    return ts >= inhibitReturnUntil;
  }

  function horizontalRelaxed(ts = now()) {
    return ts < horizontalRelaxUntil;
  }

  function grooveEngaged(ts = now()) {
    return ts < verticalEngagedUntil;
  }

  function currentZoom() {
    const zoom = Number(getZoom());
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  }

  function visualToPaperPx(visualPx, zoom = currentZoom()) {
    const safeZoom = Math.max(0.4, zoom);
    return visualPx / safeZoom;
  }

  function horizontalLimits() {
    const limits = getHorizontalLimits() || {};
    const minX = Number.isFinite(limits.minX) ? limits.minX : -1;
    const maxX = Number.isFinite(limits.maxX) ? limits.maxX : 1;
    if (minX <= maxX) {
      return { minX, maxX };
    }
    return { minX: maxX, maxX: minX };
  }

  function clampToLimits(x) {
    const { minX, maxX } = horizontalLimits();
    return clamp(Number.isFinite(x) ? x : 0, minX, maxX);
  }

  function grooveSpacingPx(zoom = currentZoom()) {
    const spacing = visualToPaperPx(cfg.grooveSpacingVisualPx, zoom);
    return clamp(spacing, cfg.grooveSpacingMinPx, cfg.grooveSpacingMaxPx);
  }

  function grooveCenterCapturePx(zoom = currentZoom(), spacingPx = grooveSpacingPx(zoom)) {
    const cap = visualToPaperPx(cfg.grooveCenterCaptureVisualPx, zoom);
    return clamp(cap, Math.min(spacingPx * 0.24, spacingPx), spacingPx * 0.8);
  }

  function grooveSnapPx(zoom = currentZoom()) {
    return Math.max(cfg.returnThresholdPx, visualToPaperPx(cfg.grooveSnapVisualPx, zoom));
  }

  function resolveNearestGrooveTarget(currentX, zoom = currentZoom()) {
    const clampedX = clampToLimits(currentX);
    const spacing = grooveSpacingPx(zoom);
    const centerCapture = grooveCenterCapturePx(zoom, spacing);
    if (Math.abs(clampedX) <= centerCapture) {
      return 0;
    }
    const index = Math.round(clampedX / spacing);
    const target = index * spacing;
    return clampToLimits(target);
  }

  function activeReturnTarget(ts = now()) {
    if (!grooveEngaged(ts)) return 0;
    activeGrooveX = clampToLimits(activeGrooveX);
    return activeGrooveX;
  }

  function suppressAutoReturn(durationMs = 650) {
    const duration = Math.max(0, Number(durationMs) || 0);
    inhibitReturnUntil = now() + duration;
    clearReturnMotion();
  }

  function startReturnAnimation() {
    if (!isEnabled()) return;
    if (!autoReturnAllowed()) return;
    stopReturnAnimation();

    const step = () => {
      returnFrameHandle = 0;
      if (!isEnabled()) return;
      if (!autoReturnAllowed()) return;
      const ts = now();
      const currentX = Number(getPaperOffsetX()) || 0;
      const targetX = activeReturnTarget(ts);
      const delta = currentX - targetX;
      if (Math.abs(delta) <= cfg.returnThresholdPx) {
        if (currentX !== targetX) setPaperOffsetX(targetX);
        return;
      }
      const nextX = targetX + delta * (1 - cfg.returnLerp);
      if (!Number.isFinite(nextX) || Math.abs(nextX - currentX) < 1e-4) {
        setPaperOffsetX(targetX);
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

  function applyHorizontalResistance(dx, currentX, scales) {
    const {
      centerScale = 1,
      awayMin = 1,
      awayMax = 1,
      towardMin = 1,
      towardMax = 1,
    } = scales || {};
    const absX = Math.abs(currentX);
    const norm = horizontalDistanceNorm(currentX);
    if (absX <= cfg.centerDeadZonePx) {
      return dx * centerScale;
    }
    // `setPaperOffset` applies `x - dx/zoom`, so `currentX * dx < 0` means moving further from center.
    const movingAwayFromCenter = currentX * dx < 0;
    if (movingAwayFromCenter) {
      const scale = awayMax - (awayMax - awayMin) * norm;
      return dx * clamp(scale, awayMin, awayMax);
    }
    const scale = towardMax - (towardMax - towardMin) * norm;
    return dx * clamp(scale, towardMin, towardMax);
  }

  function markHorizontalIntent(ts) {
    horizontalRelaxUntil = ts + cfg.horizontalRelaxMs;
    verticalIntentStreak = 0;
    verticalEngagedUntil = 0;
    activeGrooveX = clampToLimits(Number(getPaperOffsetX()) || 0);
  }

  function markVerticalIntent(ts, { explicit = false } = {}) {
    const wasEngaged = grooveEngaged(ts);
    if (explicit) {
      horizontalRelaxUntil = Math.min(horizontalRelaxUntil, ts + cfg.explicitVerticalReleaseMs);
      verticalIntentStreak = Math.max(verticalIntentStreak, cfg.verticalEngageStreak);
      lastVerticalIntentTs = ts;
    } else if (ts - lastVerticalIntentTs <= cfg.verticalStreakWindowMs) {
      verticalIntentStreak += 1;
      lastVerticalIntentTs = ts;
    } else {
      verticalIntentStreak = 1;
      lastVerticalIntentTs = ts;
    }
    if (verticalIntentStreak < cfg.verticalEngageStreak) return false;
    verticalEngagedUntil = ts + cfg.verticalEngageHoldMs;
    if (explicit || !wasEngaged) {
      activeGrooveX = resolveNearestGrooveTarget(Number(getPaperOffsetX()) || 0);
    }
    return true;
  }

  function applyVerticalGroovePull() {
    if (!isEnabled()) return;
    const ts = now();
    if (!autoReturnAllowed(ts)) return;
    if (horizontalRelaxed(ts)) return;
    if (!grooveEngaged(ts)) return;
    const zoom = currentZoom();
    const targetX = activeReturnTarget(ts);
    const currentX = Number(getPaperOffsetX()) || 0;
    const delta = currentX - targetX;
    const snapPx = grooveSnapPx(zoom);
    if (Math.abs(delta) <= snapPx) {
      if (currentX !== targetX) {
        setPaperOffsetX(targetX);
      }
      return;
    }
    const zoomBlend = clamp((zoom - 1) / 3, 0, 1);
    const baseScale = Math.abs(targetX) <= snapPx ? cfg.centerGroovePullScale : cfg.sideGroovePullScale;
    const scaledPull = clamp(baseScale + cfg.pullScaleZoomRelax * zoomBlend, 0, 0.985);
    setPaperOffsetX(targetX + delta * scaledPull);
  }

  function filterWheelDeltas(rawDx, rawDy) {
    const sourceDx = Number.isFinite(rawDx) ? rawDx : 0;
    const sourceDy = Number.isFinite(rawDy) ? rawDy : 0;
    const ts = now();
    if (!isEnabled()) {
      clearReturnMotion();
      verticalIntentStreak = 0;
      verticalEngagedUntil = 0;
      horizontalRelaxUntil = 0;
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
    if (horizontalIntent) {
      markHorizontalIntent(ts);
    } else if (!verticalIntent && ts - lastVerticalIntentTs > cfg.verticalStreakWindowMs * 1.5) {
      verticalIntentStreak = 0;
    }
    if (verticalIntent) {
      markVerticalIntent(ts);
    }

    const relaxed = horizontalRelaxed(ts);
    const grooveActive = !relaxed && grooveEngaged(ts);

    let dx = sourceDx;
    if (absX > cfg.intentFloor) {
      const currentX = Number(getPaperOffsetX()) || 0;
      if (horizontalIntent) {
        if (relaxed) {
          dx *= cfg.relaxedHorizontalScale;
        } else if (grooveActive) {
          dx = applyHorizontalResistance(dx, currentX, {
            centerScale: cfg.grooveNeutralScale,
            awayMin: cfg.grooveAwayScaleMin,
            awayMax: cfg.grooveAwayScaleMax,
            towardMin: cfg.grooveTowardScaleMin,
            towardMax: cfg.grooveTowardScaleMax,
          });
        } else {
          dx *= cfg.baseHorizontalScale;
        }
      } else if (grooveActive) {
        dx *= cfg.grooveNeutralScale;
      } else if (relaxed) {
        dx *= cfg.relaxedNeutralScale;
      } else {
        dx *= cfg.baseNeutralScale;
      }
    }

    if (verticalIntent && grooveActive) {
      const cutoff = Math.max(cfg.verticalCrossDeadZone, absY * cfg.verticalCrossAxisRatio);
      if (Math.abs(dx) <= cutoff) {
        dx = 0;
      } else {
        dx *= cfg.verticalCrossAxisScale;
      }
      scheduleReturn(cfg.verticalReturnDelayMs);
    } else if (horizontalIntent) {
      clearReturnMotion();
      scheduleReturn(cfg.horizontalGraceMs);
    }

    return {
      dx,
      dy: sourceDy,
      horizontalIntent,
      verticalIntent,
      pullToGroove: verticalIntent && grooveActive,
    };
  }

  function notifyVerticalIntent() {
    if (!isEnabled()) return;
    const ts = now();
    const engaged = markVerticalIntent(ts, { explicit: true });
    if (engaged) {
      scheduleReturn(cfg.verticalReturnDelayMs);
    }
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
