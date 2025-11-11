import { registerEditingControllers } from '../controllers/editingControllers.js';

function createRenderingFacade(editing) {
  return {
    editingController: editing.editingController,
    rendererHooks: editing.rendererHooks,
    getBatchDepth: editing.getBatchDepth,
  };
}

function createLayoutFacade(editing) {
  return {
    updateCaretPosition: editing.updateCaretPosition,
    layoutState: editing.layoutState,
    editingController: editing.editingController,
  };
}

function createThemeFacade(editing) {
  return {
    touchPage: editing.touchPage,
    beginBatch: editing.beginBatch,
    endBatch: editing.endBatch,
    setInk: editing.setInk,
    focusStage: editing.focusStage,
    saveStateDebounced: editing.saveStateDebounced,
  };
}

function createUiFacade(editing) {
  return {
    focusStage: editing.focusStage,
    pxX: editing.pxX,
    pxY: editing.pxY,
    mmX: editing.mmX,
    mmY: editing.mmY,
    clampCaretToBounds: editing.clampCaretToBounds,
    updateCaretPosition: editing.updateCaretPosition,
    requestVirtualization: editing.requestVirtualization,
    applyDefaultMargins: editing.applyDefaultMargins,
    computeColsFromCpi: editing.computeColsFromCpi,
    applySubmittedChanges: editing.applySubmittedChanges,
    applyLineHeight: editing.applyLineHeight,
    readStagedLH: editing.readStagedLH,
    toggleRulers: editing.toggleRulers,
    toggleInkSettingsPanel: editing.toggleInkSettingsPanel,
    loadFontAndApply: editing.loadFontAndApply,
    layoutState: editing.layoutState,
    setInk: editing.setInk,
  };
}

function createDocumentFacade(editing) {
  return {
    setInk: editing.setInk,
    createNewDocument: editing.createNewDocument,
    serializeState: editing.serializeState,
    deserializeState: editing.deserializeState,
    inputController: editing.inputController,
  };
}

function createPersistenceFacade(editing) {
  return {
    saveStateNow: editing.saveStateNow,
    saveStateDebounced: editing.saveStateDebounced,
    scheduleMetricsUpdate: editing.scheduleMetricsUpdate,
    bootstrapFirstPage: editing.bootstrapFirstPage,
  };
}

function createMetricsFacade(editing) {
  return {
    mmX: editing.mmX,
    mmY: editing.mmY,
    pxX: editing.pxX,
    pxY: editing.pxY,
    setLineHeightFactor: editing.setLineHeightFactor,
  };
}

function createBatchFacade(editing) {
  return {
    beginBatch: editing.beginBatch,
    endBatch: editing.endBatch,
    beginTypingFrameBatch: editing.beginTypingFrameBatch,
  };
}

export function registerEditingDomain(options) {
  const editing = registerEditingControllers(options);

  return {
    rendering: createRenderingFacade(editing),
    layout: createLayoutFacade(editing),
    theme: createThemeFacade(editing),
    ui: createUiFacade(editing),
    document: createDocumentFacade(editing),
    persistence: createPersistenceFacade(editing),
    metrics: createMetricsFacade(editing),
    batch: createBatchFacade(editing),
    lifecycleController: editing.lifecycleController,
    requestVirtualization: editing.requestVirtualization,
    touchPage: editing.touchPage,
  };
}
