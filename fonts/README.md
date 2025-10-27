# Fonts

The bundled TT2020 font variants provide the mechanical typewriter look for the canvas renderer.

## Contents
- `TT2020*.woff2` files — Monospaced faces used as primary and fallback fonts.

## Conventions
- Keep filenames in the `TT2020StyleX.woff2` pattern so they line up with the font-face declarations in `styles.css`.
- Add new fonts as `.woff2` (or `.woff`) files and update the `@font-face` blocks in `styles.css` if the naming changes.
- Do not remove existing fonts without adjusting `FONT_CANDIDATES` in `js/app/initApp.js`.
