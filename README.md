# Typewriter

Typewriter is a browser-based typewriter simulator that reproduces mechanical typing, layout controls, and ink effects on a virtual sheet of paper.

## Overview
Typewriter exists to provide a tactile, margin-aware writing experience directly in the browser. It renders each keystroke to an HTML canvas, manages rulers and margins, and emulates typewriter ink behavior without requiring any server-side components. Everything runs client-side, making it easy to experiment with typewriter-style documents offline or embed the experience in other static sites.

## Key Features
- 📝 **Realistic typing canvas** with caret positioning, paper margins, and ruler overlays that mimic a typewriter platen. 【F:index.html†L10-L118】【F:styles.css†L67-L138】
- 🎚️ **Adjustable typography controls** including CPI (characters per inch), font scaling, and line height calibrated against the loaded monospace fonts. 【F:index.html†L72-L109】【F:js/app/initApp.js†L108-L168】
- 🎯 **Margin management** with draggable ruler stops, configurable page margins, and optional margin boxes. 【F:index.html†L10-L118】【F:js/app/state.js†L3-L22】
- 🖋️ **Multi-ink support** for black, red, and white (eraser) inks with opacity sliders and custom grain effects to simulate ribbon texture. 【F:index.html†L40-L70】【F:js/app/inkConfig.js†L1-L51】
- 🔍 **Zoom controls** that rescale the rendering canvas for detailed inspection while keeping the UI responsive to high-DPI displays. 【F:index.html†L18-L33】【F:js/app/initApp.js†L200-L247】
- 🌙 **Light and dark themes** automatically adapting via `prefers-color-scheme`. 【F:styles.css†L1-L66】
- 💾 **Local persistence** leveraging browser storage (key `typewriter.minimal.v16`) to remember documents and settings between sessions. 【F:js/app/metrics.js†L3-L38】【F:js/app/state.js†L3-L22】

## Installation & Setup
1. Clone or download this repository.
2. Ensure the `fonts/` directory remains alongside `index.html` so embedded fonts load correctly.
3. Use any modern browser (Chrome, Firefox, Safari, Edge) that supports ES modules and the Canvas API.

## Running, Building & Testing
- **Run locally (static server):**
  ```bash
  cd Typewriter
  python -m http.server 8080
  ```
  Then open `http://localhost:8080/` in your browser. Any static HTTP server (e.g., `npx serve`, `npm http-server`) will also work.
- **Build:** There is no build pipeline; the site runs directly from source files.
- **Tests:** No automated tests are defined yet. ✅ TODO: add unit or integration tests for rendering and state management.

## Configuration
- **In-app controls:**
  - *Typography*: CPI selector (`10` or `12`), ink width percentage, zoom slider (`50–400%`), and line-height adjustments. 【F:index.html†L72-L109】【F:js/app/initApp.js†L108-L168】
  - *Margins*: Numeric inputs for left/right/top/bottom margins (millimeters) and toggles for margin box visibility and word wrap. 【F:index.html†L110-L143】
  - *Ink*: Black, red, and white ink buttons with long-press opacity sliders; grain percentage dial under **Settings → Ink Effects**. 【F:index.html†L40-L70】【F:index.html†L55-L86】
- **CSS variables:** `styles.css` defines theme colors and page dimensions via `:root` custom properties (e.g., `--page-w`). These can be overridden in a custom build to change the paper size or palette. 【F:styles.css†L1-L66】
- **Local Storage:** Documents persist under the key `typewriter.minimal.v16`; clearing browser storage resets the workspace. 【F:js/app/metrics.js†L3-L38】
- ✅ TODO: Document additional hidden developer hooks or URL flags if they exist.

## Example Usage
```text
1. Launch a local static server and open the app.
2. Click the page to focus the virtual stage and start typing; the caret will move according to configured margins.
3. Use the toolbar to toggle rulers, switch fonts, adjust ink opacity, and open the Settings panel for typography and margin tweaks.
4. Press **Save** to export the current document (saves to local storage and triggers download behavior). 【F:index.html†L10-L118】
```

## Dependencies
- **Runtime:** Modern browser with ES module support, Canvas 2D API, and `FontFaceSet` availability for dynamic font loading. 【F:js/app/initApp.js†L169-L210】
- **Fonts:** Bundled TT2020 monospace font variants located in `fonts/`. 【F:styles.css†L33-L45】
- **Dev tooling:** None required beyond a static file server for local previews.
- ✅ TODO: Document any preferred polyfills if older browsers must be supported.

## Project Structure
```
Typewriter/
├── index.html        # Application shell, DOM layout, and toolbar/panel markup
├── styles.css        # Theming, layout, and responsive rules for the stage, rulers, and panels
├── js/
│   ├── app.js        # Entry point that bootstraps the application on DOM load
│   └── app/
│       ├── domElements.js  # Creates DOM references used throughout the app
│       ├── inkConfig.js    # Consolidated ink, edge bleed, and grain parameters
│       ├── initApp.js      # Core initialization logic, event wiring, rendering helpers
│       ├── metrics.js      # Base metric calculations (page size, DPI, storage key)
│       └── state.js        # Main and ephemeral state factories
├── fonts/             # Embedded TT2020 font files for typewriter realism
└── (static assets)    # TODO: list additional assets if introduced later
```

## Contribution Guidelines
Contributions are welcome! To propose changes:
1. Fork the repository and create a feature branch.
2. Keep the project a pure static build—avoid introducing server dependencies without discussion.
3. Follow the existing ES module structure and avoid bundlers unless the project adopts one.
4. Test changes in at least one modern browser and attach screenshots/GIFs when altering UI behavior.
5. Open a pull request describing the change, motivations, and any new configuration options.

✅ TODO: Add linting rules or code style guides if collaboration expands.

## License
License: ✅ TODO (please specify the intended license for the project).

## Credits & Related Work
- Typewriter fonts appear to derive from the TT2020 family (bundled locally). Please credit the original type foundry or replace with licensed alternatives as appropriate. ✅ TODO: confirm attribution requirements.
- Inspired by classic mechanical typewriters and digital re-creations of typewriter experiences.

