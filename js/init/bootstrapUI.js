import { markDocumentDirty } from '../state/saveRevision.js';
import { setupInkSettingsPanel } from '../config/ink/inkSettingsView.js';
import { syncRulerToggleButton } from './ui/rulerToggle.js';
import { setupFaviconThemeSync } from './ui/faviconTheme.js';
import { setupLandingBackground } from './ui/landingBackground.js';
import { setupGuideOverlay } from './ui/guideOverlay.js';
import { setupLandingPage } from './ui/landingPage.js';

export async function bootstrapUI({
  state,
  app,
  metricsStore,
  refreshGlyphEffects,
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
  setupFaviconThemeSync();

  const persistInkSettings = () => {
    markDocumentDirty(state);
    saveStateDebounced();
  };

  // Expose font helpers to the ink settings panel
  if (!app.getActiveFontName) {
    app.getActiveFontName = () => metricsStore.ACTIVE_FONT_NAME;
  }
  if (!app.setActiveFontName && typeof loadFontAndApply === 'function') {
    app.setActiveFontName = (name) => loadFontAndApply(name);
  }

  setupInkSettingsPanel({
    state,
    app,
    metricsStore,
    refreshGlyphs: refreshGlyphEffects,
    saveState: persistInkSettings,
  });

  bootstrapFirstPage();
  const persistedState = await loadPersistedState();
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
  syncRulerToggleButton(app.toggleMarginsBtn, state.showRulers);
  if (state.showRulers) positionRulers();
  if (!inkAdjustedByTheme) setInk(state.ink || 'b');
  requestVirtualization();
  setupLandingBackground();
  setupGuideOverlay();
  setupLandingPage({ app });
}
