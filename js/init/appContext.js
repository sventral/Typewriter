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

  const callbacks = {
    rebuildAllAtlases: () => {},
    schedulePaint: () => {},
    renderMargins: () => {},
    updateStageEnvironment: () => {},
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
  };

  const context = {
    app,
    state,
    metrics,
    scalars,
    ephemeral,
    touchedPages: ephemeral?.touchedPages || new Set(),
    callbacks,
    controllers: {
      layoutAndZoom: null,
      lifecycle: null,
    },
    getScalar(key) {
      return scalars[key];
    },
    setScalar(key, value) {
      scalars[key] = value;
    },
    setCallback(name, fn) {
      if (name && Object.prototype.hasOwnProperty.call(callbacks, name)) {
        callbacks[name] = typeof fn === 'function' ? fn : callbacks[name];
      }
    },
    getCallback(name) {
      return callbacks[name];
    },
  };

  return context;
}
