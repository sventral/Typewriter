import { computeGlyphJitterOffset } from './glyphJitter.js';
import { sanitizePageNumberingSettings } from '../config/pageNumbering.js';
import { isSafari } from '../utils/platform.js';

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
    : (() => ['filters']);
  const getLineStepMu = () => {
    const step = Number.isFinite(state?.lineStepMu) ? state.lineStepMu : gridDiv;
    return Number.isFinite(step) && step > 0 ? step : 1;
  };

  // Keep paint slices shorter on Safari to avoid long tasks that stall text input.
  // Other browsers keep the higher budget for throughput.
  const FULL_PAINT_TIME_BUDGET_MS = isSafari() ? 10 : 14;
  
  const now = (() => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return () => performance.now();
    }
    return () => Date.now();
  })();

  function pageNumberingSettings() {
    return sanitizePageNumberingSettings(
      state?.pageNumbering,
      { enabled: false, offsetLines: 1, alignment: 'center' },
    );
  }

  function computePageNumberRow(page) {
    const settings = pageNumberingSettings();
    if (!settings.enabled) return null;
    const bounds = typeof getCurrentBounds === 'function' ? getCurrentBounds() : null;
    if (!bounds) return null;
    const gridHeight = getGridHeightFn();
    const desc = getDescFn();
    const step = Math.max(1, getLineStepMu());
    if (!Number.isFinite(gridHeight) || gridHeight <= 0) return null;
    const tmu = Number.isFinite(bounds.Tmu) ? bounds.Tmu : 0;
    const rawMaxRow = Math.floor((app.PAGE_H - desc) / gridHeight);
    const stepsFromTop = Math.floor((rawMaxRow - tmu) / step);
    if (!Number.isFinite(stepsFromTop) || stepsFromTop < 0) return null;
    const targetStepsFromTop = Math.max(0, stepsFromTop - settings.offsetLines);
    const rowMu = tmu + targetStepsFromTop * step;
    if (!Number.isFinite(rowMu) || rowMu < 0) return null;
    const pageNumber = Number.isFinite(page?.index) ? page.index + 1 : null;
    if (pageNumber == null) return null;
    const text = String(pageNumber);
    const leftCol = Number.isFinite(bounds.L) ? bounds.L : 0;
    const rightCol = Number.isFinite(bounds.R) ? bounds.R : leftCol;
    const widthCols = Math.max(0, rightCol - leftCol + 1);
    if (widthCols <= 0 || !text.length) return null;
    let startCol;
    if (settings.alignment === 'right') {
      startCol = rightCol - text.length + 1;
    } else if (settings.alignment === 'center') {
      startCol = leftCol + Math.floor((widthCols - text.length) / 2);
    } else {
      startCol = leftCol;
    }
    const safeStart = Math.max(leftCol, Math.min(startCol, rightCol - text.length + 1));
    const rowMap = new Map();
    for (let i = 0; i < text.length; i++) {
      rowMap.set(safeStart + i, [{ char: text[i], ink: state.ink || 'b' }]);
    }
    return { rowMu, rowMap };
  }

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
    page.fullPaintCurrentRowCols = null;
    page.fullPaintColIndex = 0;
    page.fullPaintInProgress = false;
    page.isAtomicPaint = false;
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
    const pageNumberRow = computePageNumberRow(page);
    if (pageNumberRow && Number.isFinite(pageNumberRow.rowMu) && !rows.includes(pageNumberRow.rowMu)) {
      rows.push(pageNumberRow.rowMu);
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
    page.fullPaintCurrentRowCols = null;
    page.fullPaintColIndex = 0;
    page.fullPaintInProgress = true;

    const { backCtx } = page;
    if (!backCtx || !page.ctx) {
      resetFullPagePaintState(page, true);
      return false;
    }

    const preserveFrontBuffer = page.preserveFrontBufferForFullPaint === true;
    if (page.preserveFrontBufferForFullPaint) {
      delete page.preserveFrontBufferForFullPaint;
    }
    
    page.isAtomicPaint = preserveFrontBuffer;

    backCtx.save();
    backCtx.globalCompositeOperation = 'source-over';
    backCtx.globalAlpha = 1;
    backCtx.fillStyle = state.pageFillColor || '#f7f5ee';
    backCtx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
    backCtx.restore();

    if (!preserveFrontBuffer) {
      page.ctx.save();
      page.ctx.globalCompositeOperation = 'source-over';
      page.ctx.globalAlpha = 1;
      page.ctx.fillStyle = state.pageFillColor || '#f7f5ee';
      page.ctx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
      page.ctx.restore();
    }

    page.dirtyAll = false;
    page._dirtyRowMinMu = page._dirtyRowMaxMu = undefined;
    if (page._dirtyRows) page._dirtyRows.clear();

    if (queue.length === 0) {
      if (page.isAtomicPaint) {
        flushFullPaintRange(page, 0, app.PAGE_H);
      }
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
    const pageNumberRow = computePageNumberRow(page);

    const asc = getAscFn();
    const desc = getDescFn();
    const gridHeight = getGridHeightFn();
    const charWidth = getCharWidthFn();
    const angleRad = Number.isFinite(page?.lineSlantDeg) ? (page.lineSlantDeg * Math.PI) / 180 : 0;
    const slantBleed = Math.abs((app.PAGE_W / 2) * Math.tan(angleRad));
    const BLEED_TOP_CSS = Math.ceil(asc + 2 + slantBleed);
    const BLEED_BOTTOM_CSS = Math.ceil(desc + 2 + slantBleed);

    const { backCtx } = page;
    if (!backCtx) {
      resetFullPagePaintState(page, true);
      return;
    }

    const sliceStart = now();
    const rawBands = [];

    let processedCount = 0;
    while (page.fullPaintCursor < queue.length || page.fullPaintCurrentRowCols) {
      
      if (!page.fullPaintCurrentRowCols) {
        const rowMu = queue[page.fullPaintCursor];
        let rowMap = page.grid.get(rowMu);
        if (!rowMap && pageNumberRow && pageNumberRow.rowMu === rowMu) {
          rowMap = pageNumberRow.rowMap;
        }
        
        if (rowMap && rowMap.size > 0) {
          page.fullPaintCurrentRowCols = Array.from(rowMap.entries());
          page.fullPaintColIndex = 0;
          page.fullPaintCurrentRowMu = rowMu;
        } else {
          page.fullPaintCursor++;
          continue;
        }
      }

      const cols = page.fullPaintCurrentRowCols;
      const rowMu = page.fullPaintCurrentRowMu;
      const baseline = rowMu * gridHeight;
      let yielded = false;

      while (page.fullPaintColIndex < cols.length) {
        const [col, stack] = cols[page.fullPaintColIndex];
        const x = col * charWidth;
        
        drawGlyphStack(backCtx, stack, x, baseline, page, rowMu, col);
        
        page.fullPaintColIndex++;
        processedCount++;

        // INCREASED BATCH SIZE:
        // Check time budget only every 64 items instead of 24.
        // This reduces overhead and allows more work per frame.
        if (processedCount >= 64) {
          processedCount = 0;
          if ((now() - sliceStart) >= FULL_PAINT_TIME_BUDGET_MS) {
            yielded = true;
            break;
          }
        }
      }

      const rowTopCss = baseline - BLEED_TOP_CSS;
      const rowBotCss = baseline + BLEED_BOTTOM_CSS;
      rawBands.push([rowTopCss, rowBotCss]);

      if (yielded) {
        break;
      } else {
        page.fullPaintCurrentRowCols = null;
        page.fullPaintColIndex = 0;
        page.fullPaintCursor++;
      }
    }

    if (rawBands.length && !page.isAtomicPaint) {
      mergeAndFlushBands(page, rawBands);
    }

    if (page.fullPaintCursor >= queue.length && !page.fullPaintCurrentRowCols) {
      if (page.isAtomicPaint) {
        flushFullPaintRange(page, 0, app.PAGE_H);
      }
      resetFullPagePaintState(page);
      return;
    }

    scheduleNextFullPaintChunk(page);
  }

  function drawGlyphStack(ctx, stack, x, baseline, page, rowMu, col) {
    if (!Array.isArray(stack) || stack.length === 0) return;
    const renderScale = getRenderScaleFn();
    const snapToRenderScale = (value) => {
      const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
      return Math.round(value * scale) / scale;
    };

    const gridHeight = getGridHeightFn();
    const angleRad = Number.isFinite(page?.lineSlantDeg)
      ? (page.lineSlantDeg * Math.PI) / 180
      : 0;

    const cx = app.PAGE_W / 2;
    const cy = app.PAGE_H / 2;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    for (let k = 0; k < stack.length; k++) {
      const glyph = stack[k];
      if (!glyph) continue;
      
      const jitterOffset = computeGlyphJitterOffset(
        state,
        page?.index,
        rowMu,
        col,
        gridHeight,
        glyph?.jitterSalt,
      );

      const ox = x;
      const oy = baseline + (Number.isFinite(jitterOffset) ? jitterOffset : 0);

      if (angleRad !== 0) {
        const dx = ox - cx;
        const dy = oy - cy;

        const rx = dx * cosA - dy * sinA + cx;
        const ry = dx * sinA + dy * cosA + cy;

        const snapX = snapToRenderScale(rx);
        const snapY = snapToRenderScale(ry);

        ctx.save();
        ctx.translate(snapX, snapY);
        ctx.rotate(angleRad);
        drawGlyph(ctx, glyph.char, glyph.ink || 'b', 0, 0, k, stack.length, page?.index, rowMu, col, undefined);
        ctx.restore();
      } else {
        drawGlyph(ctx, glyph.char, glyph.ink || 'b', ox, oy, k, stack.length, page?.index, rowMu, col, undefined);
      }
    }
  }

  function refreshGlyphEffects(options = {}) {
    const shouldRebuild = options.rebuild !== false;
    const preserveFrontBuffer = options.preserveFrontBuffer === true;
    if (shouldRebuild) {
      rebuildAllAtlases();
    }
    const pages = Array.isArray(state?.pages) ? state.pages : [];
    for (const page of pages) {
      if (!page) continue;
      page.dirtyAll = true;
      page.preserveFrontBufferForFullPaint = preserveFrontBuffer;
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
    if (!page._dirtyRows) {
      page._dirtyRows = new Set();
    }
    page._dirtyRows.add(rowMu);
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
    const angleRad = Number.isFinite(page?.lineSlantDeg) ? (page.lineSlantDeg * Math.PI) / 180 : 0;
    const slantBleedTop = Math.abs((app.PAGE_W / 2) * Math.tan(angleRad));
    const slantBleedBot = slantBleedTop;
    const pageNumberRow = computePageNumberRow(page);
    backCtx.save();
    backCtx.globalCompositeOperation = 'source-over';
    backCtx.globalAlpha = 1;
    backCtx.fillStyle = state.pageFillColor || '#f7f5ee';
    backCtx.fillRect(0, 0, app.PAGE_W, app.PAGE_H);
    backCtx.restore();
    const asc = getAscFn();
    const desc = getDescFn();
    const slantBleed = Math.abs((app.PAGE_W / 2) * Math.tan(angleRad));
    const bleedTop = Math.ceil(asc + 2 + slantBleed);
    const bleedBottom = Math.ceil(desc + 2 + slantBleed);

    for (const [rowMu, rowMap] of page.grid) {
      if (!rowMap) continue;
      const baseline = rowMu * gridHeight;
      for (const [col, stack] of rowMap) {
        const x = col * charWidth;
        drawGlyphStack(backCtx, stack, x, baseline, page, rowMu, col);
      }
    }
    if (pageNumberRow?.rowMap) {
      const baseline = pageNumberRow.rowMu * gridHeight;
      for (const [col, stack] of pageNumberRow.rowMap) {
        const x = col * charWidth;
        drawGlyphStack(backCtx, stack, x, baseline, page, pageNumberRow.rowMu, col);
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
    const angleRad = Number.isFinite(page?.lineSlantDeg) ? (page.lineSlantDeg * Math.PI) / 180 : 0;
    const slantBleed = Math.abs((app.PAGE_W / 2) * Math.tan(angleRad));

    const BLEED_TOP_CSS = Math.ceil(asc + 2 + slantBleed);
    const BLEED_BOTTOM_CSS = Math.ceil(desc + 2 + slantBleed);

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
    const maxNeighborGapMu = Math.max(gridDiv * 3, getLineStepMu(), state?.lineStepMu || 0);
    const minMu = Math.max(bounds.Tmu, dirtyRowMinMu - maxNeighborGapMu);
    const maxMu = Math.min(bounds.Bmu, dirtyRowMaxMu + maxNeighborGapMu);
    if (minMu > maxMu) return;

    const renderRow = (rowMu, rowMap) => {
      const baseline = rowMu * gridHeight;
      const rowTopCss = baseline - BLEED_TOP_CSS;
      const rowBotCss = baseline + BLEED_BOTTOM_CSS;
      if (rowBotCss <= bandTopCss || rowTopCss >= bandBotCss) return;

      for (const [col, stack] of rowMap) {
        const x = col * charWidth;
        drawGlyphStack(backCtx, stack, x, baseline, page, rowMu, col);
      }
    };

    const rowsToRender = [];
    const seenRows = new Set();
    const addRow = (rowMu, rowMapParam) => {
      if (seenRows.has(rowMu)) return;
      if (rowMu < minMu || rowMu > maxMu) return;
      const rowMap = rowMapParam || page.grid.get(rowMu);
      if (!rowMap) return;
      seenRows.add(rowMu);
      rowsToRender.push([rowMu, rowMap]);
    };

    const dirtyRowSet = page?._dirtyRows instanceof Set ? page._dirtyRows : null;
    const pageNumberRow = computePageNumberRow(page);
    if (pageNumberRow) {
      addRow(pageNumberRow.rowMu, pageNumberRow.rowMap);
    }

    if (dirtyRowSet?.size) {
      // When we know exactly which rows are dirty, avoid scanning the entire
      // page grid. Instead, render the dirty rows plus a small neighbor pad
      // to capture bleed/ink overlap without an O(totalRows) walk.
      const neighborPad = Math.max(0, Math.ceil(maxNeighborGapMu));
      for (const rowMu of dirtyRowSet) {
        addRow(rowMu);
        if (neighborPad === 0) continue;
        for (let k = 1; k <= neighborPad; k++) {
          addRow(rowMu - k);
          addRow(rowMu + k);
        }
      }
    } else {
      // Fallback: we don't have an explicit dirty set, so scan the grid.
      let lastMu = -Infinity;
      let orderTrusted = true;
      for (const [rowMu, rowMap] of page.grid) {
        if (orderTrusted && rowMu < lastMu) {
          orderTrusted = false; 
        }
        lastMu = rowMu;
        if (rowMu < minMu) continue;
        if (orderTrusted && rowMu > maxMu) break;
        addRow(rowMu, rowMap);
      }
    }

    if (rowsToRender.length) {
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
      if (page._dirtyRows) page._dirtyRows.clear();
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
