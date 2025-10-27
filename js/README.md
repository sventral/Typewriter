# JavaScript Modules

This folder hosts all browser-side logic for the Typewriter simulator. Modules are published as native ES modules—keep imports relative and prefer named exports so tree-shaking remains straightforward if a build step is added later.

## Layout
- `app.js` — Browser entry point that waits for `DOMContentLoaded` and calls `initApp()`.
- `app/` — Core subsystems (DOM binding, metrics, state, rendering helpers). See [`app/README.md`](app/README.md).

## Conventions
- Use **camelCase** for functions and variables, and `SCREAMING_SNAKE_CASE` for shared constants to match existing files.
- Keep each module narrowly focused (DOM wiring, state, rendering, etc.) and colocate new helpers inside `app/` unless they are app-wide entry points.
- Avoid default exports; follow the existing pattern of named exports for clarity in call sites.
