function resolveNumeric(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function resolveHostDimension(value, fallback) {
  const numeric = resolveNumeric(value, fallback);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return numeric;
}

function resolveDpr() {
  if (typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)) {
    return Math.max(1, window.devicePixelRatio);
  }
  return 1;
}

function createCanvasIn(container, className) {
  if (!container) return null;
  const existing = container.querySelector(`canvas.${className}`);
  if (typeof HTMLCanvasElement !== 'undefined' && existing instanceof HTMLCanvasElement) {
    return existing;
  }
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  return canvas;
}

function resizeCanvas(canvas, cssWidth, cssHeight, dpr) {
  if (!canvas) return false;
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  const changed = canvas.width !== width || canvas.height !== height;
  if (changed) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.style.width = `${Math.max(1, cssWidth)}px`;
  canvas.style.height = `${Math.max(1, cssHeight)}px`;
  return changed;
}

function beginPaint(canvas, cssWidth, cssHeight, dpr) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.imageSmoothingEnabled = false;
  ctx.lineWidth = 1;
  return ctx;
}

function resolveTickColor(host) {
  if (!host || typeof getComputedStyle !== 'function') {
    return 'rgba(0,0,0,0.55)';
  }
  const style = getComputedStyle(host);
  return (style.getPropertyValue('--ruler-tick') || '').trim() || 'rgba(0,0,0,0.55)';
}

function drawHorizontalRuler({
  ctx,
  cssWidth,
  cssHeight,
  originX,
  ppi,
  tickColor,
}) {
  const startInch = Math.floor(-originX / ppi);
  const endInch = Math.ceil((cssWidth - originX) / ppi);
  ctx.strokeStyle = tickColor;
  ctx.fillStyle = tickColor;
  ctx.font = '9px sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  for (let i = startInch; i <= endInch; i += 1) {
    for (let j = 0; j < 10; j += 1) {
      const x = originX + (i + j / 10) * ppi;
      if (x < -1 || x > cssWidth + 1) continue;
      const px = Math.round(x) + 0.5;
      const tickHeight = j === 0
        ? cssHeight
        : j === 5
          ? cssHeight * 0.6
          : cssHeight * 0.3;
      ctx.beginPath();
      ctx.moveTo(px, cssHeight);
      ctx.lineTo(px, cssHeight - tickHeight);
      ctx.stroke();
      if (j === 0) {
        ctx.globalAlpha = 0.8;
        ctx.fillText(String(i), x + 4, 0);
        ctx.globalAlpha = 1;
      }
    }
  }
}

function drawVerticalRuler({
  ctx,
  cssWidth,
  cssHeight,
  originY,
  ppi,
  tickColor,
}) {
  const startInch = Math.floor(-originY / ppi);
  const endInch = Math.ceil((cssHeight - originY) / ppi);
  ctx.strokeStyle = tickColor;
  ctx.fillStyle = tickColor;
  ctx.font = '9px sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  for (let i = startInch; i <= endInch; i += 1) {
    for (let j = 0; j < 10; j += 1) {
      const y = originY + (i + j / 10) * ppi;
      if (y < -1 || y > cssHeight + 1) continue;
      const py = Math.round(y) + 0.5;
      const tickWidth = j === 0
        ? cssWidth
        : j === 5
          ? cssWidth * 0.6
          : cssWidth * 0.3;
      ctx.beginPath();
      ctx.moveTo(cssWidth, py);
      ctx.lineTo(cssWidth - tickWidth, py);
      ctx.stroke();
      if (j === 0) {
        ctx.globalAlpha = 0.8;
        ctx.fillText(String(i), 2, y + 4);
        ctx.globalAlpha = 1;
      }
    }
  }
}

export function createRulerCanvasRenderer({
  app,
  getPaperWidthMm = () => 210,
  getPaperHeightMm = () => 297,
} = {}) {
  const horizontalHost = app?.rulerH_host || null;
  const verticalHost = app?.rulerV_host || null;
  const horizontalLayer = horizontalHost?.querySelector?.('.ruler-ticks') || null;
  const verticalLayer = verticalHost?.querySelector?.('.ruler-v-ticks') || null;

  const horizontalCanvas = createCanvasIn(horizontalLayer, 'ruler-ticks-canvas');
  const verticalCanvas = createCanvasIn(verticalLayer, 'ruler-ticks-canvas');

  const cache = {
    horizontalKey: '',
    verticalKey: '',
  };

  function clear() {
    cache.horizontalKey = '';
    cache.verticalKey = '';
    if (horizontalCanvas) {
      const ctx = horizontalCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, horizontalCanvas.width, horizontalCanvas.height);
    }
    if (verticalCanvas) {
      const ctx = verticalCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, verticalCanvas.width, verticalCanvas.height);
    }
  }

  function draw({ activePageRect, hostWidth, hostHeight }) {
    if (!activePageRect || !horizontalCanvas || !verticalCanvas) return;

    const paperWidthMm = Math.max(1, resolveNumeric(getPaperWidthMm(), 210));
    const paperHeightMm = Math.max(1, resolveNumeric(getPaperHeightMm(), 297));
    const ppiH = (activePageRect.width / paperWidthMm) * 25.4;
    const ppiV = (activePageRect.height / paperHeightMm) * 25.4;
    if (!Number.isFinite(ppiH) || ppiH <= 0 || !Number.isFinite(ppiV) || ppiV <= 0) {
      clear();
      return;
    }

    const cssWidthH = resolveHostDimension(hostWidth, horizontalHost?.clientWidth || activePageRect.width);
    const cssHeightH = resolveHostDimension(horizontalHost?.clientHeight, 16);
    const cssWidthV = resolveHostDimension(verticalHost?.clientWidth, 16);
    const cssHeightV = resolveHostDimension(hostHeight, verticalHost?.clientHeight || activePageRect.height);
    const dpr = resolveDpr();
    const tickColor = resolveTickColor(horizontalHost);

    const horizontalKey = [
      Math.round(cssWidthH),
      Math.round(cssHeightH),
      Math.round(activePageRect.left * 10),
      Math.round(ppiH * 1000),
      tickColor,
      dpr,
    ].join('|');
    const verticalKey = [
      Math.round(cssWidthV),
      Math.round(cssHeightV),
      Math.round(activePageRect.top * 10),
      Math.round(ppiV * 1000),
      tickColor,
      dpr,
    ].join('|');

    const horizontalResized = resizeCanvas(horizontalCanvas, cssWidthH, cssHeightH, dpr);
    if (horizontalResized) cache.horizontalKey = '';
    if (cache.horizontalKey !== horizontalKey) {
      const hctx = beginPaint(horizontalCanvas, cssWidthH, cssHeightH, dpr);
      if (hctx) {
        drawHorizontalRuler({
          ctx: hctx,
          cssWidth: cssWidthH,
          cssHeight: cssHeightH,
          originX: activePageRect.left,
          ppi: ppiH,
          tickColor,
        });
        cache.horizontalKey = horizontalKey;
      }
    }

    const verticalResized = resizeCanvas(verticalCanvas, cssWidthV, cssHeightV, dpr);
    if (verticalResized) cache.verticalKey = '';
    if (cache.verticalKey !== verticalKey) {
      const vctx = beginPaint(verticalCanvas, cssWidthV, cssHeightV, dpr);
      if (vctx) {
        drawVerticalRuler({
          ctx: vctx,
          cssWidth: cssWidthV,
          cssHeight: cssHeightV,
          originY: activePageRect.top,
          ppi: ppiV,
          tickColor,
        });
        cache.verticalKey = verticalKey;
      }
    }
  }

  return {
    draw,
    clear,
  };
}
