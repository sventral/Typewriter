import {
  getInkEffectFactor,
  getInkSectionStrength,
  getInkSectionOrder,
  getExperimentalEffectsConfig,
  getExperimentalQualitySettings,
  isInkSectionEnabled,
} from '../../config/inkSettingsPanel.js';
import { createGlyphAtlas } from '../../rendering/glyphAtlas.js';
import { createPageRenderer } from '../../rendering/pageRendering.js';

export function registerRenderingControllers(options) {
  const {
    context,
    app,
    state,
    metricsStore,
    gridDiv,
    colors,
    editing,
    safariEnv,
  } = options;

  const { rebuildAllAtlases, drawGlyph } = createGlyphAtlas({
    context,
    app,
    state,
    colors,
    getFontSize: () => metricsStore.FONT_SIZE,
    getActiveFontName: () => metricsStore.ACTIVE_FONT_NAME,
    getAsc: () => metricsStore.ASC,
    getDesc: () => metricsStore.DESC,
    getCharWidth: () => metricsStore.CHAR_W,
    getRenderScale: () => metricsStore.RENDER_SCALE,
    getStateZoom: () => state.zoom,
    isSafari: safariEnv.isSafari,
    safariSupersampleThreshold: safariEnv.supersampleThreshold,
    getInkEffectFactor,
    getInkSectionStrength,
    getInkSectionOrder,
    getExperimentalEffectsConfig,
    getExperimentalQualitySettings,
    isInkSectionEnabled,
  });

  context.registerRendererApi({
    rebuildAllAtlases,
  });

  const {
    refreshGlyphEffects,
    markRowAsDirty,
    schedulePaint,
  } = createPageRenderer({
    context,
    app,
    state,
    getAsc: () => metricsStore.ASC,
    getDesc: () => metricsStore.DESC,
    getCharWidth: () => metricsStore.CHAR_W,
    getGridHeight: () => metricsStore.GRID_H,
    gridDiv,
    getRenderScale: () => metricsStore.RENDER_SCALE,
    rebuildAllAtlases,
    drawGlyph,
    lifecycle: context.controllers.lifecycle,
    getCurrentBounds: editing.editingController.getCurrentBounds,
    getBatchDepth: editing.getBatchDepth,
    getInkSectionOrder,
  });

  context.registerRendererApi({ schedulePaint });
  context.controllers.lifecycle.registerRendererHooks({ schedulePaint });
  Object.assign(editing.rendererHooks, { markRowAsDirty, schedulePaint });

  return {
    refreshGlyphEffects,
    schedulePaint,
    rebuildAllAtlases,
  };
}
