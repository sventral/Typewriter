import { detectSafariEnvironment } from '../../layout/stageLayout.js';
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
  const safariEnv = options.safariEnv || detectSafariEnvironment();
  const rendering = registerRenderingControllers({
    ...options,
    safariEnv,
  });

  return {
    safariEnv,
    publicApi: {
      refreshGlyphEffects: rendering.refreshGlyphEffects,
      refreshGrainEffects: rendering.refreshGrainEffects,
      schedulePaint: rendering.schedulePaint,
      rebuildAllAtlases: rendering.rebuildAllAtlases,
    },
    theme: createThemeFacade(rendering),
    layout: createLayoutFacade(rendering),
  };
}
