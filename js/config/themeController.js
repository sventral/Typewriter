import { markDocumentDirty, markPageContentDirty } from '../state/saveRevision.js';

const DARK_PAGE_HEX = '#1f2024';
const LIGHT_PAGE_HEX = '#f7f5ee';
const PAGE_CROSSFADE_MS = 2000;

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

  function applyPageFillColor(color, { preserveFrontBuffer = false } = {}) {
    if (typeof color !== 'string' || !color.trim()) return;
    if (state.pageFillColor === color) return;
    state.pageFillColor = color;
    for (const page of state.pages) {
      if (!page) continue;
      if (preserveFrontBuffer) {
        page.preserveFrontBufferForFullPaint = true;
      }
      page.dirtyAll = true;
      touchPage(page);
      schedulePaint(page);
    }
  }

  function pageNeedsPaint(page) {
    if (!page) return false;
    const hasDirtyRows = page._dirtyRowMinMu !== undefined || page._dirtyRowMaxMu !== undefined;
    return page.fullPaintInProgress === true || page.dirtyAll === true || hasDirtyRows || !!page.raf;
  }

  function shouldUseDistractionFreeThemeTransition() {
    const body = document.body;
    if (!body) return false;
    return body.classList.contains('distraction-free-mode-enabled')
      || body.classList.contains('distraction-free-mode-transitioning')
      || body.classList.contains('distraction-free-mode-restoring');
  }

  function capturePageCrossfadeOverlays() {
    const overlays = [];
    if (typeof document === 'undefined') return overlays;
    const pages = Array.isArray(state?.pages) ? state.pages : [];
    for (const page of pages) {
      if (!page?.active || !page?.canvas || !page?.pageEl) continue;
      const host = page.pageEl;
      if (!host?.isConnected) continue;
      const existing = host.querySelector('.theme-transition-overlay');
      if (existing) {
        existing.remove();
      }
      const overlay = document.createElement('canvas');
      overlay.className = 'theme-transition-overlay';
      overlay.width = page.canvas.width;
      overlay.height = page.canvas.height;
      const overlayCtx = overlay.getContext('2d');
      if (!overlayCtx) continue;
      overlayCtx.drawImage(page.canvas, 0, 0);
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.pointerEvents = 'none';
      overlay.style.opacity = '1';
      overlay.style.zIndex = '3';
      overlay.style.transition = `opacity ${PAGE_CROSSFADE_MS}ms ease-in-out`;
      host.appendChild(overlay);
      overlays.push({ page, overlay });
    }
    return overlays;
  }

  function fadeOutCrossfadeOverlaysWhenReady(overlays) {
    if (!Array.isArray(overlays) || !overlays.length) return;
    const maxWaitMs = 8000;
    const pollStartedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    const poll = () => {
      const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
      const timedOut = (now - pollStartedAt) >= maxWaitMs;
      let waiting = false;
      for (const entry of overlays) {
        if (!entry?.overlay?.isConnected) continue;
        if (entry.startedFade) continue;
        const pageSettled = timedOut || !pageNeedsPaint(entry.page);
        if (!pageSettled) {
          waiting = true;
          continue;
        }
        entry.startedFade = true;
        requestAnimationFrame(() => {
          if (!entry.overlay.isConnected) return;
          entry.overlay.style.opacity = '0';
          setTimeout(() => {
            entry.overlay.remove();
          }, PAGE_CROSSFADE_MS + 120);
        });
      }
      if (waiting) {
        requestAnimationFrame(poll);
      }
    };
    requestAnimationFrame(poll);
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

  function refreshPageFillColor({ preserveFrontBuffer = false } = {}) {
    const nextFill = readPageFillColor();
    if (!nextFill || nextFill === state.pageFillColor) {
      return;
    }
    applyPageFillColor(nextFill, { preserveFrontBuffer });
  }

  function applyInkPaletteForTheme(darkPageActive, { preserveFrontBuffer = false } = {}) {
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
        if (preserveFrontBuffer) {
          page.preserveFrontBufferForFullPaint = true;
        }
        page.dirtyAll = true;
        touchPage(page);
        schedulePaint(page);
      }
    }
    return changed;
  }

  function swapDocumentInkColors({ preserveFrontBuffer = false } = {}) {
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
      if (preserveFrontBuffer) {
        page.preserveFrontBufferForFullPaint = true;
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
    const nextFill = readPageFillColor();
    const pageFillWillChange = !!(nextFill && nextFill !== state.pageFillColor);
    const preferWhite = !!darkPageActive;
    const preferChanged = state.inkEffectsPreferWhite !== preferWhite;
    state.inkEffectsPreferWhite = preferWhite;
    const shouldSwapInks = lastDarkPageActive !== null && lastDarkPageActive !== darkPageActive;
    const useCrossfadeTransition = shouldUseDistractionFreeThemeTransition()
      && (pageFillWillChange || shouldSwapInks);
    const transitionOverlays = useCrossfadeTransition ? capturePageCrossfadeOverlays() : [];
    if (pageFillWillChange) {
      refreshPageFillColor({ preserveFrontBuffer: useCrossfadeTransition });
    }
    if (shouldSwapInks) {
      swapDocumentInkColors({ preserveFrontBuffer: useCrossfadeTransition });
    }
    applyInkPaletteForTheme(darkPageActive, { preserveFrontBuffer: useCrossfadeTransition });
    if (preferChanged) {
      refreshGlyphEffects({ preserveFrontBuffer: useCrossfadeTransition });
    }
    let inkChanged = false;
    if (darkPageActive && lastDarkPageActive !== true && state.ink !== 'w') {
      if (typeof setInk === 'function') setInk('w');
      inkChanged = true;
    } else if (!darkPageActive && lastDarkPageActive === true && state.ink === 'w') {
      if (typeof setInk === 'function') setInk('b');
      inkChanged = true;
    }
    if (useCrossfadeTransition) {
      fadeOutCrossfadeOverlaysWhenReady(transitionOverlays);
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
