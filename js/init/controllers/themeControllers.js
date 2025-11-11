import { createThemeController } from '../../config/themeController.js';

export function registerThemeController(options) {
  const {
    app,
    state,
    colors,
    rebuildAllAtlases,
    touchPage,
    schedulePaint,
    refreshGlyphEffects,
    beginBatch,
    endBatch,
    setInk,
    focusStage,
    saveStateDebounced,
  } = options;

  const prefersDarkMedia = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  const themeController = createThemeController({
    app,
    state,
    colors,
    prefersDarkMedia,
    rebuildAllAtlases,
    touchPage,
    schedulePaint,
    refreshGlyphEffects,
    beginBatch,
    endBatch,
    setInk,
    focusStage,
    saveStateDebounced,
  });

  return {
    themeController,
    applyAppearance: themeController.applyAppearance,
  };
}
