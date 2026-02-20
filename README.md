# Typomatique

Typomatique is a browser-only, single-page writing app that emulates mechanical typewriter behavior while keeping modern editing and export controls.

## What it includes

* A browser-based mechanical typewriter emulator and writing app (online typewriter simulator) that combines authentic typewriter behavior with modern editing and export tools.
* Use cases: write in a distraction-free, old-school way; draft fiction or letters; generate typewritten-looking material for graphic design and layout; create believable “typed” props for film, theatre, games, or tabletop; or just mess around for fun.
* A simple landing page with a live, interactive page preview and an “Open emulator” button, plus quick access to the guide and About/credits.
* A built-in guide that opens inside the app and includes section illustrations that reflow to fit your screen.
* Canvas page rendering with rulers, margins, page layout controls, and smooth zoom (including high-zoom performance options).
* Typeface presets geared toward classic typewriter fonts; default is TT2020 Base. WOFF2-first loading with bundled fallbacks, plus clear error messaging when certain web-only fonts can’t load.
* “Ink” and print-wear effects (e.g., slant, jitter, baseline offsets, filters), including effect randomization and a styles manager (save/load/delete, import/export).
* Document management with local persistence and exports for raw project data, plain text, and PDF.
* Optional Dropbox sync for settings and documents (stored in “/Apps/Typomatique”) for cross-device access, with manual sync and auto-sync options.
* Light/dark mode support, including branding assets that auto-invert for dark mode while staying black in light mode.


## Project layout
```text
Typomatique/
├── index.html         # App shell and UI markup
├── styles.css         # CSS entrypoint
├── styles/            # Modular stylesheets
├── js/                # App logic (init, document, layout, rendering, state, config, utils)
├── fonts/             # Bundled fonts
└── scripts/serve.js   # Local static server
```

## License
This project is licensed under PolyForm Noncommercial 1.0.0. Commercial use is not included. For commercial licensing, contact the creator.
