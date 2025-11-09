const FONT_SOURCE_BY_FACE = {
  TT2020Base: new URL('../fonts/TT2020Base-Regular.woff2', import.meta.url).href,
  TT2020StyleB: new URL('../fonts/TT2020StyleB-Regular.woff2', import.meta.url).href,
  TT2020StyleD: new URL('../fonts/TT2020StyleD-Regular.woff2', import.meta.url).href,
  TT2020StyleE: new URL('../fonts/TT2020StyleE-Regular.woff2', import.meta.url).href,
  TT2020StyleF: new URL('../fonts/TT2020StyleF-Regular.woff2', import.meta.url).href,
  TT2020StyleG: new URL('../fonts/TT2020StyleG-Regular.woff2', import.meta.url).href,
};

const fontLoadPromises = new Map();

function getFontFaceSet() {
  if (typeof document !== 'undefined' && document.fonts) {
    return document.fonts;
  }
  if (typeof globalThis !== 'undefined' && globalThis.fonts) {
    return globalThis.fonts;
  }
  return null;
}

export function canLoadFontFace() {
  const fontSet = getFontFaceSet();
  return typeof FontFace === 'function' && !!fontSet && typeof fontSet.add === 'function';
}

export function ensureFontFace(face) {
  const name = typeof face === 'string' ? face.trim() : '';
  if (!name) return Promise.resolve(false);

  if (fontLoadPromises.has(name)) {
    return fontLoadPromises.get(name);
  }

  const fontSet = getFontFaceSet();
  if (!fontSet || typeof FontFace !== 'function' || typeof fontSet.add !== 'function') {
    const err = new Error('FontFace API unavailable in this context');
    return Promise.reject(err);
  }

  const source = FONT_SOURCE_BY_FACE[name];
  if (!source) {
    const fallback = fontSet.load(`400 1em "${name}"`).catch(() => undefined);
    fontLoadPromises.set(name, fallback);
    return fallback;
  }

  const loadPromise = (async () => {
    const font = new FontFace(name, `url(${source}) format("woff2")`, { weight: '400', style: 'normal' });
    const loaded = await font.load();
    fontSet.add(loaded);
    await fontSet.load(`400 1em "${name}"`);
    return true;
  })();

  fontLoadPromises.set(name, loadPromise.catch(err => {
    fontLoadPromises.delete(name);
    throw err;
  }));

  return loadPromise;
}

export function preloadFontFaces(faces) {
  if (!Array.isArray(faces)) return Promise.resolve();
  return Promise.allSettled(faces.map(name => ensureFontFace(name))).then(() => undefined);
}

