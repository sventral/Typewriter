# TypeSim

TypeSim is a browser-only, single-page writing app that emulates mechanical typewriter behavior while keeping modern editing and export controls.

## What it includes
- Canvas-based page rendering with rulers, margins, page controls, and zoom.
- Settings panels for `Page`, `Fonts`, `Effects`, `Behavior` (`Emulation`, `Appearance`, `Zoom`), `Sync`, and `About` (credits/notices).
- Settings pane branding with a bottom-left logo lockup, version label, and a custom site favicon.
- Branding assets (`logo` + favicon) auto-invert for dark mode while staying black in light mode.
- Ink/effect controls including line slant, glyph jitter, filters, effect randomization, and a Manage styles menu (load/save/delete plus file import/export).
- Document menu with local persistence, plus export options for raw data, plain text, and PDF.
- Optional Dropbox sync (`settings.json` + `documents/*.json`) with Connect/Disconnect, manual sync, and auto-sync.

## Run locally
```bash
npm start
# Serves on http://localhost:8080
```

Any static file server also works.

## Basic use
1. Start the server and open the app in a modern browser.
2. Click the page and type.
3. Open settings from the gear button to tune layout, fonts, effects, and behavior options.
4. Use the file toolbar for document switching and export.

## Dropbox setup (GitHub Pages)
- In `js/storage/dropboxSync.js`, set `DROPBOX_APP_KEY` to your Dropbox app key.
- Register this exact redirect URI in your Dropbox app:
  - `https://sventral.github.io/TypeSim/dropbox-auth.html`
- Keep Dropbox access type as **App Folder**.


## Project layout
```text
TypeSim/
├── index.html         # App shell and UI markup
├── styles.css         # CSS entrypoint
├── styles/            # Modular stylesheets
├── js/                # App logic (init, document, layout, rendering, state, config, utils)
├── fonts/             # Bundled fonts
└── scripts/serve.js   # Local static server
```

## License
`UNLICENSED` (see `package.json`).
