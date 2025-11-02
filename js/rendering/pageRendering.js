import { computeGlyphJitterOffset } from './glyphJitter.js';

export function createPageRenderer(options) {
  const {
    context,
    app: explicitApp,
    state: explicitState,
    getAsc,
    getDesc,
    getCharWidth,
    getGridHeight,
    gridDiv,
    getRenderScale,
    rebuildAllAtlases,
    drawGlyph,
    applyGrainOverlayOnRegion,
    invalidateGrainCache,
    lifecycle,
    getCurrentBounds,
    getBatchDepth,
    getInkSectionOrder,
  } = options || {};

  const app = explicitApp || context?.app;
  const state = explicitState || context?.state || {};
  const metrics = context?.scalars;

  const ensureMetricGetter = (fn, key) => {
    if (typeof fn === 'function') return fn;
    if (metrics && key in metrics) {
      return () => metrics[key];
    }
    return () => undefined;
  };

  const getAscFn = ensureMetricGetter(getAsc, 'ASC');
  const getDescFn = ensureMetricGetter(getDesc, 'DESC');
  const getCharWidthFn = ensureMetricGetter(getCharWidth, 'CHAR_W');
  const getGridHeightFn = ensureMetricGetter(getGridHeight, 'GRID_H');
  const getRenderScaleFn = ensureMetricGetter(getRenderScale, 'RENDER_SCALE');
  const { touchPage } = lifecycle;
  const getInkSectionOrderFn = typeof getInkSectionOrder === 'function'
    ? getInkSectionOrder
    : (() => ['fill', 'blur', 'texture', 'fuzz', 'bleed', 'grain']);

  const GLYPH_SECTION_IDS = ['fill', 'blur', 'texture', 'fuzz', 'bleed'];

  function getGrainPlacement() {
    const order = getInkSectionOrderFn();
    if (!Array.isArray(order)) {
      return { before: false, after: true };
    }
    const grainIndex = order.indexOf('grain');
    if (grainIndex === -1) {
      return { before: false, after: false };
    }
    const glyphIndices = order
      .map((id, idx) => (GLYPH_SECTION_IDS.includes(id) ? idx : -1))
      .filter(idx => idx !== -1);
    if (!glyphIndices.length) {
      return { before: false, after: true };
    }
    const firstGlyphIndex = Math.min(...glyphIndices);
    const before = grainIndex <= firstGlyphIndex;
    return { before, after: !before };
  }

  function computeEffectOverrides(stack) {
    if (!Array.isArray(stack) || stack.length < 2) return null;
    const preferWhiteEffects = !!state.inkEffectsPreferWhite;
    let seenWhiteAbove = false;
    let seenDarkAbove = false;
    let anyOverrides = false;
    const overrides = new Array(stack.length);
    for (let i = stack.length - 1; i >= 0; i--) {
      const glyph = stack[i];
      if (!glyph) continue;
      const ink = glyph.ink || 'b';
      const isDarkInk = ink !== 'w';
      if (ink === 'w') {
        if (preferWhiteEffects && seenDarkAbove) {
          overrides[i] = 'disabled';
          anyOverrides = true;
        }
        seenWhiteAbove = true;
      } else if (isDarkInk) {
        if (!preferWhiteEffects && seenWhiteAbove) {
          overrides[i] = 'disabled';
          anyOverrides = true;
        }
        seenDarkAbove = true;
      }
    }
    return anyOverrides ? overrides : null;
  }

  function drawGlyphStack(ctx, stack, x, baseline, pageIndex, rowMu, col) {
    if (!Array.isArray(stack) || stack.length === 0) return;
    const gridHeight = getGridHeightFn();
    const jitterOffset = computeGlyphJitterOffset(state, pageIndex, rowMu, col, gridHeight);
    const baselineAdjusted = Number.isFinite(jitterOffset) ? baseline + jitterOffset : baseline;
    const overrides = computeEffectOverrides(stack);
    for (let k = 0; k < stack.length; k++) {
      const glyph = stack[k];
      if (!glyph) continue;
      const effectOverride = overrides ? overrides[k] : undefined;
      drawGlyph(ctx, glyph.char, glyph.ink || 'b', x, baselineAdjusted, k, stack.length, pageIndex, rowMu, col, effectOverride);
    }
  }

  function refreshGlyphEffects(options = {}) {
    if (options.rebuild !== false) {
      rebuildAllAtlases();
    }
    for (const page of state.pages) {
      if (!page) continue;
      page.dirtyAll = true;
      if (page.active) schedulePaint(page);
    }
  }

  function refreshGrainEffects() {
    if (typeof invalidateGrainCache === 'function') {
      invalidateGrainCache();
    }
    for (const page of state.pages) {
      if (!page) continue;
      page.grainCanvas = null;
      page.grainForSize = { w: 0, h: 0, key: null };
      page.dirtyAll = true;
      if (page.active) schedulePaint(page);
    }
  }

  function markRowAsDirty(page, rowMu) {
    if (page._dirtyRowMinMu === undefined) {
      page._dirtyRowMinMu = rowMu;
      page._dirtyRowMaxMu = rowMu;
    } else {
      if (rowMu < page._dirtyRowMinMu) page._dirtyRowMinMu = rowMu;
      if (rowMu > page._dirtyRowMaxMu) page._dirtyRowMaxMu = rowMu;
    }
    touchPage(page);
    if (!page.active) return;
    if (getBatchDepth() === 0) schedulePaint(page);
  }

  function schedulePaint(page) {
    if (!page.active) return;
    if (page.raf) return;
    page.raf = requestAnimationFrame(() => {
      page.raf = 0;
      paintPage(page);
    });
  }

  function paintWholePageToBackBuffer(page) {
    const { backCtx } = page;
    const gridHeight = getGridHeightFn();
    const charWidth = getCharWidthFn();
    const grainPlacement = getGrainPlacement();
    backCtx.save();
    backCtx.globalCompositeOperation = 'source-over';
    backCtx.globalAlpha = 1;
    backCtx.fillStyle = state.pageFillColor || '#ffffff';
    backCtx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
    backCtx.restore();
    if (grainPlacement.before && state.grainPct > 0) {
      applyGrainOverlayOnRegion(page, 0, app.PAGE_H);
    }
    for (const [rowMu, rowMap] of page.grid) {
      if (!rowMap) continue;
      const baseline = rowMu * gridHeight;
      for (const [col, stack] of rowMap) {
        const x = col * charWidth;
        drawGlyphStack(backCtx, stack, x, baseline, page.index, rowMu, col);
      }
    }
    page.ctx.drawImage(page.backCanvas, 0, 0, page.backCanvas.width, page.backCanvas.height, 0, 0, app.PAGE_W, app.PAGE_H);
    if (grainPlacement.after && state.grainPct > 0) {
      applyGrainOverlayOnRegion(page, 0, app.PAGE_H);
    }
  }

  function paintDirtyRowsBand(page, dirtyRowMinMu, dirtyRowMaxMu) {
    const { backCtx, ctx } = page;
    const asc = getAscFn();
    const desc = getDescFn();
    const charWidth = getCharWidthFn();
    const gridHeight = getGridHeightFn();
    const grainPlacement = getGrainPlacement();

    const BLEED_TOP_CSS = Math.ceil(asc + 2);
    const BLEED_BOTTOM_CSS = Math.ceil(desc + 2);

    const bandTopCss = Math.max(0, dirtyRowMinMu * gridHeight - BLEED_TOP_CSS);
    const bandBotCss = Math.min(app.PAGE_H, dirtyRowMaxMu * gridHeight + BLEED_BOTTOM_CSS);
    const bandHCss = Math.max(0, bandBotCss - bandTopCss);
    if (bandHCss <= 0) return;

    backCtx.save();
    backCtx.globalCompositeOperation = 'source-over';
    backCtx.globalAlpha = 1;
    backCtx.fillStyle = state.pageFillColor || '#ffffff';
    backCtx.fillRect(0, bandTopCss, app.PAGE_W, bandHCss);
    backCtx.restore();

    const bounds = getCurrentBounds();
    const minMu = Math.max(bounds.Tmu, dirtyRowMinMu - gridDiv);
    const maxMu = Math.min(bounds.Bmu, dirtyRowMaxMu + gridDiv);
    if (minMu > maxMu) return;

    const rowsToRender = [];
    for (const [rowMu, rowMap] of page.grid) {
      if (!rowMap) continue;
      if (rowMu < minMu || rowMu > maxMu) continue;
      rowsToRender.push([rowMu, rowMap]);
    }

    rowsToRender.sort((a, b) => a[0] - b[0]);

    for (const [rowMu, rowMap] of rowsToRender) {

      const baseline = rowMu * gridHeight;
      const rowTopCss = baseline - BLEED_TOP_CSS;
      const rowBotCss = baseline + BLEED_BOTTOM_CSS;
      if (rowBotCss <= bandTopCss || rowTopCss >= bandBotCss) continue;

      for (const [col, stack] of rowMap) {
        const x = col * charWidth;
        drawGlyphStack(backCtx, stack, x, baseline, page.index, rowMu, col);
      }
    }

    const renderScale = getRenderScaleFn();
    const sx = 0;
    const sy = Math.round(bandTopCss * renderScale);
    const sw = page.backCanvas.width;
    const sh = Math.round(bandHCss * renderScale);
    const dx = 0;
    const dy = bandTopCss;
    const dw = app.PAGE_W;
    const dh = bandHCss;
    if (grainPlacement.before && state.grainPct > 0) {
      applyGrainOverlayOnRegion(page, bandTopCss, bandHCss);
    }

    ctx.drawImage(page.backCanvas, sx, sy, sw, sh, dx, dy, dw, dh);

    if (grainPlacement.after && state.grainPct > 0) {
      applyGrainOverlayOnRegion(page, bandTopCss, bandHCss);
    }
  }

  function paintPage(page) {
    if (!page.active) return;
    if (page.dirtyAll) {
      page.dirtyAll = false;
      paintWholePageToBackBuffer(page);
      page._dirtyRowMinMu = page._dirtyRowMaxMu = undefined;
      return;
    }
    const hasDirtyRows = page._dirtyRowMinMu !== undefined || page._dirtyRowMaxMu !== undefined;
    if (hasDirtyRows) {
      paintDirtyRowsBand(page, page._dirtyRowMinMu, page._dirtyRowMaxMu);
      page._dirtyRowMinMu = page._dirtyRowMaxMu = undefined;
    }
  }

  if (context?.setCallback) {
    context.setCallback('schedulePaint', schedulePaint);
  }

  return {
    refreshGlyphEffects,
    refreshGrainEffects,
    markRowAsDirty,
    schedulePaint,
  };
}
