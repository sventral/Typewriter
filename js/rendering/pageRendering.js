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
  const { touchPage, visibleWindowIndices } = lifecycle || {};
  const getInkSectionOrderFn = typeof getInkSectionOrder === 'function'
    ? getInkSectionOrder
    : (() => ['expTone', 'expEdge', 'expGrain', 'expDefects']);
  const getLineStepMu = () => {
    const step = Number.isFinite(state?.lineStepMu) ? state.lineStepMu : gridDiv;
    return Number.isFinite(step) && step > 0 ? step : 1;
  };
  const FULL_PAINT_TIME_BUDGET_MS = 7;
  const now = (() => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return () => performance.now();
    }
    return () => Date.now();
  })();

  function firstRowMuInBand(minMu, bounds, step) {
    const base = Number.isFinite(bounds?.Tmu) ? bounds.Tmu : 0;
    if (!Number.isFinite(step) || step <= 0) return Math.ceil(minMu);
    if (minMu <= base) return base;
    const stepsFromBase = Math.ceil((minMu - base) / step);
    return base + stepsFromBase * step;
  }

  function resetFullPagePaintState(page, markDirtyAll = false) {
    if (!page) return;
    if (page.fullPaintRaf) {
      cancelAnimationFrame(page.fullPaintRaf);
      page.fullPaintRaf = 0;
    }
    page.fullPaintQueue = undefined;
    page.fullPaintCursor = 0;
    page.fullPaintInProgress = false;
    if (markDirtyAll) {
      page.dirtyAll = true;
    }
  }

  function flushFullPaintRange(page, topCss, bottomCss) {
    if (!page?.ctx || !page?.backCanvas) return;
    const renderScale = getRenderScaleFn();
    const clampedTop = Math.max(0, Math.floor(topCss));
    const clampedBottom = Math.min(app.PAGE_H, Math.ceil(bottomCss));
    const bandHeight = Math.max(0, clampedBottom - clampedTop);
    if (bandHeight <= 0) return;
    const sx = 0;
    const sy = Math.round(clampedTop * renderScale);
    const sw = page.backCanvas.width;
    const sh = Math.round(bandHeight * renderScale);
    const dx = 0;
    const dy = clampedTop;
    const dw = app.PAGE_W;
    const dh = bandHeight;
    page.ctx.drawImage(page.backCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function mergeAndFlushBands(page, rawBands) {
    if (!Array.isArray(rawBands) || rawBands.length === 0) return;
    const sorted = rawBands
      .map(([top, bottom]) => [Math.min(top, bottom), Math.max(top, bottom)])
      .sort((a, b) => a[0] - b[0]);
    let current = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const band = sorted[i];
      if (band[0] <= current[1]) {
        current[1] = Math.max(current[1], band[1]);
      } else {
        flushFullPaintRange(page, current[0], current[1]);
        current = band;
      }
    }
    flushFullPaintRange(page, current[0], current[1]);
  }

  function scheduleNextFullPaintChunk(page) {
    if (!page?.fullPaintInProgress) return;
    if (!page.active) {
      resetFullPagePaintState(page, true);
      return;
    }
    if (page.fullPaintRaf) return;
    page.fullPaintRaf = requestAnimationFrame(() => {
      page.fullPaintRaf = 0;
      processFullPagePaintSlice(page);
    });
  }

  function computeVisibleRowMuRange(page) {
    if (!page?.canvas || typeof page.canvas.getBoundingClientRect !== 'function') return null;
    if (typeof window === 'undefined') return null;
    const bounds = typeof getCurrentBounds === 'function' ? getCurrentBounds() : null;
    if (!bounds) return null;
    const rect = page.canvas.getBoundingClientRect();
    const viewportHeight = Number.isFinite(window.innerHeight) ? window.innerHeight : rect.height;
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
    const viewportTop = 0;
    const viewportBottom = viewportHeight;
    const overlapTop = Math.max(rect.top, viewportTop);
    const overlapBottom = Math.min(rect.bottom, viewportBottom);
    if (overlapBottom <= overlapTop) return null;
    const rectHeight = rect.height || 1;
    const relTop = (overlapTop - rect.top) / rectHeight;
    const relBottom = (overlapBottom - rect.top) / rectHeight;
    const muSpan = Math.max(1, (bounds.Bmu ?? 0) - (bounds.Tmu ?? 0));
    const padMu = Math.max(1, (bounds.gridDiv ?? 1)) * 2;
    return {
      minMu: (bounds.Tmu ?? 0) + relTop * muSpan - padMu,
      maxMu: (bounds.Tmu ?? 0) + relBottom * muSpan + padMu,
    };
  }

  function getViewportPriorityRange(page) {
    if (!page) return null;
    const winRange = typeof visibleWindowIndices === 'function' ? visibleWindowIndices() : null;
    if (Array.isArray(winRange) && winRange.length >= 2 && Number.isFinite(page.index)) {
      const start = Number.isFinite(winRange[0]) ? winRange[0] : page.index;
      const end = Number.isFinite(winRange[1]) ? winRange[1] : start;
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      if (Number.isFinite(lo) && Number.isFinite(hi) && (page.index < lo || page.index > hi)) {
        return null;
      }
    } else if (!page.active) {
      return null;
    }
    return computeVisibleRowMuRange(page);
  }

  function buildFullPaintQueue(page) {
    if (!page?.grid) return [];
    const rows = [];
    for (const key of page.grid.keys()) {
      if (!Number.isFinite(key)) continue;
      rows.push(key);
    }
    rows.sort((a, b) => a - b);
    const priorityRange = getViewportPriorityRange(page);
    if (!priorityRange) return rows;
    const visibleRows = [];
    const restRows = [];
    for (const rowMu of rows) {
      if (rowMu >= priorityRange.minMu && rowMu <= priorityRange.maxMu) {
        visibleRows.push(rowMu);
      } else {
        restRows.push(rowMu);
      }
    }
    return visibleRows.concat(restRows);
  }

  function beginFullPagePaint(page) {
    if (!page?.active) return false;
    resetFullPagePaintState(page);
    const queue = buildFullPaintQueue(page);
    page.fullPaintQueue = queue;
    page.fullPaintCursor = 0;
    page.fullPaintInProgress = true;

    const { backCtx } = page;
    if (!backCtx || !page.ctx) {
      resetFullPagePaintState(page, true);
      return false;
    }

    backCtx.save();
    backCtx.globalCompositeOperation = 'source-over';
    backCtx.globalAlpha = 1;
    backCtx.fillStyle = state.pageFillColor || '#f7f5ee';
    backCtx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
    backCtx.restore();

    page.ctx.save();
    page.ctx.globalCompositeOperation = 'source-over';
    page.ctx.globalAlpha = 1;
    page.ctx.fillStyle = state.pageFillColor || '#f7f5ee';
    page.ctx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
    page.ctx.restore();

    page.dirtyAll = false;
    page._dirtyRowMinMu = page._dirtyRowMaxMu = undefined;

    if (queue.length === 0) {
      resetFullPagePaintState(page);
      return true;
    }

    scheduleNextFullPaintChunk(page);
    return true;
  }

  function processFullPagePaintSlice(page) {
    if (!page?.fullPaintInProgress) return;
    if (!page.active) {
      resetFullPagePaintState(page, true);
      return;
    }

    const queue = page.fullPaintQueue || [];
    if (queue.length === 0) {
      resetFullPagePaintState(page);
      return;
    }

    const asc = getAscFn();
    const desc = getDescFn();
    const gridHeight = getGridHeightFn();
    const charWidth = getCharWidthFn();
    const BLEED_TOP_CSS = Math.ceil(asc + 2);
    const BLEED_BOTTOM_CSS = Math.ceil(desc + 2);

    const { backCtx } = page;
    if (!backCtx) {
      resetFullPagePaintState(page, true);
      return;
    }

    const sliceStart = now();
    let rowsProcessed = 0;
    const rawBands = [];

    while (page.fullPaintCursor < queue.length) {
      if (rowsProcessed > 0 && (now() - sliceStart) >= FULL_PAINT_TIME_BUDGET_MS) {
        break;
      }
      const rowMu = queue[page.fullPaintCursor++];
      rowsProcessed += 1;
      const rowMap = page.grid.get(rowMu);
      if (!rowMap) continue;
      const baseline = rowMu * gridHeight;
      const rowTopCss = baseline - BLEED_TOP_CSS;
      const rowBotCss = baseline + BLEED_BOTTOM_CSS;
      for (const [col, stack] of rowMap) {
        const x = col * charWidth;
        drawGlyphStack(backCtx, stack, x, baseline, page.index, rowMu, col);
      }
      rawBands.push([rowTopCss, rowBotCss]);
    }

    if (rawBands.length) {
      mergeAndFlushBands(page, rawBands);
    }

    if (page.fullPaintCursor >= queue.length) {
      resetFullPagePaintState(page);
      return;
    }

    scheduleNextFullPaintChunk(page);
  }

  function drawGlyphStack(ctx, stack, x, baseline, pageIndex, rowMu, col) {
    if (!Array.isArray(stack) || stack.length === 0) return;
    const gridHeight = getGridHeightFn();
    const jitterOffset = computeGlyphJitterOffset(state, pageIndex, rowMu, col, gridHeight);
    const baselineAdjusted = Number.isFinite(jitterOffset) ? baseline + jitterOffset : baseline;
    for (let k = 0; k < stack.length; k++) {
      const glyph = stack[k];
      if (!glyph) continue;
      drawGlyph(ctx, glyph.char, glyph.ink || 'b', x, baselineAdjusted, k, stack.length, pageIndex, rowMu, col, undefined);
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
    if (page.dirtyAll) {
      beginFullPagePaint(page);
    }
    const hasDirtyRows = page._dirtyRowMinMu !== undefined || page._dirtyRowMaxMu !== undefined;
    if (!hasDirtyRows && page.fullPaintInProgress) {
      return;
    }
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
    backCtx.save();
    backCtx.globalCompositeOperation = 'source-over';
    backCtx.globalAlpha = 1;
    backCtx.fillStyle = state.pageFillColor || '#f7f5ee';
    backCtx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
    backCtx.restore();
    for (const [rowMu, rowMap] of page.grid) {
      if (!rowMap) continue;
      const baseline = rowMu * gridHeight;
      for (const [col, stack] of rowMap) {
        const x = col * charWidth;
        drawGlyphStack(backCtx, stack, x, baseline, page.index, rowMu, col);
      }
    }
    page.ctx.drawImage(page.backCanvas, 0, 0, page.backCanvas.width, page.backCanvas.height, 0, 0, app.PAGE_W, app.PAGE_H);
  }

  function paintDirtyRowsBand(page, dirtyRowMinMu, dirtyRowMaxMu) {
    const { backCtx, ctx } = page;
    const asc = getAscFn();
    const desc = getDescFn();
    const charWidth = getCharWidthFn();
    const gridHeight = getGridHeightFn();

    const BLEED_TOP_CSS = Math.ceil(asc + 2);
    const BLEED_BOTTOM_CSS = Math.ceil(desc + 2);

    const bandTopCss = Math.max(0, dirtyRowMinMu * gridHeight - BLEED_TOP_CSS);
    const bandBotCss = Math.min(app.PAGE_H, dirtyRowMaxMu * gridHeight + BLEED_BOTTOM_CSS);
    const bandHCss = Math.max(0, bandBotCss - bandTopCss);
    if (bandHCss <= 0) return;

    backCtx.save();
    backCtx.globalCompositeOperation = 'source-over';
    backCtx.globalAlpha = 1;
    backCtx.fillStyle = state.pageFillColor || '#f7f5ee';
    backCtx.fillRect(0, bandTopCss, app.PAGE_W, bandHCss);
    backCtx.restore();

    const bounds = getCurrentBounds();
    const minMu = Math.max(bounds.Tmu, dirtyRowMinMu - gridDiv);
    const maxMu = Math.min(bounds.Bmu, dirtyRowMaxMu + gridDiv);
    if (minMu > maxMu) return;

    const renderRow = (rowMu, rowMap) => {
      const baseline = rowMu * gridHeight;
      const rowTopCss = baseline - BLEED_TOP_CSS;
      const rowBotCss = baseline + BLEED_BOTTOM_CSS;
      if (rowBotCss <= bandTopCss || rowTopCss >= bandBotCss) return;

      for (const [col, stack] of rowMap) {
        const x = col * charWidth;
        drawGlyphStack(backCtx, stack, x, baseline, page.index, rowMu, col);
      }
    };

    const stepMu = getLineStepMu();
    const startRowMu = firstRowMuInBand(minMu, bounds, stepMu);
    const canIterateByStep = Number.isFinite(stepMu) && stepMu > 0 && Number.isFinite(startRowMu);

    if (canIterateByStep && startRowMu <= maxMu) {
      for (let rowMu = startRowMu; rowMu <= maxMu; rowMu += stepMu) {
        const rowMap = page.grid.get(rowMu);
        if (!rowMap) continue;
        renderRow(rowMu, rowMap);
      }
    } else {
      const rowsToRender = [];
      for (const [rowMu, rowMap] of page.grid) {
        if (!rowMap) continue;
        if (rowMu < minMu || rowMu > maxMu) continue;
        rowsToRender.push([rowMu, rowMap]);
      }
      rowsToRender.sort((a, b) => a[0] - b[0]);
      for (const [rowMu, rowMap] of rowsToRender) {
        renderRow(rowMu, rowMap);
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

    ctx.drawImage(page.backCanvas, sx, sy, sw, sh, dx, dy, dw, dh);

  }

  function paintPage(page) {
    if (!page.active) return;
    if (page.dirtyAll) {
      beginFullPagePaint(page);
    }
    const hasDirtyRows = page._dirtyRowMinMu !== undefined || page._dirtyRowMaxMu !== undefined;
    if (hasDirtyRows) {
      paintDirtyRowsBand(page, page._dirtyRowMinMu, page._dirtyRowMaxMu);
      page._dirtyRowMinMu = page._dirtyRowMaxMu = undefined;
    }
  }

  if (typeof context?.registerRendererApi === 'function') {
    context.registerRendererApi({ schedulePaint });
  }

  return {
    refreshGlyphEffects,
    markRowAsDirty,
    schedulePaint,
  };
}
