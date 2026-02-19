# Typomatique

Typomatique is a browser-only, single-page writing app that emulates mechanical typewriter behavior while keeping modern editing and export controls.

## What it includes
- One-screen landing page with Typomatique wordmark, Swiss-style typography/colors, an interactive `page.png` preview (zoom + pan in-place and in expanded view), feature list, quick links, and an `open emulator` CTA.
- Canvas-based page rendering with rulers, margins, page controls, and zoom.
- Settings panels for `Page`, `Fonts`, `Effects`, `Behavior` (`Emulation`, `Appearance`, `Zoom`), `Sync`, and `About` (credits/notices).
- Startup default font is `TT2020 Base`.
- Font presets are `woff2`-first and include web-hosted families from Fontsource CDN and OnlineWebFonts with bundled `woff2` fallbacks.
- The Fonts panel uses the `Pica 10 Pitch` preset label.
- `Letter Gothic`, `Pica 10 Pitch`, `Prestige Elite Std`, and `Prestige Elite Std Bold` are web-only; the app shows a visible error if one is unavailable.
- Behavior `Zoom` controls include `High-zoom performance mode`, `Render soft cap (%)`, `Max extra render zoom (%)`, and a live `At 400% view...` helper line.
- About section starts with an emulator blurb, then a logo + version lockup, and includes a custom site favicon.
- Branding assets (`logo` + favicon) auto-invert for dark mode while staying black in light mode.
- Ink/effect controls including line slant, glyph jitter, baseline character offsets (above/below), filters, effect randomization, and a Manage styles menu (load/save/delete plus file import/export).
- Document menu with local persistence, plus export options for raw data, plain text, and PDF.
- Optional Dropbox sync (`settings.json` + `documents/*.json`) with Connect/Disconnect, manual sync, and auto-sync.
- Sync settings include an in-panel note explaining that Dropbox sync stores settings and documents in `/Apps/Typomatique` for cross-device availability.

## Run locally
```bash
npm start
# Serves on http://localhost:8080
```

Any static file server also works.

## Basic use
1. Start the server and open the app in a modern browser.
2. Click `open emulator` on the landing page.
3. Click the page and type.
4. Open settings from the gear button to tune layout, fonts, effects, and behavior options.
5. Use the file toolbar for document switching and export.

## Dropbox setup (GitHub Pages)
- In `js/storage/dropboxSync.js`, set `DROPBOX_APP_KEY` to your Dropbox app key.
- Register this exact redirect URI in your Dropbox app:
  - `https://sventral.github.io/Typomatique/dropbox-auth.html`
- Keep Dropbox access type as **App Folder**.


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
