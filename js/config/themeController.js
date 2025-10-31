import { updateThemeGateIndicator } from './inkSettingsPanel.js';

const DARK_PAGE_HEX = '#1f2024';
const LIGHT_EFFECT_INKS = ['b', 'r'];
const DARK_EFFECT_INKS = ['w', 'r'];
const LIGHT_EFFECT_INKS_SORTED = [...LIGHT_EFFECT_INKS].sort();
const DARK_EFFECT_INKS_SORTED = [...DARK_EFFECT_INKS].sort();

export function createThemeController({
  app,
  state,
  colors,
  edgeBleed,
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

  function systemPrefersDark() {
    return !!(prefersDarkMedia && prefersDarkMedia.matches);
  }

  function computeEffectiveTheme() {
    if (state.themeMode === 'dark') return 'dark';
    if (state.themeMode === 'light') return 'light';
    return systemPrefersDark() ? 'dark' : 'light';
  }

  function arraysEqualShallow(a = [], b = []) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
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

  function readPageFillColor() {
    let fill = '#ffffff';
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
    if (nextFill && nextFill !== state.pageFillColor) {
      state.pageFillColor = nextFill;
      for (const page of state.pages) {
        if (!page) continue;
        page.dirtyAll = true;
        touchPage(page);
        schedulePaint(page);
      }
    }
  }

  function syncBleedInksForPageTone(darkPageActive) {
    if (!edgeBleed || !Array.isArray(edgeBleed.inks)) return false;
    const currentSorted = [...edgeBleed.inks].sort();
    const matchesLight = arraysEqualShallow(currentSorted, LIGHT_EFFECT_INKS_SORTED);
    const matchesDark = arraysEqualShallow(currentSorted, DARK_EFFECT_INKS_SORTED);
    if (!matchesLight && !matchesDark) return false;
    const target = darkPageActive ? DARK_EFFECT_INKS : LIGHT_EFFECT_INKS;
    const targetSorted = darkPageActive ? DARK_EFFECT_INKS_SORTED : LIGHT_EFFECT_INKS_SORTED;
    if (arraysEqualShallow(currentSorted, targetSorted)) return false;
    edgeBleed.inks = [...target];
    return true;
  }

  function applyInkPaletteForTheme(darkPageActive) {
    if (!colors) return false;
    const nextRed = darkPageActive ? '#ff7a7a' : '#b00000';
    let changed = false;
    if (colors.b !== DARK_PAGE_HEX) {
      colors.b = DARK_PAGE_HEX;
      changed = true;
    }
    if (colors.w !== '#ffffff') {
      colors.w = '#ffffff';
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
      touchPage(page);
      schedulePaint(page);
    }
    endBatch();
  }

  function applyAppearance() {
    updateRootThemeAttribute();
    if (app.darkPageToggle) app.darkPageToggle.disabled = state.themeMode === 'light';
    const effectiveTheme = computeEffectiveTheme();
    const darkPageActive = effectiveTheme === 'dark' && !!state.darkPageInDarkMode;
    setBodyPageTone(darkPageActive);
    refreshPageFillColor();
    const preferWhite = !!darkPageActive;
    const preferChanged = state.inkEffectsPreferWhite !== preferWhite;
    state.inkEffectsPreferWhite = preferWhite;
    const bleedAdjusted = syncBleedInksForPageTone(darkPageActive);
    updateThemeGateIndicator(preferWhite, edgeBleed && edgeBleed.inks);
    const shouldSwapInks = lastDarkPageActive !== null && lastDarkPageActive !== darkPageActive;
    if (shouldSwapInks) swapDocumentInkColors();
    applyInkPaletteForTheme(darkPageActive);
    if (preferChanged || bleedAdjusted) {
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
    syncBleedInksForPageTone,
    applyAppearance,
    setThemeModePreference,
    setDarkPagePreference,
  };
}

export { DARK_PAGE_HEX };
