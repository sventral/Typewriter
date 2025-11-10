import { markDocumentDirty } from '../state/saveRevision.js';
import { setupInkSettingsPanel } from '../config/inkSettingsPanel.js';

export async function bootstrapUI({
  state,
  app,
  metricsStore,
  refreshGlyphEffects,
  refreshGrainEffects,
  saveStateDebounced,
  bootstrapFirstPage,
  loadPersistedState,
  populateInitialUI,
  applyAppearance,
  updateStageEnvironment,
  setZoomPercent,
  updateZoomUIFromState,
  setPaperOffset,
  loadFontAndApply,
  setLineHeightFactor,
  renderMargins,
  clampCaretToBounds,
  updateCaretPosition,
  positionRulers,
  setInk,
  requestVirtualization,
}) {
  const persistInkSettings = () => {
    markDocumentDirty(state);
    saveStateDebounced();
  };

  setupInkSettingsPanel({
    state,
    app,
    refreshGlyphs: refreshGlyphEffects,
    refreshGrain: refreshGrainEffects,
    saveState: persistInkSettings,
  });

  bootstrapFirstPage();
  const persistedState = loadPersistedState();
  populateInitialUI(persistedState);
  const { savedFont } = persistedState;
  const inkAdjustedByTheme = applyAppearance();

  updateStageEnvironment();
  setZoomPercent(Math.round(state.zoom * 100) || 100);
  updateZoomUIFromState();
  setPaperOffset(0, 0);
  await loadFontAndApply(savedFont || metricsStore.ACTIVE_FONT_NAME);
  setLineHeightFactor(state.lineHeightFactor);
  renderMargins();
  clampCaretToBounds();
  updateCaretPosition();
  document.body.classList.toggle('rulers-off', !state.showRulers);
  if (state.showRulers) positionRulers();
  if (!inkAdjustedByTheme) setInk(state.ink || 'b');
  requestVirtualization();
}
