# Safari Ruler Marker Drift Analysis

## 1. Current marker update flow
- `computeSnappedVisualMargins()` converts editable margin settings into pixel coordinates and grid units that every caller shares. It snaps left/right to character columns and top/bottom to line rows so the visual guides and text layout are driven by the same state. 【F:js/layout/layoutAndZoomController.js†L318-L329】
- `positionRulersImmediate()` reads the active page rectangle, applies those snapped offsets, moves the persistent triangle elements by updating their absolute `left`/`top` styles, and rebuilds the surrounding tick marks. 【F:js/layout/layoutAndZoomController.js†L448-L463】
- The active page rectangle comes from `getActivePageRect()`, which combines the live DOM bounds reported by Safari with the renderer's notion of page height (`app.PAGE_H * state.zoom`). That means the ruler markers are supposed to stay in lock-step with the same geometry the renderer uses. 【F:js/layout/layoutAndZoomController.js†L350-L354】

## 2. When the app calls `positionRulers()`
- Document edits such as typing, wrapping, and caret navigation all end by calling `positionRulers()`, ensuring the markers are supposed to reflect the new layout immediately after each text change. Examples include the batch renderer after typing, overflow handling during word wrap, newline insertion, and backspace navigation. 【F:js/document/documentEditing.js†L241-L318】
- UI refresh paths also invoke it: a full environment refresh after loading a document recalculates layout metrics, snaps margins, and then calls `positionRulers()` before returning control to the browser. 【F:js/init/uiBindings.js†L190-L199】
- Page interactions such as clicking a page to reposition the caret recompute the caret location and immediately call `positionRulers()` so the rulers follow the new active page. 【F:js/document/pageLifecycle.js†L151-L177】

These call sites explain why scrolling appears to help: a page activation or caret move triggered by scroll will fall through the same helper and force a fresh `positionRulers()` run.

## 3. Safari-specific behaviour after the refinement
- The implementation still keeps persistent triangle nodes (`ensureRulerMarkers()`) instead of rebuilding them on every call. That helper clears the container only when the nodes go missing, then reuses the same elements thereafter. 【F:js/layout/layoutAndZoomController.js†L408-L435】
- To force Safari to apply the new `left`/`top` values immediately we now invoke `flushSafariRulerMarkers()` right after mutating the styles. The helper simply reads each marker’s bounding rect which compels Safari to flush layout synchronously. 【F:js/layout/layoutAndZoomController.js†L440-L445】【F:js/layout/layoutAndZoomController.js†L448-L463】
- Because the layout flush happens inline we no longer need the requestAnimationFrame-based safety net, and `positionRulers()` just calls `positionRulersImmediate()` directly. 【F:js/layout/layoutAndZoomController.js†L466-L473】

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

## 5. Root cause of the lag and resolution
- **Deferred style application.** Safari waited to reflect the new `left`/`top` assignments until another layout-invalidating operation (such as scrolling) occurred. Reading the markers’ geometry right after updating the styles forces Safari to flush the layout immediately, restoring frame-by-frame alignment while typing. 【F:js/layout/layoutAndZoomController.js†L440-L463】
- **Unnecessary scheduling overhead.** The requestAnimationFrame loop introduced earlier attempted to paper over the delay, but it still depended on Safari eventually flushing layout. Removing the loop eliminates the extra delay at startup and after each line break. 【F:js/layout/layoutAndZoomController.js†L466-L473】

## 6. Follow-up verification
- Confirm in Safari that typing, inserting new lines, and resizing the window keep the ruler triangles glued to the actual margins without waiting for scroll-induced layout flushes.
- Verify that scrolling still updates the markers smoothly, ensuring the forced layout read has no observable performance regression.
