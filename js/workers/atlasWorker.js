import { buildExperimentalAtlas } from '../rendering/experimental/experimentalAtlasBuilder.js';
import { canLoadFontFace, ensureFontFace } from '../rendering/fontLoader.js';

self.onmessage = async event => {
  const data = event?.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'buildAtlas') {
    const { key, params, generation } = data;
    try {
      const fontName = params?.fontMetrics?.fontName;
      if (fontName) {
        if (!canLoadFontFace()) {
          throw new Error('FontFace API unavailable for worker atlas rendering');
        }
        await ensureFontFace(fontName);
      }
      const result = buildExperimentalAtlas(params);
      const offscreen = new OffscreenCanvas(result.width, result.height);
      const ctx = offscreen.getContext('2d');
      ctx.putImageData(result.imageData, 0, 0);
      const bitmap = offscreen.transferToImageBitmap();
      self.postMessage({
        type: 'atlasReady',
        key,
        generation,
        bitmap,
        rectDpByCode: result.rectDpByCode,
        cellW_css: result.cellW_css,
        cellH_css: result.cellH_css,
        cellW_draw_dp: result.cellW_draw_dp,
        cellH_draw_dp: result.cellH_draw_dp,
        originY_css: result.originY_css,
        sampleScale: result.sampleScale,
      }, [bitmap]);
    } catch (err) {
      self.postMessage({
        type: 'atlasError',
        key,
        generation,
        error: err?.message || String(err),
      });
    }
  } else if (data.type === 'reset') {
    // Nothing to clear currently, but acknowledge the generation for symmetry.
    self.postMessage({ type: 'resetAck', generation: data.generation });
  }
};
