import { setupUIBindings } from './uiBindings.js';
import { createLayoutBridge } from './controllers/layoutControllers.js';
import { registerEditingDomain } from './registries/editingRegistry.js';
import { registerRenderingDomain } from './registries/renderingRegistry.js';
import { registerLayoutDomain } from './registries/layoutRegistry.js';
import { registerThemeDomain } from './registries/themeRegistry.js';

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

  const editingDomain = registerEditingDomain({
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

  const renderingDomain = registerRenderingDomain({
    context,
    app,
    state,
    metricsStore,
    gridDiv: GRID_DIV,
    colors: COLORS,
    editing: editingDomain.rendering,
  });

  const layoutDomain = registerLayoutDomain({
    app,
    state,
    context,
    metrics,
    metricsStore,
    layoutBridge,
    editing: editingDomain.layout,
    rendering: renderingDomain.layout,
    lifecycleController: editingDomain.lifecycleController,
    requestVirtualization: editingDomain.requestVirtualization,
    saveStateDebounced: editingDomain.persistence.saveStateDebounced,
    setRenderScaleForZoom,
    getEffectiveRenderZoom,
    safariEnv: renderingDomain.safariEnv,
  });

  const themeDomain = registerThemeDomain({
    app,
    state,
    colors: COLORS,
    rebuildAllAtlases: renderingDomain.theme.rebuildAllAtlases,
    touchPage: editingDomain.theme.touchPage,
    schedulePaint: renderingDomain.theme.schedulePaint,
    refreshGlyphEffects: renderingDomain.theme.refreshGlyphEffects,
    beginBatch: editingDomain.theme.beginBatch,
    endBatch: editingDomain.theme.endBatch,
    setInk: editingDomain.theme.setInk,
    focusStage: editingDomain.theme.focusStage,
    saveStateDebounced: editingDomain.theme.saveStateDebounced,
  });

  const uiBindings = setupUIBindings(
    {
      app,
      state,
      storageKey: STORAGE_KEY,
      focusStage: editingDomain.ui.focusStage,
      pxX: editingDomain.ui.pxX,
      pxY: editingDomain.ui.pxY,
      mmX: editingDomain.ui.mmX,
      mmY: editingDomain.ui.mmY,
      sanitizeStageInput: layoutDomain.ui.sanitizeStageInput,
      sanitizedStageWidthFactor: layoutDomain.ui.sanitizedStageWidthFactor,
      sanitizedStageHeightFactor: layoutDomain.ui.sanitizedStageHeightFactor,
      updateStageEnvironment: layoutDomain.bridge.updateStageEnvironment,
      renderMargins: layoutDomain.bridge.renderMargins,
      clampCaretToBounds: editingDomain.ui.clampCaretToBounds,
      updateCaretPosition: editingDomain.ui.updateCaretPosition,
      positionRulers: layoutDomain.bridge.positionRulers,
      requestVirtualization: editingDomain.requestVirtualization,
      schedulePaint: renderingDomain.publicApi.schedulePaint,
      setRenderScaleForZoom,
      setZoomPercent: layoutDomain.bridge.setZoomPercent,
      applyDefaultMargins: editingDomain.ui.applyDefaultMargins,
      computeColsFromCpi: editingDomain.ui.computeColsFromCpi,
      gridDiv: GRID_DIV,
      applySubmittedChanges: editingDomain.ui.applySubmittedChanges,
      applyLineHeight: editingDomain.ui.applyLineHeight,
      readStagedLH: editingDomain.ui.readStagedLH,
      toggleRulers: editingDomain.ui.toggleRulers,
      toggleInkSettingsPanel: editingDomain.ui.toggleInkSettingsPanel,
      loadFontAndApply: editingDomain.ui.loadFontAndApply,
      requestHammerNudge: layoutDomain.bridge.requestHammerNudge,
      isZooming: editingDomain.ui.layoutState.getZooming,
      setDrag: editingDomain.ui.layoutState.setDrag,
      getSaveTimer: editingDomain.ui.layoutState.getSaveTimer,
      setSaveTimer: editingDomain.ui.layoutState.setSaveTimer,
    },
    {
      editing: {
        setInk: editingDomain.document.setInk,
        createNewDocument: editingDomain.document.createNewDocument,
        serializeState: editingDomain.document.serializeState,
        deserializeState: editingDomain.document.deserializeState,
      },
      layout: {
        handleWheelPan: layoutDomain.bridge.handleWheelPan,
        handleHorizontalMarginDrag: layoutDomain.bridge.handleHorizontalMarginDrag,
        handleVerticalMarginDrag: layoutDomain.bridge.handleVerticalMarginDrag,
        endMarginDrag: layoutDomain.bridge.endMarginDrag,
        onZoomPointerDown: layoutDomain.bridge.onZoomPointerDown,
        onZoomPointerMove: layoutDomain.bridge.onZoomPointerMove,
        onZoomPointerUp: layoutDomain.bridge.onZoomPointerUp,
        setMarginBoxesVisible: layoutDomain.bridge.setMarginBoxesVisible,
        scheduleZoomCrispRedraw: layoutDomain.bridge.scheduleZoomCrispRedraw,
      },
      input: editingDomain.document.inputController,
      theme: themeDomain.controller,
    },
  );

  saveHooks.saveStateNow = uiBindings.saveStateNow;
  saveHooks.saveStateDebounced = uiBindings.saveStateDebounced;

  const { loadPersistedState, populateInitialUI } = uiBindings;

  return {
    saveStateNow: editingDomain.persistence.saveStateNow,
    saveStateDebounced: editingDomain.persistence.saveStateDebounced,
    refreshGlyphEffects: renderingDomain.publicApi.refreshGlyphEffects,
    bootstrapFirstPage: editingDomain.persistence.bootstrapFirstPage,
    loadPersistedState,
    populateInitialUI,
    applyAppearance: themeDomain.applyAppearance,
    updateStageEnvironment: layoutDomain.bridge.updateStageEnvironment,
    setZoomPercent: layoutDomain.bridge.setZoomPercent,
    updateZoomUIFromState: layoutDomain.bridge.updateZoomUIFromState,
    setPaperOffset: layoutDomain.bridge.setPaperOffset,
    loadFontAndApply: editingDomain.ui.loadFontAndApply,
    setLineHeightFactor: editingDomain.metrics.setLineHeightFactor,
    renderMargins: layoutDomain.bridge.renderMargins,
    clampCaretToBounds: editingDomain.ui.clampCaretToBounds,
    updateCaretPosition: editingDomain.ui.updateCaretPosition,
    positionRulers: layoutDomain.bridge.positionRulers,
    setInk: editingDomain.document.setInk,
    requestVirtualization: editingDomain.requestVirtualization,
    scheduleMetricsUpdate: editingDomain.persistence.scheduleMetricsUpdate,
    uiBindings,
    themeController: themeDomain.controller,
    layoutAndZoomApi: () => context.controllers.layoutAndZoom,
  };
}
