# Ink effects configuration flow

## Section registry
- The ink settings panel enumerates five sections with metadata. Each entry records the DOM label, backing config object, slider order, trigger type, bound state key, and default strength (0–100).【F:js/config/inkSettingsPanel.js†L71-L120】
- The default fill section wraps `FILL_CFG`, whose `centerThickenPct` and `edgeThinPct` start from `INK_INTENSITY` defaults via `resolveIntensityConfig`.【F:js/config/inkSettingsPanel.js†L50-L69】

| Section id | Trigger | State key | Default strength | Config highlights |
| --- | --- | --- | --- | --- |
| `fill` | Glyph | `inkFillStrength` | 100 | Percent knobs for center thickening and edge thinning (`FILL_CFG`).【F:js/config/inkSettingsPanel.js†L71-L83】
| `texture` | Glyph | `inkTextureStrength` | 100 when enabled | Full ink texture pipeline including noise, chip, scratch, and jitter seed parameters.【F:js/config/inkSettingsPanel.js†L85-L92】
| `fuzz` | Glyph | `edgeFuzzStrength` | 100 | Edge fuzz noise width, inward share, roughness, frequency, opacity, and seed.【F:js/config/inkSettingsPanel.js†L93-L101】
| `bleed` | Glyph | `edgeBleedStrength` | 0 when disabled | Edge bleed inks, feathering, lightness shift, noise roughness, intensity, and seed.【F:js/config/inkSettingsPanel.js†L102-L110】
| `grain` | Grain | `grainPct` | 0 | Grain overlay scale, gamma, opacity, tile, octave parameters, alpha curve, and seeds.【F:js/config/inkSettingsPanel.js†L111-L118】

The ordering defaults to `['fill', 'texture', 'fuzz', 'bleed', 'grain']` but can be normalized against saved preferences.【F:js/config/inkSettingsPanel.js†L122-L147】

## Default configuration sources
- `INK_INTENSITY` supplies baseline percent ranges for center thickening (default 174%) and edge thinning (default 122%).【F:js/config/inkConfig.js†L5-L8】
- `INK_TEXTURE` describes the texture stack (supersample, coarse/fine noise, chip, scratch, jitter).【F:js/config/inkConfig.js†L73-L135】
- `EDGE_FUZZ` and `EDGE_BLEED` define edge treatments, with bleed normalized from `EDGE_BLEED_DEFAULTS`.【F:js/config/inkConfig.js†L137-L219】
- `GRAIN_CFG` stores the inactive-by-default grain overlay recipe, including octave weights, seeds, and compositing mode.【F:js/config/inkConfig.js†L221-L236】

## Panel ↔ state bindings
- Slider utilities (`getPercentFromState`, `setPercentOnState`, `getScalarFromState`, `setScalarOnState`) read/write numeric percentages on the shared application state object.【F:js/config/inkSettingsPanel.js†L864-L894】
- Applying a section strength updates the corresponding state key, flips the config's `enabled` flag, syncs UI controls, and schedules the appropriate refresh (`glyph` vs `grain`).【F:js/config/inkSettingsPanel.js†L1474-L1495】
- `scheduleGlyphRefresh` debounces calls to the renderer's `refreshGlyphs` callback, propagating whether a full atlas rebuild is required; `scheduleGrainRefresh` similarly gates grain refreshes.【F:js/config/inkSettingsPanel.js†L1426-L1448】
- `scheduleRefreshForMeta` routes section changes to either glyph or grain pipelines, forcing glyph rebuilds on all sections except the fuzz strength slider (which can reuse atlases).【F:js/config/inkSettingsPanel.js†L1451-L1462】
- Center-thicken and edge-thin setters update both state scalars and the in-memory fill config, then trigger glyph refreshes when not silent.【F:js/config/inkSettingsPanel.js†L1945-L1983】
- `getInkEffectFactor`, `getCenterThickenFactor`, `getEdgeThinFactor`, and `getInkSectionStrength` expose normalized multipliers for the renderer and atlas code, folding in panel strength and default enablement flags.【F:js/config/inkSettingsPanel.js†L1845-L1904】
- `isInkSectionEnabled` and `getInkSectionOrder` reflect panel toggles back to the renderer, respecting saved order overrides.【F:js/config/inkSettingsPanel.js†L1907-L1921】
- `setupInkSettingsPanel` injects the host `state`, DOM refs, and renderer callbacks (`refreshGlyphs`, `refreshGrain`, `saveState`), then wires inputs, saved styles, and section ordering before first render.【F:js/config/inkSettingsPanel.js†L2028-L2080】

## Application state defaults
The main state factory seeds effect-related fields so the panel has values to read/write:
- Overall strength, per-section strengths, and fill percentages (`effectsOverallStrength`, `inkFillStrength`, `centerThickenPct`, `edgeThinPct`, `inkTextureStrength`, `edgeBleedStrength`, `edgeFuzzStrength`, `grainPct`).【F:js/state/state.js†L37-L45】
- Default section order (`inkSectionOrder`) and ink-style persistence (`savedInkStyles`).【F:js/state/state.js†L47-L57】

## Renderer integration
- `createGlyphAtlas` receives the exported factor helpers (`getCenterThickenFactor`, `getEdgeThinFactor`, `getInkEffectFactor`, `getInkSectionStrength`, `getInkSectionOrder`, `isInkSectionEnabled`) plus direct config providers to compute glyph textures and shader uniforms.【F:js/initApp.js†L363-L387】
- `createPageRenderer` captures the same section order getter and returns `refreshGlyphEffects` / `refreshGrainEffects` to invalidate atlases or cached grain textures when notified by the panel.【F:js/initApp.js†L415-L438】【F:js/rendering/pageRendering.js†L111-L133】
- During initialization, the app calls `setupInkSettingsPanel` with the live state and the renderer refresh hooks so UI interactions can schedule redraws.【F:js/initApp.js†L862-L869】

## Lifecycle hooks to trigger when switching effect modes
1. Panel inputs call `applySectionStrength`, which updates state, toggles config enablement, and invokes `scheduleRefreshForMeta`.【F:js/config/inkSettingsPanel.js†L1474-L1495】
2. `scheduleRefreshForMeta` dispatches to `scheduleGlyphRefresh` or `scheduleGrainRefresh` depending on the section's `trigger`.【F:js/config/inkSettingsPanel.js†L1451-L1462】
3. The scheduler batches callbacks via `requestAnimationFrame` and eventually calls `refreshGlyphEffects` (with rebuild hint) or `refreshGrainEffects` supplied by the renderer factory.【F:js/config/inkSettingsPanel.js†L1426-L1448】【F:js/rendering/pageRendering.js†L111-L133】
4. `refreshGlyphEffects` optionally rebuilds glyph atlases and marks every page dirty, while `refreshGrainEffects` clears grain caches and schedules a repaint of affected canvases.【F:js/rendering/pageRendering.js†L111-L133】

Together these steps guarantee that toggling effect modes or strengths propagates through state, atlas generation, and page drawing without redundant work.
