const EPSILON = 1e-3;
const CSS_EPSILON = 0.25;

function nearlyEqual(a, b, epsilon = EPSILON) {
  return Math.abs(a - b) <= epsilon;
}

function sanitizePositive(value, fallback = 1) {
  if (Number.isFinite(value) && value > 0) return value;
  return fallback;
}

function parsePx(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  return Number.parseFloat(value);
}

function contextScaleMatches(ctx, expectedScale) {
  if (!ctx || typeof ctx.getTransform !== 'function') return true;
  try {
    const t = ctx.getTransform();
    const sx = Number(t?.a);
    const sy = Number(t?.d);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return false;
    return nearlyEqual(sx, expectedScale) && nearlyEqual(sy, expectedScale);
  } catch {
    return false;
  }
}

function updateCanvasCssSize(canvas, targetWidthCss, targetHeightCss) {
  if (!canvas?.style) return false;
  let changed = false;
  const widthCss = parsePx(canvas.style.width);
  if (!Number.isFinite(widthCss) || !nearlyEqual(widthCss, targetWidthCss, CSS_EPSILON)) {
    canvas.style.width = `${targetWidthCss}px`;
    changed = true;
  }
  const heightCss = parsePx(canvas.style.height);
  if (!Number.isFinite(heightCss) || !nearlyEqual(heightCss, targetHeightCss, CSS_EPSILON)) {
    canvas.style.height = `${targetHeightCss}px`;
    changed = true;
  }
  return changed;
}

function updatePageHeightCss(pageEl, targetHeightCss) {
  if (!pageEl?.style) return false;
  const currentHeightCss = parsePx(pageEl.style.height);
  if (Number.isFinite(currentHeightCss) && nearlyEqual(currentHeightCss, targetHeightCss, CSS_EPSILON)) {
    return false;
  }
  pageEl.style.height = `${targetHeightCss}px`;
  return true;
}

function resizeCanvasPixels(canvas, widthPx, heightPx) {
  if (!canvas) return false;
  if (canvas.width === widthPx && canvas.height === heightPx) return false;
  canvas.width = widthPx;
  canvas.height = heightPx;
  return true;
}

function resizeMainCanvasWithSnapshot(canvas, widthPx, heightPx, preserveBitmap = false) {
  if (!canvas) return false;
  if (canvas.width === widthPx && canvas.height === heightPx) return false;

  let snapshot = null;
  if (
    preserveBitmap
    && canvas.width > 1
    && canvas.height > 1
    && typeof document !== 'undefined'
    && typeof document.createElement === 'function'
  ) {
    try {
      snapshot = document.createElement('canvas');
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      const snapshotCtx = snapshot.getContext('2d');
      if (snapshotCtx) {
        snapshotCtx.setTransform(1, 0, 0, 1, 0, 0);
        snapshotCtx.globalCompositeOperation = 'copy';
        snapshotCtx.drawImage(canvas, 0, 0);
      } else {
        snapshot = null;
      }
    } catch {
      snapshot = null;
    }
  }

  canvas.width = widthPx;
  canvas.height = heightPx;

  if (!snapshot) return true;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  } catch {
    // No-op fallback: canvas has been resized, redraw will still occur.
  }
  return true;
}

export function preparePageCanvasForViewport({
  page,
  app,
  renderScale,
  layoutZoom,
  configureCanvasContext,
  preserveMainBitmap = false,
} = {}) {
  if (!page || !app) {
    return {
      needsRedraw: false,
      resized: false,
      cssChanged: false,
      contextUpdated: false,
      renderScaleChanged: false,
      layoutZoomChanged: false,
    };
  }

  const safeRenderScale = sanitizePositive(renderScale, 1);
  const safeLayoutZoom = sanitizePositive(layoutZoom, 1);
  const targetWidthPx = Math.max(1, Math.floor(app.PAGE_W * safeRenderScale));
  const targetHeightPx = Math.max(1, Math.floor(app.PAGE_H * safeRenderScale));
  const targetWidthCss = app.PAGE_W * safeLayoutZoom;
  const targetHeightCss = app.PAGE_H * safeLayoutZoom;

  const resizedMain = resizeMainCanvasWithSnapshot(
    page.canvas,
    targetWidthPx,
    targetHeightPx,
    preserveMainBitmap,
  );
  const resizedBack = resizeCanvasPixels(page.backCanvas, targetWidthPx, targetHeightPx);
  const resized = resizedMain || resizedBack;

  const cssChangedCanvas = updateCanvasCssSize(page.canvas, targetWidthCss, targetHeightCss);
  const cssChangedPage = updatePageHeightCss(page.pageEl, targetHeightCss);
  const cssChanged = cssChangedCanvas || cssChangedPage;

  const previousRenderScale = sanitizePositive(page.renderScalePreparedFor, safeRenderScale);
  const previousLayoutZoom = sanitizePositive(page.layoutZoomPreparedFor, safeLayoutZoom);
  const renderScaleChanged = !nearlyEqual(previousRenderScale, safeRenderScale);
  const layoutZoomChanged = !nearlyEqual(previousLayoutZoom, safeLayoutZoom);
  const renderScaleDelta = safeRenderScale - previousRenderScale;
  const renderScaleIncreased = renderScaleChanged && renderScaleDelta > EPSILON;
  const renderScaleDecreased = renderScaleChanged && renderScaleDelta < -EPSILON;

  const contextNeedsUpdate = resized
    || renderScaleChanged
    || !contextScaleMatches(page.ctx, safeRenderScale)
    || !contextScaleMatches(page.backCtx, safeRenderScale);
  const contextUpdated = contextNeedsUpdate && typeof configureCanvasContext === 'function';
  if (contextUpdated) {
    if (page.ctx) configureCanvasContext(page.ctx);
    if (page.backCtx) configureCanvasContext(page.backCtx);
  }

  page.renderScalePreparedFor = safeRenderScale;
  page.layoutZoomPreparedFor = safeLayoutZoom;

  return {
    needsRedraw: resized || renderScaleChanged,
    resized,
    cssChanged,
    contextUpdated,
    renderScaleChanged,
    renderScaleDelta,
    renderScaleIncreased,
    renderScaleDecreased,
    layoutZoomChanged,
  };
}
