import { markDocumentDirty, markPageContentDirty } from '../state/saveRevision.js';

const DARK_PAGE_HEX = '#1f2024';
const LIGHT_PAGE_HEX = '#f7f5ee';
const PAGE_FILL_TRANSITION_MS = 2000;

export function createThemeController({
  app,
  state,
  colors,
  prefersDarkMedia = null,
  rebuildAllAtlases = () => {},
  touchPage = () => {},
  schedulePaint = () => {},
  refreshGlyphEffects = () => {},
  beginBatch = () => {},
  endBatch = () => {},
  setInk = null,
  focusStage = () => {},
  saveStateDebounced = () => {},
}) {
  let lastDarkPageActive = null;
  let pageFillTransitionRaf = 0;
  let pageFillTransitionTarget = '';

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  function easeInOut(value) {
    const t = clamp01(value);
    if (t < 0.5) return 2 * t * t;
    return 1 - (Math.pow(-2 * t + 2, 2) / 2);
  }

  function parseCssColor(value) {
    if (typeof value !== 'string') return null;
    const input = value.trim();
    if (!input) return null;
    const shortHex = /^#([0-9a-fA-F]{3})$/;
    const fullHex = /^#([0-9a-fA-F]{6})$/;
    const shortMatch = input.match(shortHex);
    if (shortMatch) {
      const hex = shortMatch[1];
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b };
    }
    const fullMatch = input.match(fullHex);
    if (fullMatch) {
      const hex = fullMatch[1];
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b };
    }
    if (input.startsWith('rgb')) {
      const parts = input.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return null;
      const r = Math.max(0, Math.min(255, Math.round(Number(parts[0]) || 0)));
      const g = Math.max(0, Math.min(255, Math.round(Number(parts[1]) || 0)));
      const b = Math.max(0, Math.min(255, Math.round(Number(parts[2]) || 0)));
      return { r, g, b };
    }
    return null;
  }

  function rgbToCssString({ r, g, b }) {
    const cr = Math.max(0, Math.min(255, Math.round(r)));
    const cg = Math.max(0, Math.min(255, Math.round(g)));
    const cb = Math.max(0, Math.min(255, Math.round(b)));
    return `rgb(${cr}, ${cg}, ${cb})`;
  }

  function applyPageFillColor(color) {
    if (typeof color !== 'string' || !color.trim()) return;
    if (state.pageFillColor === color) return;
    state.pageFillColor = color;
    for (const page of state.pages) {
      if (!page) continue;
      page.dirtyAll = true;
      touchPage(page);
      schedulePaint(page);
    }
  }

  function stopPageFillTransition() {
    if (pageFillTransitionRaf) {
      cancelAnimationFrame(pageFillTransitionRaf);
      pageFillTransitionRaf = 0;
    }
    pageFillTransitionTarget = '';
  }

  function shouldAnimatePageFill() {
    const body = document.body;
    if (!body) return false;
    return body.classList.contains('distraction-free-mode-enabled')
      || body.classList.contains('distraction-free-mode-transitioning')
      || body.classList.contains('distraction-free-mode-restoring');
  }

  function animatePageFillColor(nextFill) {
    const from = parseCssColor(state.pageFillColor || LIGHT_PAGE_HEX);
    const to = parseCssColor(nextFill);
    if (!from || !to) {
      stopPageFillTransition();
      applyPageFillColor(nextFill);
      return;
    }
    if (pageFillTransitionRaf && pageFillTransitionTarget === nextFill) {
      return;
    }
    stopPageFillTransition();
    pageFillTransitionTarget = nextFill;
    const start = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    const tick = () => {
      const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
      const elapsed = now - start;
      const eased = easeInOut(elapsed / PAGE_FILL_TRANSITION_MS);
      const current = {
        r: from.r + ((to.r - from.r) * eased),
        g: from.g + ((to.g - from.g) * eased),
        b: from.b + ((to.b - from.b) * eased),
      };
      applyPageFillColor(rgbToCssString(current));
      if (elapsed >= PAGE_FILL_TRANSITION_MS) {
        stopPageFillTransition();
        applyPageFillColor(nextFill);
        return;
      }
      pageFillTransitionRaf = requestAnimationFrame(tick);
    };
    pageFillTransitionRaf = requestAnimationFrame(tick);
  }

  function systemPrefersDark() {
    return !!(prefersDarkMedia && prefersDarkMedia.matches);
  }

  function computeEffectiveTheme() {
    if (state.themeMode === 'dark') return 'dark';
    if (state.themeMode === 'light') return 'light';
    return systemPrefersDark() ? 'dark' : 'light';
  }

  function updateRootThemeAttribute() {
    const root = document.documentElement;
    if (!root) return;
    if (!state.themeMode || state.themeMode === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', state.themeMode);
    }
  }

  function setBodyPageTone(darkPageActive) {
    const body = document.body;
    if (!body) return;
    if (darkPageActive) {
      body.dataset.pageTone = 'dark';
    } else if (body.dataset.pageTone) {
      delete body.dataset.pageTone;
    }
  }

  function resolveDarkPageActive(effectiveTheme) {
    const distractionFreeEnabled = state.distractionFreeModeEnabled === true;
    const distractionFreeActive = distractionFreeEnabled
      && !!(document?.body?.classList.contains('distraction-free-mode-hidden'));
    if (state.distractionFreeAlwaysDarkPageEnabled === true && distractionFreeActive) {
      return true;
    }
    if (distractionFreeEnabled && state.distractionFreeAutoDarkPageEnabled === true) {
      return effectiveTheme === 'dark';
    }
    return effectiveTheme === 'dark' && !!state.darkPageInDarkMode;
  }

  function readPageFillColor() {
    let fill = LIGHT_PAGE_HEX;
    try {
      let target = app.firstPage;
      if (!target || !target.isConnected) {
        target = document.querySelector('.page');
      }
      if (!target || !target.isConnected) {
        target = document.body;
      }
      if (!target) {
        target = document.documentElement;
      }
      const styles = target ? getComputedStyle(target) : null;
      const candidate = styles?.getPropertyValue('--page-bg');
      if (candidate && candidate.trim()) {
        fill = candidate.trim();
      }
    } catch {}
    return fill;
  }

  function refreshPageFillColor() {
    const nextFill = readPageFillColor();
    if (!nextFill || nextFill === state.pageFillColor) {
      return;
    }
    if (shouldAnimatePageFill()) {
      animatePageFillColor(nextFill);
      return;
    }
    stopPageFillTransition();
    applyPageFillColor(nextFill);
  }

  function applyInkPaletteForTheme(darkPageActive) {
    if (!colors) return false;
    const nextRed = darkPageActive ? '#ff7a7a' : '#b00000';
    let changed = false;
    if (colors.b !== DARK_PAGE_HEX) {
      colors.b = DARK_PAGE_HEX;
      changed = true;
    }
    if (colors.w !== LIGHT_PAGE_HEX) {
      colors.w = LIGHT_PAGE_HEX;
      changed = true;
    }
    if (colors.r !== nextRed) {
      colors.r = nextRed;
      changed = true;
    }
    if (changed) {
      rebuildAllAtlases();
      for (const page of state.pages) {
        if (!page) continue;
        page.dirtyAll = true;
        touchPage(page);
        schedulePaint(page);
      }
    }
    return changed;
  }

  function swapDocumentInkColors() {
    beginBatch();
    for (const page of state.pages) {
      if (!page) continue;
      for (const rowMap of page.grid?.values() || []) {
        if (!rowMap) continue;
        for (const stack of rowMap.values()) {
          if (!Array.isArray(stack)) continue;
          for (const glyph of stack) {
            if (!glyph) continue;
            const currentInk = glyph.ink || 'b';
            if (currentInk === 'b') {
              glyph.ink = 'w';
            } else if (currentInk === 'w') {
              glyph.ink = 'b';
            }
          }
        }
      }
      page.dirtyAll = true;
      markPageContentDirty(page);
      touchPage(page);
      schedulePaint(page);
    }
    endBatch();
  }

  function applyAppearance() {
    updateRootThemeAttribute();
    if (app.darkPageToggle) app.darkPageToggle.disabled = state.themeMode === 'light';
    const effectiveTheme = computeEffectiveTheme();
    const darkPageActive = resolveDarkPageActive(effectiveTheme);
    setBodyPageTone(darkPageActive);
    refreshPageFillColor();
    const preferWhite = !!darkPageActive;
    const preferChanged = state.inkEffectsPreferWhite !== preferWhite;
    state.inkEffectsPreferWhite = preferWhite;
    const shouldSwapInks = lastDarkPageActive !== null && lastDarkPageActive !== darkPageActive;
    if (shouldSwapInks) swapDocumentInkColors();
    applyInkPaletteForTheme(darkPageActive);
    if (preferChanged) {
      refreshGlyphEffects();
    }
    let inkChanged = false;
    if (darkPageActive && lastDarkPageActive !== true && state.ink !== 'w') {
      if (typeof setInk === 'function') setInk('w');
      inkChanged = true;
    } else if (!darkPageActive && lastDarkPageActive === true && state.ink === 'w') {
      if (typeof setInk === 'function') setInk('b');
      inkChanged = true;
    }
    lastDarkPageActive = darkPageActive;
    return inkChanged;
  }

  function setThemeModePreference(mode) {
    const normalized = mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : 'auto';
    if (state.themeMode !== normalized) {
      state.themeMode = normalized;
    }
    if (app.appearanceAuto) app.appearanceAuto.checked = normalized === 'auto';
    if (app.appearanceLight) app.appearanceLight.checked = normalized === 'light';
    if (app.appearanceDark) app.appearanceDark.checked = normalized === 'dark';
    if (app.darkPageToggle) app.darkPageToggle.disabled = normalized === 'light';
    applyAppearance();
    markDocumentDirty(state);
    saveStateDebounced();
    focusStage();
  }

  function setDarkPagePreference(enabled) {
    const normalized = !!enabled;
    if (state.darkPageInDarkMode !== normalized) {
      state.darkPageInDarkMode = normalized;
    }
    if (app.darkPageToggle) app.darkPageToggle.checked = normalized;
    applyAppearance();
    markDocumentDirty(state);
    saveStateDebounced();
    focusStage();
  }

  const handlePrefChange = () => {
    if (state.themeMode === 'auto') {
      applyAppearance();
    }
  };

  if (prefersDarkMedia) {
    if (typeof prefersDarkMedia.addEventListener === 'function') {
      prefersDarkMedia.addEventListener('change', handlePrefChange);
    } else if (typeof prefersDarkMedia.addListener === 'function') {
      prefersDarkMedia.addListener(handlePrefChange);
    }
  }

  return {
    computeEffectiveTheme,
    applyInkPaletteForTheme,
    applyAppearance,
    setThemeModePreference,
    setDarkPagePreference,
  };
}

export { DARK_PAGE_HEX };
