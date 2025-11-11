import { refreshSavedInkStylesUI, syncInkStrengthDisplays, hydrateInkSettingsFromState } from '../../config/inkSettingsPanel.js';
import {
  GLYPH_JITTER_DEFAULTS,
  normalizeGlyphJitterAmount,
  normalizeGlyphJitterFrequency,
} from '../../config/glyphJitterConfig.js';

function formatNumberForInput(value, fractionDigits = 2) {
  if (!Number.isFinite(value)) return '';
  if (fractionDigits <= 0) {
    return String(Math.round(value));
  }
  const factor = 10 ** fractionDigits;
  const rounded = Math.round(value * factor) / factor;
  let str = rounded.toFixed(fractionDigits);
  str = str.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
  return str;
}

function setGlyphJitterInputsDisabled(app, disabled) {
  [
    app.glyphJitterAmountMin,
    app.glyphJitterAmountMax,
    app.glyphJitterFrequencyMin,
    app.glyphJitterFrequencyMax,
  ].forEach((el) => {
    if (el) el.disabled = disabled;
  });
  if (app.shuffleGlyphJitterSeedBtn) {
    app.shuffleGlyphJitterSeedBtn.disabled = disabled;
  }
}

export function createInkControls({
  app,
  state,
  setInk,
  schedulePaint,
  queueDirtySave,
  toggleInkSettingsPanel,
  loadFontAndApply,
  focusStage,
  theme,
}) {
  function bindOpacitySliders() {
    const onOpacitySliderInput = (key, sliderEl, valueEl) => {
      const v = parseInt(sliderEl.value, 10);
      valueEl.textContent = `${v}%`;
      state.inkOpacity[key] = v;
      queueDirtySave();
      for (const p of state.pages) {
        if (p.active) {
          p.dirtyAll = true;
          schedulePaint(p);
        }
      }
    };

    if (app.inkOpacityBSlider && app.inkOpacityBValue) {
      app.inkOpacityBSlider.addEventListener('input', () => onOpacitySliderInput('b', app.inkOpacityBSlider, app.inkOpacityBValue));
    }
    if (app.inkOpacityRSlider && app.inkOpacityRValue) {
      app.inkOpacityRSlider.addEventListener('input', () => onOpacitySliderInput('r', app.inkOpacityRSlider, app.inkOpacityRValue));
    }
    if (app.inkOpacityWSlider && app.inkOpacityWValue) {
      app.inkOpacityWSlider.addEventListener('input', () => onOpacitySliderInput('w', app.inkOpacityWSlider, app.inkOpacityWValue));
    }
  }

  function bindInkButtons() {
    const LONG_PRESS_DURATION = 500;

    const setupInkButton = (btn, ink, popup) => {
      if (!btn || !popup) return;
      let pressTimer = null;
      let isLongPress = false;
      const allPopups = [app.inkBlackSliderPopup, app.inkRedSliderPopup, app.inkWhiteSliderPopup];
      const startPress = () => {
        isLongPress = false;
        if (pressTimer) {
          clearTimeout(pressTimer);
        }
        pressTimer = setTimeout(() => {
          isLongPress = true;
          allPopups.forEach((p) => { if (p && p !== popup) p.classList.remove('active'); });
          popup.classList.add('active');
        }, LONG_PRESS_DURATION);
      };
      const endPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        if (!isLongPress) {
          setInk(ink);
          allPopups.forEach((p) => p?.classList.remove('active'));
        }
      };
      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };
      btn.addEventListener('pointerdown', startPress);
      btn.addEventListener('pointerup', endPress);
      btn.addEventListener('pointerleave', cancelPress);
      btn.addEventListener('pointercancel', cancelPress);
      popup.addEventListener('pointerdown', (e) => e.stopPropagation());
    };

    setupInkButton(app.inkBlackBtn, 'b', app.inkBlackSliderPopup);
    setupInkButton(app.inkRedBtn, 'r', app.inkRedSliderPopup);
    setupInkButton(app.inkWhiteBtn, 'w', app.inkWhiteSliderPopup);

    document.body.addEventListener('pointerdown', () => {
      [app.inkBlackSliderPopup, app.inkRedSliderPopup, app.inkWhiteSliderPopup].forEach((p) => p?.classList.remove('active'));
    });
  }

  function bindDialogToggles() {
    if (app.inkSettingsBtn) app.inkSettingsBtn.onclick = toggleInkSettingsPanel;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (app.inkSettingsPanel) app.inkSettingsPanel.classList.remove('is-open');
      }
    });

    if (typeof app.fontRadios === 'function') {
      app.fontRadios().forEach((radio) => {
        radio.addEventListener('change', async () => {
          if (radio.checked) {
            await loadFontAndApply(radio.value);
            focusStage();
          }
        });
      });
    }
  }

  function bindGlyphJitterControls() {
    const markGlyphJitterDirty = () => {
      for (const p of state.pages) {
        if (!p) continue;
        p.dirtyAll = true;
        if (p.active) schedulePaint(p);
      }
    };

    const sanitizeAmountInputs = () => {
      if (!app.glyphJitterAmountMin || !app.glyphJitterAmountMax) return null;
      const raw = {
        min: Number.parseFloat(app.glyphJitterAmountMin.value),
        max: Number.parseFloat(app.glyphJitterAmountMax.value),
      };
      const fallback = state.glyphJitterAmountPct || GLYPH_JITTER_DEFAULTS.amountPct;
      const sanitized = normalizeGlyphJitterAmount(raw, fallback);
      state.glyphJitterAmountPct = sanitized;
      app.glyphJitterAmountMin.value = formatNumberForInput(sanitized.min, 2);
      app.glyphJitterAmountMax.value = formatNumberForInput(sanitized.max, 2);
      return sanitized;
    };

    const sanitizeFrequencyInputs = () => {
      if (!app.glyphJitterFrequencyMin || !app.glyphJitterFrequencyMax) return null;
      const raw = {
        min: Number.parseFloat(app.glyphJitterFrequencyMin.value),
        max: Number.parseFloat(app.glyphJitterFrequencyMax.value),
      };
      const fallback = state.glyphJitterFrequencyPct || GLYPH_JITTER_DEFAULTS.frequencyPct;
      const sanitized = normalizeGlyphJitterFrequency(raw, fallback);
      state.glyphJitterFrequencyPct = sanitized;
      app.glyphJitterFrequencyMin.value = formatNumberForInput(sanitized.min, 1);
      app.glyphJitterFrequencyMax.value = formatNumberForInput(sanitized.max, 1);
      return sanitized;
    };

    if (app.glyphJitterToggle) {
      app.glyphJitterToggle.checked = !!state.glyphJitterEnabled;
      app.glyphJitterToggle.addEventListener('change', () => {
        state.glyphJitterEnabled = !!app.glyphJitterToggle.checked;
        setGlyphJitterInputsDisabled(app, !state.glyphJitterEnabled);
        queueDirtySave();
        markGlyphJitterDirty();
        focusStage();
      });
    }

    [app.glyphJitterAmountMin, app.glyphJitterAmountMax].forEach((input) => {
      if (!input) return;
      input.addEventListener('change', () => {
        sanitizeAmountInputs();
        queueDirtySave();
        markGlyphJitterDirty();
        focusStage();
      });
      input.addEventListener('blur', () => { sanitizeAmountInputs(); });
    });

    [app.glyphJitterFrequencyMin, app.glyphJitterFrequencyMax].forEach((input) => {
      if (!input) return;
      input.addEventListener('change', () => {
        sanitizeFrequencyInputs();
        queueDirtySave();
        markGlyphJitterDirty();
        focusStage();
      });
      input.addEventListener('blur', () => { sanitizeFrequencyInputs(); });
    });

    if (app.shuffleGlyphJitterSeedBtn) {
      app.shuffleGlyphJitterSeedBtn.addEventListener('click', (e) => {
        e.preventDefault();
        state.glyphJitterSeed = ((Math.random() * 0xFFFFFFFF) >>> 0);
        queueDirtySave();
        markGlyphJitterDirty();
        focusStage();
      });
    }
  }

  function bindAppearanceControls() {
    const themeApi = theme || {};
    if (typeof themeApi.setThemeModePreference === 'function') {
      const radios = typeof app.appearanceRadios === 'function' ? app.appearanceRadios() : [];
      radios.forEach((radio) => {
        radio.addEventListener('change', () => {
          if (radio.checked) {
            themeApi.setThemeModePreference(radio.value);
          }
        });
      });
    }
    if (app.darkPageToggle && typeof themeApi.setDarkPagePreference === 'function') {
      app.darkPageToggle.addEventListener('change', () => {
        themeApi.setDarkPagePreference(!!app.darkPageToggle.checked);
      });
    }
  }

  function bindInkControls() {
    bindOpacitySliders();
    bindInkButtons();
    bindDialogToggles();
    bindGlyphJitterControls();
    bindAppearanceControls();
  }

  function applyInkDefaults(loaded) {
    if (loaded) return;
    state.inkOpacity = { b: 100, r: 100, w: 100 };
    state.glyphJitterEnabled = GLYPH_JITTER_DEFAULTS.enabled;
    state.glyphJitterAmountPct = normalizeGlyphJitterAmount(GLYPH_JITTER_DEFAULTS.amountPct, GLYPH_JITTER_DEFAULTS.amountPct);
    state.glyphJitterFrequencyPct = normalizeGlyphJitterFrequency(GLYPH_JITTER_DEFAULTS.frequencyPct, GLYPH_JITTER_DEFAULTS.frequencyPct);
    state.glyphJitterSeed = ((Math.random() * 0xFFFFFFFF) >>> 0);
  }

  function populateInkUI({ loaded } = {}) {
    applyInkDefaults(loaded);
    if (app.inkOpacityBSlider) app.inkOpacityBSlider.value = String(state.inkOpacity.b);
    if (app.inkOpacityRSlider) app.inkOpacityRSlider.value = String(state.inkOpacity.r);
    if (app.inkOpacityWSlider) app.inkOpacityWSlider.value = String(state.inkOpacity.w);
    if (app.inkOpacityBValue) app.inkOpacityBValue.textContent = `${state.inkOpacity.b}%`;
    if (app.inkOpacityRValue) app.inkOpacityRValue.textContent = `${state.inkOpacity.r}%`;
    if (app.inkOpacityWValue) app.inkOpacityWValue.textContent = `${state.inkOpacity.w}%`;

    const jitterAmount = normalizeGlyphJitterAmount(state.glyphJitterAmountPct, GLYPH_JITTER_DEFAULTS.amountPct);
    const jitterFrequency = normalizeGlyphJitterFrequency(state.glyphJitterFrequencyPct, GLYPH_JITTER_DEFAULTS.frequencyPct);
    state.glyphJitterAmountPct = jitterAmount;
    state.glyphJitterFrequencyPct = jitterFrequency;
    if (app.glyphJitterToggle) app.glyphJitterToggle.checked = !!state.glyphJitterEnabled;
    if (app.glyphJitterAmountMin) app.glyphJitterAmountMin.value = formatNumberForInput(jitterAmount.min, 2);
    if (app.glyphJitterAmountMax) app.glyphJitterAmountMax.value = formatNumberForInput(jitterAmount.max, 2);
    if (app.glyphJitterFrequencyMin) app.glyphJitterFrequencyMin.value = formatNumberForInput(jitterFrequency.min, 1);
    if (app.glyphJitterFrequencyMax) app.glyphJitterFrequencyMax.value = formatNumberForInput(jitterFrequency.max, 1);
    setGlyphJitterInputsDisabled(app, !state.glyphJitterEnabled);

    if (app.appearanceAuto) app.appearanceAuto.checked = !['light', 'dark'].includes(state.themeMode);
    if (app.appearanceLight) app.appearanceLight.checked = state.themeMode === 'light';
    if (app.appearanceDark) app.appearanceDark.checked = state.themeMode === 'dark';
    if (app.darkPageToggle) {
      app.darkPageToggle.checked = !!state.darkPageInDarkMode;
      app.darkPageToggle.disabled = state.themeMode === 'light';
    }

    refreshSavedInkStylesUI();
    hydrateInkSettingsFromState({ updateStyleName: true });
    syncInkStrengthDisplays();
  }

  return {
    bindInkControls,
    populateInkUI,
  };
}
