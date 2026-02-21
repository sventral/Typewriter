function normalizeAngleRadians(angleDeg) {
  const raw = Number(angleDeg);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  const radians = (raw * Math.PI) / 180;
  if (!Number.isFinite(radians) || Math.abs(radians) < 1e-9) return 0;
  return radians;
}

function normalizeCenter(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

export function projectPointWithLineSlant({ x, y, angleDeg, centerX, centerY }) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return { x: 0, y: 0 };
  }
  const angleRad = normalizeAngleRadians(angleDeg);
  if (angleRad === 0) return { x: px, y: py };
  const cx = normalizeCenter(centerX, 0);
  const cy = normalizeCenter(centerY, 0);
  const dx = px - cx;
  const dy = py - cy;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  return {
    x: dx * cosA - dy * sinA + cx,
    y: dx * sinA + dy * cosA + cy,
  };
}

export function unprojectPointWithLineSlant({ x, y, angleDeg, centerX, centerY }) {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return { x: 0, y: 0 };
  }
  const angleRad = normalizeAngleRadians(angleDeg);
  if (angleRad === 0) return { x: px, y: py };
  const cx = normalizeCenter(centerX, 0);
  const cy = normalizeCenter(centerY, 0);
  const dx = px - cx;
  const dy = py - cy;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  return {
    x: dx * cosA + dy * sinA + cx,
    y: -dx * sinA + dy * cosA + cy,
  };
}
