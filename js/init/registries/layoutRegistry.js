import { createLayoutBridge, registerLayoutControllers } from '../controllers/layoutControllers.js';

function createUiFacade(layoutControllers) {
  return {
    sanitizedStageWidthFactor: layoutControllers.sanitizedStageWidthFactor,
    sanitizedStageHeightFactor: layoutControllers.sanitizedStageHeightFactor,
    sanitizeStageInput: layoutControllers.sanitizeStageInput,
    cssScaleFactor: layoutControllers.cssScaleFactor,
  };
}

export function registerLayoutDomain(options) {
  const layoutBridge = options.layoutBridge || createLayoutBridge(options.context);
  const layoutControllers = registerLayoutControllers({
    ...options,
    layoutBridge,
  });

  return {
    bridge: layoutBridge,
    ui: createUiFacade(layoutControllers),
  };
}
