import { setupUIBindings } from './uiBindings.js';
import { detectSafariEnvironment } from '../layout/stageLayout.js';
import { createLayoutBridge, registerLayoutControllers } from './controllers/layoutControllers.js';
import { registerEditingControllers } from './controllers/editingControllers.js';
import { registerRenderingControllers } from './controllers/renderingControllers.js';
import { registerThemeController } from './controllers/themeControllers.js';

export function registerControllers({
  app,
  metrics,
  state,
  context,
  metricsStore,
  metricsOptions,
  recalcMetrics,
  setRenderScaleForZoom,
  getEffectiveRenderZoom,
  getTargetPitchPx,
  primeInitialMetrics,
  createMetricsScheduler,
  ephemeral,
}) {
  const { GRID_DIV, COLORS, STORAGE_KEY } = metrics;

  primeInitialMetrics();

  const rendererApi = typeof context.getRendererApi === 'function'
    ? context.getRendererApi()
    : (context.apis?.renderer || {});

  const layoutBridge = createLayoutBridge(context);
  const saveHooks = { saveStateNow: () => {}, saveStateDebounced: () => {} };

  const editing = registerEditingControllers({
    app,
    state,
    context,
    metrics,
    metricsStore,
    metricsOptions,
    rendererApi,
    gridDiv: GRID_DIV,
    layoutBridge,
    touchedPages: context.touchedPages,
    recalcMetrics,
    createMetricsScheduler,
    getTargetPitchPx,
    getEffectiveRenderZoom,
    saveHooks,
    ephemeral,
  });

  const safariEnv = detectSafariEnvironment();

  const rendering = registerRenderingControllers({
    context,
    app,
    state,
    metricsStore,
    gridDiv: GRID_DIV,
    colors: COLORS,
    editing,
    safariEnv,
  });

  const layout = registerLayoutControllers({
    app,
    state,
    context,
    metrics,
    metricsStore,
    layoutBridge,
    editing,
    rendering,
    lifecycleController: editing.lifecycleController,
    requestVirtualization: editing.requestVirtualization,
    saveStateDebounced: editing.saveStateDebounced,
    setRenderScaleForZoom,
    getEffectiveRenderZoom,
    safariEnv,
  });

  const { themeController, applyAppearance } = registerThemeController({
    app,
    state,
    colors: COLORS,
    rebuildAllAtlases: rendering.rebuildAllAtlases,
    touchPage: editing.touchPage,
    schedulePaint: rendering.schedulePaint,
    refreshGlyphEffects: rendering.refreshGlyphEffects,
    beginBatch: editing.beginBatch,
    endBatch: editing.endBatch,
    setInk: editing.setInk,
    focusStage: editing.focusStage,
    saveStateDebounced: editing.saveStateDebounced,
  });

  const uiBindings = setupUIBindings(
    {
      app,
      state,
      storageKey: STORAGE_KEY,
      focusStage: editing.focusStage,
      pxX: editing.pxX,
      pxY: editing.pxY,
      mmX: editing.mmX,
      mmY: editing.mmY,
      sanitizeStageInput: layout.sanitizeStageInput,
      sanitizedStageWidthFactor: layout.sanitizedStageWidthFactor,
      sanitizedStageHeightFactor: layout.sanitizedStageHeightFactor,
      updateStageEnvironment: layoutBridge.updateStageEnvironment,
      renderMargins: layoutBridge.renderMargins,
      clampCaretToBounds: editing.clampCaretToBounds,
      updateCaretPosition: editing.updateCaretPosition,
      positionRulers: layoutBridge.positionRulers,
      requestVirtualization: editing.requestVirtualization,
      schedulePaint: rendering.schedulePaint,
      setRenderScaleForZoom,
      setZoomPercent: layoutBridge.setZoomPercent,
      applyDefaultMargins: editing.applyDefaultMargins,
      computeColsFromCpi: editing.computeColsFromCpi,
      gridDiv: GRID_DIV,
      applySubmittedChanges: editing.applySubmittedChanges,
      applyLineHeight: editing.applyLineHeight,
      readStagedLH: editing.readStagedLH,
      toggleRulers: editing.toggleRulers,
      toggleInkSettingsPanel: editing.toggleInkSettingsPanel,
      loadFontAndApply: editing.loadFontAndApply,
      requestHammerNudge: layoutBridge.requestHammerNudge,
      isZooming: editing.layoutState.getZooming,
      setDrag: editing.layoutState.setDrag,
      getSaveTimer: editing.layoutState.getSaveTimer,
      setSaveTimer: editing.layoutState.setSaveTimer,
    },
    {
      editing: {
        setInk: editing.setInk,
        createNewDocument: editing.createNewDocument,
        serializeState: editing.serializeState,
        deserializeState: editing.deserializeState,
      },
      layout: {
        handleWheelPan: layoutBridge.handleWheelPan,
        handleHorizontalMarginDrag: layoutBridge.handleHorizontalMarginDrag,
        handleVerticalMarginDrag: layoutBridge.handleVerticalMarginDrag,
        endMarginDrag: layoutBridge.endMarginDrag,
        onZoomPointerDown: layoutBridge.onZoomPointerDown,
        onZoomPointerMove: layoutBridge.onZoomPointerMove,
        onZoomPointerUp: layoutBridge.onZoomPointerUp,
        setMarginBoxesVisible: layoutBridge.setMarginBoxesVisible,
        scheduleZoomCrispRedraw: layoutBridge.scheduleZoomCrispRedraw,
      },
      input: editing.inputController,
      theme: themeController,
    },
  );

  saveHooks.saveStateNow = uiBindings.saveStateNow;
  saveHooks.saveStateDebounced = uiBindings.saveStateDebounced;

  const { loadPersistedState, populateInitialUI } = uiBindings;

  return {
    saveStateNow: editing.saveStateNow,
    saveStateDebounced: editing.saveStateDebounced,
    refreshGlyphEffects: rendering.refreshGlyphEffects,
    refreshGrainEffects: rendering.refreshGrainEffects,
    bootstrapFirstPage: editing.bootstrapFirstPage,
    loadPersistedState,
    populateInitialUI,
    applyAppearance,
    updateStageEnvironment: layoutBridge.updateStageEnvironment,
    setZoomPercent: layoutBridge.setZoomPercent,
    updateZoomUIFromState: layoutBridge.updateZoomUIFromState,
    setPaperOffset: layoutBridge.setPaperOffset,
    loadFontAndApply: editing.loadFontAndApply,
    setLineHeightFactor: editing.setLineHeightFactor,
    renderMargins: layoutBridge.renderMargins,
    clampCaretToBounds: editing.clampCaretToBounds,
    updateCaretPosition: editing.updateCaretPosition,
    positionRulers: layoutBridge.positionRulers,
    setInk: editing.setInk,
    requestVirtualization: editing.requestVirtualization,
    scheduleMetricsUpdate: editing.scheduleMetricsUpdate,
    uiBindings,
    themeController,
    layoutAndZoomApi: () => context.controllers.layoutAndZoom,
  };
}
