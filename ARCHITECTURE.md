# Architecture Overview

## What the app does
The Typewriter app renders a full-screen, canvas-driven simulation of a mechanical typewriter. It reproduces caret movement, margin stops, adjustable fonts, and ink effects entirely in the browser without a build step or backend.

## Rendering subsystem
- **Canvas stage:** `index.html` defines the paper canvas, rulers, and control panels. `js/app/initApp.js` prepares the `<canvas>` element, calibrates fonts, and keeps the drawing context in sync with zoom and device pixel ratio.
- **Painting pipeline:** Batched `requestAnimationFrame` loops collect dirty pages (`touchPage`) and replay the buffer of typed glyphs with grain shading from `grainConfig.js`. Canvas preparation and glyph metrics ensure monospaced layout across zoom levels.
- **Themes & layout:** `styles.css` provides CSS variables for page sizing, rulers, and light/dark themes that frame the canvas and toolbar.

## Input & interaction subsystem
- **DOM wiring:** `createDomRefs` in `js/app/domElements.js` gathers all interactive controls (toolbar, sliders, rulers, stage) so the initializer can attach listeners.
- **Event handling:** `initApp.js` registers keyboard, pointer, and form events. It sanitizes numeric inputs (margins, line height), debounces zoom sliders, and routes keystrokes to caret logic. Toolbar helpers like `isToolbarInput` keep focus on the stage while still allowing UI tweaks.
- **Accessibility:** Focus management (`focusStage`) prevents unexpected blur states and keeps typing responsive.

## State & persistence subsystem
- **Main document state:** `createMainState` in `js/app/state.js` tracks page buffers, caret coordinates, margins, zoom, and ink selection.
- **Ephemeral/session state:** `createEphemeralState` collects transient flags (dragging, batching, timers) that do not persist between sessions.
- **Metrics & storage:** `js/app/metrics.js` computes DPI-derived constants and the `typewriter.minimal.v16` storage key. Persistence helpers in `metrics.js` and `state.js` serialize document data into `localStorage`.

## How pieces talk
1. `js/app.js` waits for DOM readiness, then calls `initApp()`.
2. `initApp()` pulls DOM handles, derives metrics, and builds state factories.
3. Event listeners mutate main or ephemeral state, mark affected pages, and schedule paints.
4. When a paint batch runs, the renderer reads state buffers and metrics to redraw the canvas with the calibrated font and ink grain.

See [`js/README.md`](js/README.md) and [`js/app/README.md`](js/app/README.md) for module-level details.
