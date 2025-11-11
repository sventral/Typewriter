import { detectSafariEnvironment, createStageLayoutController } from '../../layout/stageLayout.js';
import { createLayoutAndZoomController } from '../../layout/layoutAndZoomController.js';

function createNoopLayoutAndZoomApi() {
  return {
    updateStageEnvironment: () => {},
    renderMargins: () => {},
    positionRulers: () => {},
    setPaperOffset: () => {},
    requestHammerNudge: () => {},
    handleWheelPan: () => {},
    handleHorizontalMarginDrag: () => {},
    handleVerticalMarginDrag: () => {},
    endMarginDrag: () => {},
    setMarginBoxesVisible: () => {},
    setZoomPercent: () => {},
    updateZoomUIFromState: () => {},
    onZoomPointerDown: () => {},
    onZoomPointerMove: () => {},
    onZoomPointerUp: () => {},
    sanitizeStageInput: () => null,
    scheduleZoomCrispRedraw: () => {},
  };
}

export function createLayoutBridge(context) {
  let layoutAndZoomApi = createNoopLayoutAndZoomApi();
  context.controllers.layoutAndZoom = layoutAndZoomApi;

  let layoutZoomFactorGetter = () => 1;

  const bridge = {
    updateStageEnvironment: (...args) => layoutAndZoomApi.updateStageEnvironment(...args),
    renderMargins: (...args) => layoutAndZoomApi.renderMargins(...args),
    positionRulers: (...args) => layoutAndZoomApi.positionRulers(...args),
    setPaperOffset: (...args) => layoutAndZoomApi.setPaperOffset(...args),
    requestHammerNudge: (...args) => layoutAndZoomApi.requestHammerNudge(...args),
    handleWheelPan: (...args) => layoutAndZoomApi.handleWheelPan(...args),
    handleHorizontalMarginDrag: (...args) => layoutAndZoomApi.handleHorizontalMarginDrag(...args),
    handleVerticalMarginDrag: (...args) => layoutAndZoomApi.handleVerticalMarginDrag(...args),
    endMarginDrag: (...args) => layoutAndZoomApi.endMarginDrag(...args),
    setMarginBoxesVisible: (...args) => layoutAndZoomApi.setMarginBoxesVisible(...args),
    setZoomPercent: (...args) => layoutAndZoomApi.setZoomPercent(...args),
    updateZoomUIFromState: (...args) => layoutAndZoomApi.updateZoomUIFromState(...args),
    onZoomPointerDown: (...args) => layoutAndZoomApi.onZoomPointerDown(...args),
    onZoomPointerMove: (...args) => layoutAndZoomApi.onZoomPointerMove(...args),
    onZoomPointerUp: (...args) => layoutAndZoomApi.onZoomPointerUp(...args),
    sanitizeStageInput: (...args) => layoutAndZoomApi.sanitizeStageInput(...args),
    scheduleZoomCrispRedraw: () => layoutAndZoomApi.scheduleZoomCrispRedraw?.(),
    getLayoutZoomFactor: () => layoutZoomFactorGetter(),
    setLayoutZoomFactorGetter: (fn) => {
      layoutZoomFactorGetter = typeof fn === 'function' ? fn : () => 1;
    },
    getLayoutAndZoomApi: () => layoutAndZoomApi,
  };

  context.registerLayoutApi({
    updateStageEnvironment: bridge.updateStageEnvironment,
    renderMargins: bridge.renderMargins,
    positionRulers: bridge.positionRulers,
    setPaperOffset: bridge.setPaperOffset,
    requestHammerNudge: bridge.requestHammerNudge,
    handleWheelPan: bridge.handleWheelPan,
    handleHorizontalMarginDrag: bridge.handleHorizontalMarginDrag,
    handleVerticalMarginDrag: bridge.handleVerticalMarginDrag,
    endMarginDrag: bridge.endMarginDrag,
    setMarginBoxesVisible: bridge.setMarginBoxesVisible,
    setZoomPercent: bridge.setZoomPercent,
    updateZoomUIFromState: bridge.updateZoomUIFromState,
    onZoomPointerDown: bridge.onZoomPointerDown,
    onZoomPointerMove: bridge.onZoomPointerMove,
    onZoomPointerUp: bridge.onZoomPointerUp,
  });

  return {
    ...bridge,
    setLayoutAndZoomController(api) {
      layoutAndZoomApi = api || createNoopLayoutAndZoomApi();
      context.controllers.layoutAndZoom = layoutAndZoomApi;
    },
  };
}

export function registerLayoutControllers(params) {
  const {
    app,
    state,
    context,
    metrics,
    metricsStore,
    layoutBridge,
    editing,
    rendering,
    lifecycleController,
    requestVirtualization,
    saveStateDebounced,
    setRenderScaleForZoom,
    getEffectiveRenderZoom,
  } = params;

  const safariEnv = params.safariEnv || detectSafariEnvironment();

  const stageLayoutApi = createStageLayoutController({
    context,
    app,
    state,
    isSafari: safariEnv.isSafari,
    renderMargins: layoutBridge.renderMargins,
    updateStageEnvironment: layoutBridge.updateStageEnvironment,
    updateCaretPosition: editing.updateCaretPosition,
  });

  const {
    layoutZoomFactor,
    cssScaleFactor,
    sanitizedStageWidthFactor,
    sanitizedStageHeightFactor,
    stageDimensions,
    toolbarHeightPx,
    sanitizeStageInput,
    updateZoomWrapTransform,
    syncSafariZoomLayout,
    setSafariZoomMode,
    isSafariSteadyZoom,
  } = stageLayoutApi;

  layoutBridge.setLayoutZoomFactorGetter(layoutZoomFactor);

  const layoutAndZoomController = createLayoutAndZoomController(
    {
      app,
      state,
      DPR: metrics.DPR,
      getCharWidth: () => metricsStore.CHAR_W,
      getGridHeight: () => metricsStore.GRID_H,
      getAsc: () => metricsStore.ASC,
      getDesc: () => metricsStore.DESC,
      getLineStepMu: () => state.lineStepMu,
      layoutController: {
        layoutZoomFactor,
        cssScaleFactor,
        stageDimensions,
        toolbarHeightPx,
        updateZoomWrapTransform,
        sanitizeStageInput,
        setSafariZoomMode,
        isSafariSteadyZoom,
      },
      requestVirtualization,
      saveStateDebounced,
      setRenderScaleForZoom,
      getEffectiveRenderZoom,
      prepareCanvas: (...args) => lifecycleController?.prepareCanvas?.(...args),
      configureCanvasContext: (...args) => lifecycleController?.configureCanvasContext?.(...args),
      schedulePaint: rendering.schedulePaint,
      rebuildAllAtlases: rendering.rebuildAllAtlases,
      setFreezeVirtual: editing.layoutState.setFreezeVirtual,
      getZooming: editing.layoutState.getZooming,
      setZooming: editing.layoutState.setZooming,
      getZoomDebounceTimer: editing.layoutState.getZoomDebounceTimer,
      setZoomDebounceTimer: editing.layoutState.setZoomDebounceTimer,
      getDrag: editing.layoutState.getDrag,
      setDrag: editing.layoutState.setDrag,
      isSafari: safariEnv.isSafari,
      setSafariZoomMode,
      syncSafariZoomLayout,
    },
    lifecycleController,
    editing.editingController,
  );

  layoutBridge.setLayoutAndZoomController(layoutAndZoomController);

  return {
    sanitizedStageWidthFactor,
    sanitizedStageHeightFactor,
    sanitizeStageInput,
    cssScaleFactor,
  };
}
