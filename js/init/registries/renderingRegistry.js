import { registerRenderingControllers } from '../controllers/renderingControllers.js';

function createThemeFacade(rendering) {
  return {
    rebuildAllAtlases: rendering.rebuildAllAtlases,
    schedulePaint: rendering.schedulePaint,
    refreshGlyphEffects: rendering.refreshGlyphEffects,
  };
}

function createLayoutFacade(rendering) {
  return {
    schedulePaint: rendering.schedulePaint,
    rebuildAllAtlases: rendering.rebuildAllAtlases,
  };
}

export function registerRenderingDomain(options) {
  const rendering = registerRenderingControllers({
    ...options,
  });

  return {
    publicApi: {
      refreshGlyphEffects: rendering.refreshGlyphEffects,
      schedulePaint: rendering.schedulePaint,
      rebuildAllAtlases: rendering.rebuildAllAtlases,
    },
    theme: createThemeFacade(rendering),
    layout: createLayoutFacade(rendering),
  };
}
