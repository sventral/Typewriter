import { createEnvironment } from './init/environment.js';
import { createRuntimeContext } from './init/runtimeContext.js';
import { registerControllers } from './init/controllerRegistry.js';
import { bootstrapUI } from './init/bootstrapUI.js';

export function initApp() {
  const environment = createEnvironment();
  const runtime = createRuntimeContext(environment);
  const controllerBundle = registerControllers(runtime);

  bootstrapUI({
    state: runtime.state,
    app: environment.app,
    metricsStore: runtime.metricsStore,
    refreshGlyphEffects: controllerBundle.refreshGlyphEffects,
    saveStateDebounced: controllerBundle.saveStateDebounced,
    bootstrapFirstPage: controllerBundle.bootstrapFirstPage,
    loadPersistedState: controllerBundle.loadPersistedState,
    populateInitialUI: controllerBundle.populateInitialUI,
    applyAppearance: controllerBundle.applyAppearance,
    updateStageEnvironment: controllerBundle.updateStageEnvironment,
    setZoomPercent: controllerBundle.setZoomPercent,
    updateZoomUIFromState: controllerBundle.updateZoomUIFromState,
    setPaperOffset: controllerBundle.setPaperOffset,
    loadFontAndApply: controllerBundle.loadFontAndApply,
    setLineHeightFactor: controllerBundle.setLineHeightFactor,
    renderMargins: controllerBundle.renderMargins,
    clampCaretToBounds: controllerBundle.clampCaretToBounds,
    updateCaretPosition: controllerBundle.updateCaretPosition,
    positionRulers: controllerBundle.positionRulers,
    setInk: controllerBundle.setInk,
    requestVirtualization: controllerBundle.requestVirtualization,
  });
}
