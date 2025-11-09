# 400% Zoom Performance Review

## Observed Symptoms
- Typing and caret motion feel choppy, and scroll gestures stutter noticeably once the zoom slider reaches 400%. The virtual stage still shows only one active page, yet the browser spends time recalculating layout for the whole document.

## Hotspots Identified
1. **Frequent virtualization passes triggered by caret updates.** `updateCaretPosition()` always calls `requestVirtualization()`, so every keystroke queues a full visible-window scan that walks every page and measures their rectangles.【F:js/document/documentEditing.js†L117-L135】【F:js/document/pageLifecycle.js†L375-L518】
2. **Anchor nudging recalculates virtualization while scrolling.** `nudgePaperToAnchor()` adjusts the translated stage and calls `setPaperOffset()`. That setter snaps offsets, applies a `translate3d`, and immediately queues virtualization, even if the active window did not change.【F:js/layout/layoutAndZoomController.js†L223-L238】 At 400% zoom the anchor loop runs almost every animation frame, so virtualization fires continuously.
3. **Virtualization recomputes geometry by measuring DOM nodes.** `visibleWindowIndices()` relies on `getPageViewportRect()`, which calls `getBoundingClientRect()` for each page whenever their cached geometry is marked dirty. Zoom changes or stage translations at large scales tend to invalidate the cache often, forcing repeated synchronous layout work.【F:js/document/pageLifecycle.js†L100-L155】

## Low-Risk Mitigation Ideas
1. **Gate virtualization during text batches.** `insertStringFast()` already freezes virtualization while it streams characters, but `insertText()` (used for ordinary typing) does not. Wrapping the body of `insertText()` with a temporary `setFreezeVirtual(true)`/`false` guard would prevent per-keystroke window recalculations while the caret stays on the same page.【F:js/document/documentEditing.js†L180-L247】【F:js/document/documentEditing.js†L306-L319】 Pair the guard with a single explicit `requestVirtualization()` when the batch completes.
2. **Debounce offset-driven virtualization.** Allow `setPaperOffset()` to skip `requestVirtualization()` if the newly snapped offsets stay within a small epsilon of the previous values. Deferring the virtualization request to a shared `requestAnimationFrame` tick would let multiple anchor nudges or scroll-wheel deltas coalesce into one visibility pass.【F:js/layout/layoutAndZoomController.js†L223-L314】
3. **Cache visibility using observers.** Instead of measuring every page on demand, attach an `IntersectionObserver` (or reuse the existing `ResizeObserver`) to maintain a lightweight list of visible page indices. `visibleWindowIndices()` could then read that cache and only fall back to manual rect computations when the observer is unavailable, reducing layout thrash at high zoom factors.【F:js/document/pageLifecycle.js†L375-L494】

## Suggested Validation
After implementing the mitigations, verify that:
- Typing continuous text at 400% no longer spikes the main thread (record with DevTools Performance).
- Scroll and pinch/zoom gestures still keep the caret anchored correctly and do not reactivate distant pages unexpectedly.
- Regression tests (`npm test`) remain green, and the stage still renders the correct number of canvases at other zoom levels.
