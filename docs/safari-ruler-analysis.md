# Safari Ruler Marker Drift Analysis

## 1. Current marker update flow
- `computeSnappedVisualMargins()` converts editable margin settings into pixel coordinates and grid units that every caller shares. It snaps left/right to character columns and top/bottom to line rows so the visual guides and text layout are driven by the same state. 【F:js/layout/layoutAndZoomController.js†L322-L333】
- `positionRulersImmediate()` reads the active page rectangle, applies those snapped offsets, and moves the persistent triangle elements by updating their absolute `left`/`top` styles. When invoked without `skipTickUpdate` it also rebuilds the tick marks around the active page. 【F:js/layout/layoutAndZoomController.js†L512-L528】
- The active page rectangle comes from `getActivePageRect()`, which combines the live DOM bounds reported by Safari with the renderer's notion of page height (`app.PAGE_H * state.zoom`). That means the ruler markers are supposed to stay in lock-step with the same geometry the renderer uses. 【F:js/layout/layoutAndZoomController.js†L354-L358】

## 2. When the app calls `positionRulers()`
- Document edits such as typing, wrapping, and caret navigation all end by calling `positionRulers()`, ensuring the markers are supposed to reflect the new layout immediately after each text change. Examples include the batch renderer after typing, overflow handling during word wrap, newline insertion, and backspace navigation. 【F:js/document/documentEditing.js†L241-L318】
- UI refresh paths also invoke it: a full environment refresh after loading a document recalculates layout metrics, snaps margins, and then calls `positionRulers()` before returning control to the browser. 【F:js/init/uiBindings.js†L190-L199】
- Page interactions such as clicking a page to reposition the caret recompute the caret location and immediately call `positionRulers()` so the rulers follow the new active page. 【F:js/document/pageLifecycle.js†L151-L177】

These call sites explain why scrolling appears to help: a page activation or caret move triggered by scroll will fall through the same helper and force a fresh `positionRulers()` run.

## 3. Safari-specific scheduling that now wraps the markers
- Because Safari was lagging behind, the current build keeps persistent triangle nodes (`ensureRulerMarkers()`) instead of rebuilding them on every call. That helper clears the container only when the nodes go missing, then reuses the same elements thereafter. 【F:js/layout/layoutAndZoomController.js†L419-L445】
- A Safari-only loop (`ensureSafariRulerSyncLoop()`) holds the margin markers in a requestAnimationFrame/update cycle for up to 240 ms after every change, repeatedly invoking `positionRulersImmediate({ skipTickUpdate: true })` until the timer expires. 【F:js/layout/layoutAndZoomController.js†L469-L506】
- When rulers are hidden the loop is cancelled (`clearPendingRulerFrames()`), so the extra work is supposed to stay scoped to visible rulers. 【F:js/layout/layoutAndZoomController.js†L508-L546】

## 4. Behaviour before the recent Safari patches
The previous implementation rebuilt the triangle nodes from scratch on every `positionRulers()` call. That logic forced Safari to remove and recreate the elements, which implicitly flushed layout before assigning fresh positions:

```js
function positionRulers() {
  if (!state.showRulers) return;
  if (!app.rulerH_stops_container || !app.rulerV_stops_container) return;
  app.rulerH_stops_container.innerHTML = '';
  app.rulerV_stops_container.innerHTML = '';
  const pageRect = getActivePageRect();
  const snap = computeSnappedVisualMargins();
  const mLeft = document.createElement('div');
  mLeft.className = 'tri left';
  mLeft.style.left = `${pageRect.left + snap.leftPx * state.zoom}px`;
  app.rulerH_stops_container.appendChild(mLeft);
  const mRight = document.createElement('div');
  mRight.className = 'tri right';
  mRight.style.left = `${pageRect.left + snap.rightPx * state.zoom}px`;
  app.rulerH_stops_container.appendChild(mRight);
  const mTop = document.createElement('div');
  mTop.className = 'tri-v top';
  mTop.style.top = `${pageRect.top + snap.topPx * state.zoom}px`;
  app.rulerV_stops_container.appendChild(mTop);
  const mBottom = document.createElement('div');
  mBottom.className = 'tri-v bottom';
  mBottom.style.top = `${pageRect.top + (app.PAGE_H - snap.bottomPx) * state.zoom}px`;
  app.rulerV_stops_container.appendChild(mBottom);
  updateRulerTicks(pageRect);
}
```

That behaviour explains why scrolling—which mutates the DOM around the page wrappers—still gives you smooth updates: Safari sees DOM nodes being inserted and flushed each frame.

## 5. Why the current build still pauses in Safari
- **Lack of a layout flush on style updates.** The new code only mutates `style.left`/`style.top` on existing elements. Safari appears to defer applying those updates until another layout invalidation (such as scrolling) occurs. The old implementation's `innerHTML = ''` + append sequence forced a synchronous style flush that Safari honoured immediately.
- **Animation loop start time.** The rAF loop waits for Safari to grant a frame. If Safari is batching DOM work, the first rAF may not execute until after Safari finishes internal reflow—which lines up with the user-observed ~1 s delay that grows as the session accumulates more pending work.
- **Tick rebuilding is skipped during the loop.** While the loop runs with `skipTickUpdate: true`, tick marks stay stale. Scrolling triggers a full `positionRulersImmediate()` (without the skip flag) via other code paths, which rebuilds ticks and triangles together. That difference contributes to “markers catching up” only after scroll.

## 6. Investigative next steps
1. Reintroduce a cheap layout read (e.g., `markers.hLeft.offsetWidth`) after updating the marker styles to see whether forcing layout resolves Safari's delay without recreating nodes.
2. Measure how long Safari actually waits before the first `requestAnimationFrame` callback after typing by logging timestamps; if it regularly exceeds the 240 ms window, a synchronous fallback (setTimeout 0) may be required.
3. Prototype reverting to the original rebuild logic inside a Safari-only code path to confirm the hypothesis that DOM re-creation is the missing trigger. If that works, search for a lighter-weight flush than full node replacement.
4. Audit other callers (zoom changes, virtualization) to confirm they still invoke `positionRulers()` while the loop is active; a missed call could leave `safariRulerSyncDeadline` low and prevent the loop from extending during continuous typing.
