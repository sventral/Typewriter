# Typewriter

Typewriter is a browser-only, single-page writing app that emulates mechanical typewriter behavior while keeping modern editing and export controls.

## What it includes
- Canvas-based page rendering with rulers, margins, page controls, and zoom.
- Settings panels for `Page`, `Fonts`, `Effects`, `Typewriter realism`, and `Appearance`.
- Ink/effect controls including line slant, glyph jitter, filters, effect randomization, and saved styles.
- Document menu with local persistence, plus export options for raw data, plain text, and PDF.

## Run locally
```bash
npm start
# Serves on http://localhost:8080
```

Any static file server also works.

## Basic use
1. Start the server and open the app in a modern browser.
2. Click the page and type.
3. Open settings from the gear button to tune layout, fonts, effects, and realism options.
4. Use the file toolbar for document switching and export.


## Project layout
```text
Typewriter/
├── index.html         # App shell and UI markup
├── styles.css         # CSS entrypoint
├── styles/            # Modular stylesheets
├── js/                # App logic (init, document, layout, rendering, state, config, utils)
├── fonts/             # Bundled fonts
└── scripts/serve.js   # Local static server
```

## License
`UNLICENSED` (see `package.json`).
