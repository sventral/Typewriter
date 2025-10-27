# Core App Modules

This directory contains the building blocks that initialize the simulator, wire up the UI, and manage rendering.

## Files
- `domElements.js` — Collects DOM references for the stage, rulers, toolbar controls, and settings panels.
- `grainConfig.js` — Defines reusable noise/grain parameters shared by the ink renderer.
- `initApp.js` — Main initializer that composes DOM refs, metrics, and state, registers event handlers, and orchestrates rendering batches.
- `metrics.js` — Calculates DPI-aware measurements (grid size, baseline offsets, storage keys) and exposes helpers for persistence.
- `state.js` — Provides factories for the persistent document state and transient session state.

## Conventions
- Keep functions pure where possible; mutating browser state should happen close to the event handlers in `initApp.js`.
- New modules should export factories or helpers with descriptive names (`createSomething`, `computeSomething`) to match the existing style.
