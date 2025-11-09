# Typewriter

Typewriter is a single-page web app that recreates the feel of writing on a mechanical typewriter. The page canvas renders every keystroke, applies ink grain, and respects ruler and margin settings without any server component.

## Highlights
- Canvas-based typing stage with ruler guides, draggable margins, and zoom controls.
- Black, red, and erase inks with grain effects and adjustable opacity.
- Documents and settings persist automatically in browser storage, while the **Save** button downloads a snapshot of the current text.

## Run it locally
```bash
npm start
# Serves the project on http://localhost:8080
```

Any static file server (for example, `python -m http.server 8080`) can also host the app.

## Basic usage
1. Start a local server and open the site in a modern browser.
2. Click the paper to focus the stage and begin typing.
3. Use the toolbar to tweak fonts, margins, zoom, and ink options.
4. Press **Save** to download a text export; typing updates are saved to local storage automatically.

## Project layout
```
Typewriter/
├── index.html         # Application shell and UI markup
├── styles.css         # Theme variables, layout, and responsive rules
├── js/
│   ├── main.js        # Entry point that bootstraps the app
│   ├── initApp.js     # Core initialization and wiring
│   ├── init/          # Context factories and UI bindings
│   ├── document/      # Document editing and page lifecycle helpers
│   ├── layout/        # Stage sizing and zoom management
│   ├── rendering/     # Glyph atlas and page rendering logic
│   ├── state/         # Persistent and transient state stores
│   └── utils/         # DOM, math, and form utilities
├── fonts/             # Bundled TT2020 typewriter fonts
└── scripts/serve.js   # Minimal static dev server used by `npm start`
```

## Manual test checklist
- Open the app in a browser that supports OffscreenCanvas (Chrome, Edge) and enable experimental ink effects. Type a few lines with black, red, and erase inks to confirm glyphs render once the worker-built atlas returns.
- Scroll several pages while zooming in and out; ensure characters remain crisp and no rows are skipped while atlases stream in from the worker.
- Toggle between experimental and classic ink pipelines (or rebuild atlases via the theme controls) to verify the worker cache resets cleanly without leaving stale glyphs.

## License
The project is currently distributed without a declared license (marked `UNLICENSED` in `package.json`).

