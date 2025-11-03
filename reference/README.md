index_effects.html Overview
* reference/index_effects.html is a self-contained lab UI that demos the typewriter rendering pipeline, pairing a control sidebar with a canvas preview. The document embeds all styling, JavaScript logic, and markup, and exposes helpers intended to be copied back into the main app (the “lift points” comment near the top enumerates which routines are reusable). 
UI & Configuration Controls
* The left-hand panel is generated from PANEL_SCHEMA, which groups fill, edge, grain, defect, and meta settings. Each schema entry defines control type, range, and default, so the build() function can render a consistent form dynamically. Output <output> elements mirror range inputs for live numeric feedback, and UI caches element references for later reads/writes.
* getCfg() compiles current form values into a normalized configuration object, converting numeric fields, clamping ranges, and assembling nested structures (ink, ribbon, bias, dropouts, edgeFuzz, smudge, punch, enable flags). This object becomes the single source for downstream rendering functions. 
Rendering Pipeline Foundations
* Utility helpers cover deterministic pseudo-random functions (mulberry32, hash2, noise2), distance transforms (dtInside, dtOutside), vector math, and lookup-table caching for gamma/rim curves. These underpin texture generation and spatial effects around glyph edges.
* Glyphs are cached by font size/scale to avoid redundant distance-map computation. createDistanceMapProvider() exposes inside/outside distance arrays plus convenience getters, standardizing access for all effect stages. 
Effect Stages
* Effects operate on a coverage buffer via stage functions that only reference shared context (ctx). Notable stages:
    * applyFillAdjustments adds tone, ribbon, vertical bias, and rim modulation before gamma correction.
    * applyDropoutsMask, applyGrainSpeckTexture, and applyCenterEdgeShape apply gap/pinhole masks, stochastic speckles, and center/edge reweighting respectively. 
    * Punch, fuzz, and smudge effects use distance maps to place superellipse holes, noisy fringe expansion, and directional halos outside glyph ink.
    * STAGE_REGISTRY and GLYPH_PIPELINE_ORDER define an explicit sequence for these coverage-only stages, simplifying reuse in other contexts by keeping effect logic decoupled from canvas drawing.
    * 
Rendering Flow & Export
* processGlyph() runs the stage pipeline for each glyph, writing alpha back into an ImageData. render() orchestrates layout: it measures text, creates a supersampled buffer canvas, processes each character with seeded randomness for jitter, and adds a final grain pass over the full canvas.
* exportRepoStyleConfig() converts the UI state into a repo-friendly section map, mirroring the production configuration format (sectionOrder, per-section strength, and nested config). 
Interaction Logic
* Event handlers debounce rerenders on input changes, support manual render/randomization, and provide JSON import/export/copy utilities. collectUI() and applyUI() round-trip the panel state, keyed by element IDs, enabling presets or sharing configurations. A font-load guard ensures the custom typeface is available before the first render.
