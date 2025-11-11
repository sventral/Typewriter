const noop = () => {};

function assignApi(target, partial) {
  if (!partial) return;
  for (const key of Object.keys(target)) {
    if (typeof partial[key] === 'function') {
      target[key] = partial[key];
    }
  }
}

export function createAppContext({ app, state, metrics, ephemeral }) {
  const scalars = {
    GRID_H: metrics.GRID_H,
    ACTIVE_FONT_NAME: metrics.ACTIVE_FONT_NAME,
    RENDER_SCALE: metrics.RENDER_SCALE,
    FONT_FAMILY: metrics.FONT_FAMILY,
    FONT_SIZE: metrics.FONT_SIZE,
    ASC: metrics.ASC,
    DESC: metrics.DESC,
    CHAR_W: metrics.CHAR_W,
    BASELINE_OFFSET_CELL: metrics.BASELINE_OFFSET_CELL,
  };

  const rendererApi = {
    rebuildAllAtlases: noop,
    schedulePaint: noop,
    invalidateGrainCache: noop,
  };

  const layoutApi = {
    updateStageEnvironment: noop,
    renderMargins: noop,
    positionRulers: noop,
    setPaperOffset: noop,
    requestHammerNudge: noop,
    handleWheelPan: noop,
    handleHorizontalMarginDrag: noop,
    handleVerticalMarginDrag: noop,
    endMarginDrag: noop,
    setMarginBoxesVisible: noop,
    setZoomPercent: noop,
    updateZoomUIFromState: noop,
    onZoomPointerDown: noop,
    onZoomPointerMove: noop,
    onZoomPointerUp: noop,
  };

  const context = {
    app,
    state,
    metrics,
    scalars,
    ephemeral,
    touchedPages: ephemeral?.touchedPages || new Set(),
    controllers: {
      layoutAndZoom: null,
      lifecycle: null,
    },
    apis: {
      renderer: rendererApi,
      layout: layoutApi,
    },
    getScalar(key) {
      return scalars[key];
    },
    setScalar(key, value) {
      scalars[key] = value;
    },
    getRendererApi() {
      return rendererApi;
    },
    registerRendererApi(partial) {
      assignApi(rendererApi, partial);
    },
    getLayoutApi() {
      return layoutApi;
    },
    registerLayoutApi(partial) {
      assignApi(layoutApi, partial);
    },
  };

  return context;
}
