import { markDocumentDirty } from '../state/saveRevision.js';
import { createDocumentControls } from './ui/documentControls.js';
import { createInkControls } from './ui/inkControls.js';
import { createMeasurementControls } from './ui/measurementControls.js';

export function setupUIBindings(context, controllers) {
  const {
    app,
    state,
    storageKey,
    focusStage,
    pxX,
    pxY,
    mmX,
    mmY,
    sanitizeStageInput,
    sanitizedStageWidthFactor,
    sanitizedStageHeightFactor,
    updateStageEnvironment,
    renderMargins,
    clampCaretToBounds,
    updateCaretPosition,
    positionRulers,
    requestVirtualization,
    schedulePaint,
    setRenderScaleForZoom,
    setZoomPercent,
    applyDefaultMargins,
    computeColsFromCpi,
    applySubmittedChanges,
    applyLineHeight,
    readStagedLH,
    toggleRulers,
    toggleInkSettingsPanel,
    loadFontAndApply,
    requestHammerNudge,
    isZooming,
    setDrag,
    getSaveTimer,
    setSaveTimer,
    gridDiv,
  } = context;

  const { editing, layout, input, theme } = controllers;
  const { setInk, createNewDocument, serializeState, deserializeState } = editing;

  const {
    handleWheelPan,
    handleHorizontalMarginDrag,
    handleVerticalMarginDrag,
    endMarginDrag,
    onZoomPointerDown,
    onZoomPointerMove,
    onZoomPointerUp,
    setMarginBoxesVisible,
    scheduleZoomCrispRedraw,
  } = layout;

  const { handleKeyDown, handlePaste } = input;

  const documentControls = createDocumentControls({
    app,
    state,
    storageKey,
    focusStage,
    updateStageEnvironment,
    setZoomPercent,
    renderMargins,
    setMarginBoxesVisible,
    clampCaretToBounds,
    updateCaretPosition,
    positionRulers,
    requestVirtualization,
    requestHammerNudge,
    isZooming,
    createNewDocument,
    serializeState,
    deserializeState,
    getSaveTimer,
    setSaveTimer,
  });

  const queueDirtySave = () => {
    markDocumentDirty(state);
    documentControls.saveStateDebounced();
  };

  const inkControls = createInkControls({
    app,
    state,
    setInk,
    schedulePaint,
    queueDirtySave,
    toggleInkSettingsPanel,
    loadFontAndApply,
    focusStage,
    theme,
  });

  const measurementControls = createMeasurementControls({
    app,
    state,
    pxX,
    pxY,
    mmX,
    mmY,
    focusStage,
    renderMargins,
    clampCaretToBounds,
    updateCaretPosition,
    positionRulers,
    queueDirtySave,
    sanitizeStageInput,
    sanitizedStageWidthFactor,
    sanitizedStageHeightFactor,
    updateStageEnvironment,
    requestVirtualization,
    applySubmittedChanges,
    applyLineHeight,
    readStagedLH,
    toggleRulers,
    setMarginBoxesVisible,
    setRenderScaleForZoom,
    scheduleZoomCrispRedraw,
    setDrag,
    handleHorizontalMarginDrag,
    handleVerticalMarginDrag,
    endMarginDrag,
    onZoomPointerDown,
    onZoomPointerMove,
    onZoomPointerUp,
    setZoomPercent,
    handleWheelPan,
    requestHammerNudge,
    isZooming,
    applyDefaultMargins,
    computeColsFromCpi,
    gridDiv,
  });

  function bindGlobalListeners() {
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('paste', handlePaste, { capture: true });
    window.addEventListener('beforeunload', documentControls.saveStateNow);
    window.addEventListener('click', () => window.focus(), { passive: true });
  }

  function bindEventListeners() {
    documentControls.bindDocumentControls();
    measurementControls.bindMeasurementControls();
    inkControls.bindInkControls();
    bindGlobalListeners();
  }

  function loadPersistedState() {
    return documentControls.loadPersistedState();
  }

  function populateInitialUI(payload = {}) {
    documentControls.populateDocumentUI(payload);
    measurementControls.populateMeasurementUI({ loaded: payload.loaded });
    inkControls.populateInkUI({ loaded: payload.loaded });
  }

  bindEventListeners();

  return {
    saveStateNow: documentControls.saveStateNow,
    saveStateDebounced: documentControls.saveStateDebounced,
    serializeState,
    deserializeState,
    loadPersistedState,
    populateInitialUI,
  };
}
