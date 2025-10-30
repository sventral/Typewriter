import { clamp } from '../utils/math.js';
import { sanitizeIntegerField } from '../utils/forms.js';

export function setupUIBindings(context, controllers) {
  const {
    app,
    state,
    storageKey,
    focusStage,
    pxX,
    pxY,
    mmX,
    mmY,
    sanitizeStageInput,
    sanitizedStageWidthFactor,
    sanitizedStageHeightFactor,
    updateStageEnvironment,
    renderMargins,
    clampCaretToBounds,
    updateCaretPosition,
    positionRulers,
    requestVirtualization,
    schedulePaint,
    setZoomPercent,
    applyDefaultMargins,
    computeColsFromCpi,
    applySubmittedChanges,
    applyLineHeight,
    readStagedLH,
    toggleRulers,
    toggleFontsPanel,
    toggleSettingsPanel,
    toggleInkSettingsPanel,
    loadFontAndApply,
    requestHammerNudge,
    isZooming,
    setDrag,
    getSaveTimer,
    setSaveTimer,
    setThemeModePreference,
    setDarkPagePreference,
  } = context;

  const {
    editing,
    layout,
    input,
  } = controllers;

  const {
    setInk,
    createNewDocument,
    serializeState,
    deserializeState,
  } = editing;

  const {
    handleWheelPan,
    handleHorizontalMarginDrag,
    handleVerticalMarginDrag,
    endMarginDrag,
    onZoomPointerDown,
    onZoomPointerMove,
    onZoomPointerUp,
    setMarginBoxesVisible,
  } = layout;

  const {
    handleKeyDown,
    handlePaste,
  } = input;

  function saveStateNow() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(serializeState()));
    } catch {}
  }

  function saveStateDebounced() {
    const timer = getSaveTimer();
    if (timer) clearTimeout(timer);
    const newTimer = setTimeout(saveStateNow, 400);
    setSaveTimer(newTimer);
  }

  function exportToTextFile() {
    const out = [];
    for (let p = 0; p < state.pages.length; p++) {
      const page = state.pages[p];
      if (!page) {
        out.push('');
        continue;
      }
      const rows = Array.from(page.grid.keys()).sort((a, b) => a - b);
      if (!rows.length) {
        out.push('');
        continue;
      }
      for (let i = 0; i < rows.length; i++) {
        const rmu = rows[i];
        const rowMap = page.grid.get(rmu);
        let minCol = Infinity;
        let maxCol = -1;
        for (const c of rowMap.keys()) {
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
        }
        if (!isFinite(minCol) || maxCol < 0) {
          out.push('');
          continue;
        }
        let line = '';
        for (let c = minCol; c <= maxCol; c++) {
          const st = rowMap?.get(c);
          line += st && st.length ? st[st.length - 1].char : ' ';
        }
        out.push(line.replace(/\s+$/, ''));
      }
      if (p < state.pages.length - 1) out.push('');
    }
    const txt = out.join('\n');
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'typewriter.txt';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  }

  function updateColsPreviewUI() {
    const cpi = parseFloat(app.cpiSelect?.value) || 10;
    const { cols2 } = computeColsFromCpi(cpi);
    if (app.colsPreviewSpan) {
      app.colsPreviewSpan.textContent = `Columns: ${cols2.toFixed(2)}`;
    }
  }

  function bindOpacitySliders() {
    const onOpacitySliderInput = (key, sliderEl, valueEl) => {
      const v = parseInt(sliderEl.value, 10);
      valueEl.textContent = `${v}%`;
      state.inkOpacity[key] = v;
      saveStateDebounced();
      for (const p of state.pages) {
        if (p.active) {
          p.dirtyAll = true;
          schedulePaint(p);
        }
      }
    };

    app.inkOpacityBSlider.addEventListener('input', () => onOpacitySliderInput('b', app.inkOpacityBSlider, app.inkOpacityBValue));
    app.inkOpacityRSlider.addEventListener('input', () => onOpacitySliderInput('r', app.inkOpacityRSlider, app.inkOpacityRValue));
    app.inkOpacityWSlider.addEventListener('input', () => onOpacitySliderInput('w', app.inkOpacityWSlider, app.inkOpacityWValue));
  }

  function bindInkButtons() {
    const LONG_PRESS_DURATION = 500;

    const setupInkButton = (btn, ink, popup) => {
      let pressTimer = null;
      let isLongPress = false;
      const startPress = () => {
        isLongPress = false;
        pressTimer = setTimeout(() => {
          isLongPress = true;
          const allPopups = [app.inkBlackSliderPopup, app.inkRedSliderPopup, app.inkWhiteSliderPopup];
          allPopups.forEach(p => { if (p !== popup) p.classList.remove('active'); });
          popup.classList.add('active');
        }, LONG_PRESS_DURATION);
      };
      const endPress = () => {
        clearTimeout(pressTimer);
        if (!isLongPress) {
          setInk(ink);
          const allPopups = [app.inkBlackSliderPopup, app.inkRedSliderPopup, app.inkWhiteSliderPopup];
          allPopups.forEach(p => p.classList.remove('active'));
        }
      };
      btn.addEventListener('pointerdown', startPress);
      btn.addEventListener('pointerup', endPress);
      btn.addEventListener('pointerleave', () => clearTimeout(pressTimer));
      popup.addEventListener('pointerdown', e => e.stopPropagation());
    };

    setupInkButton(app.inkBlackBtn, 'b', app.inkBlackSliderPopup);
    setupInkButton(app.inkRedBtn, 'r', app.inkRedSliderPopup);
    setupInkButton(app.inkWhiteBtn, 'w', app.inkWhiteSliderPopup);

    document.body.addEventListener('pointerdown', () => {
      [app.inkBlackSliderPopup, app.inkRedSliderPopup, app.inkWhiteSliderPopup].forEach(p => p.classList.remove('active'));
    });
  }

  function bindGrainInput() {
    app.grainInput.addEventListener('input', () => {
      const v = clamp(parseInt(app.grainInput.value || '0', 10), 0, 100);
      app.grainInput.value = String(v);
      state.grainPct = v;
      saveStateDebounced();
      for (const p of state.pages) {
        if (p.active) {
          p.dirtyAll = true;
          schedulePaint(p);
        }
      }
    });
  }

  function bindDialogToggles() {
    app.fontsBtn.onclick = toggleFontsPanel;
    app.settingsBtnNew.onclick = toggleSettingsPanel;
    if (app.inkSettingsBtn) app.inkSettingsBtn.onclick = toggleInkSettingsPanel;
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        app.fontsPanel.classList.remove('is-open');
        app.settingsPanel.classList.remove('is-open');
        if (app.inkSettingsPanel) app.inkSettingsPanel.classList.remove('is-open');
      }
    });

    app.fontRadios().forEach(radio => {
      radio.addEventListener('change', async () => {
        if (radio.checked) {
          await loadFontAndApply(radio.value);
          focusStage();
        }
      });
    });
  }

  function bindMarginInputs() {
    const applyMm = () => {
      state.marginL = pxX(Math.max(0, Number(app.mmLeft?.value) || 0));
      state.marginR = app.PAGE_W - pxX(Math.max(0, Number(app.mmRight?.value) || 0));
      state.marginTop = pxY(Math.max(0, Number(app.mmTop?.value) || 0));
      state.marginBottom = pxY(Math.max(0, Number(app.mmBottom?.value) || 0));
      renderMargins();
      clampCaretToBounds();
      updateCaretPosition();
      positionRulers();
      saveStateDebounced();
    };

    [app.mmLeft, app.mmRight, app.mmTop, app.mmBottom].forEach(inp => {
      if (!inp) return;
      inp.addEventListener('input', () => {
        sanitizeIntegerField(inp, { min: 0, allowEmpty: true });
        applyMm();
      });
      inp.addEventListener('change', () => {
        sanitizeIntegerField(inp, { min: 0, allowEmpty: false, fallbackValue: 0 });
        applyMm();
        focusStage();
      });
    });
  }

  function bindAppearanceControls() {
    if (typeof setThemeModePreference === 'function') {
      const radios = typeof app.appearanceRadios === 'function' ? app.appearanceRadios() : [];
      radios.forEach(radio => {
        radio.addEventListener('change', () => {
          if (radio.checked) {
            setThemeModePreference(radio.value);
          }
        });
      });
    }
    if (app.darkPageToggle && typeof setDarkPagePreference === 'function') {
      app.darkPageToggle.addEventListener('change', () => {
        setDarkPagePreference(!!app.darkPageToggle.checked);
      });
    }
  }

  function bindStageSizeInputs() {
    const updateStageBounds = (allowEmpty) => {
      const widthFactor = sanitizeStageInput(app.stageWidthPct, state.stageWidthFactor, allowEmpty, true);
      const heightFactor = sanitizeStageInput(app.stageHeightPct, state.stageHeightFactor, allowEmpty, false);
      if (widthFactor !== null) state.stageWidthFactor = widthFactor;
      if (heightFactor !== null) state.stageHeightFactor = heightFactor;
      updateStageEnvironment();
      saveStateDebounced();
      requestVirtualization();
    };

    [app.stageWidthPct, app.stageHeightPct].forEach(inp => {
      if (!inp) return;
      inp.addEventListener('input', () => updateStageBounds(true));
      inp.addEventListener('change', () => {
        updateStageBounds(false);
        focusStage();
      });
    });
  }

  function bindToolbarInputs() {
    if (app.sizeInput) {
      app.sizeInput.addEventListener('input', () => {
        sanitizeIntegerField(app.sizeInput, { min: 1, max: 150, allowEmpty: true });
      });
      app.sizeInput.addEventListener('change', () => {
        sanitizeIntegerField(app.sizeInput, { min: 1, max: 150, allowEmpty: false, fallbackValue: state.inkWidthPct || 84 });
        focusStage();
      });
      const applyOnEnter = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applySubmittedChanges();
        }
      };
      app.sizeInput.addEventListener('keydown', applyOnEnter);
    }

    if (app.applyBtn) app.applyBtn.addEventListener('click', applySubmittedChanges);
    if (app.applyLHBtn) app.applyLHBtn.addEventListener('click', applyLineHeight);
    if (app.lhInput) app.lhInput.addEventListener('input', () => { app.lhInput.value = String(readStagedLH()); });
    if (app.showMarginBoxCb) {
      app.showMarginBoxCb.addEventListener('change', () => {
        state.showMarginBox = !!app.showMarginBoxCb.checked;
        renderMargins();
        saveStateDebounced();
        focusStage();
      });
    }
    if (app.cpiSelect) {
      app.cpiSelect.addEventListener('change', () => {
        updateColsPreviewUI();
        focusStage();
      });
    }
    if (app.wordWrapCb) {
      app.wordWrapCb.addEventListener('change', () => {
        state.wordWrap = !!app.wordWrapCb.checked;
        saveStateDebounced();
        focusStage();
      });
    }
  }

  function bindRulerInteractions() {
    app.rulerH_stops_container.addEventListener('pointerdown', e => {
      const tri = e.target.closest('.tri');
      if (!tri) return;
      e.preventDefault();
      setDrag({ kind: 'h', side: tri.classList.contains('left') ? 'left' : 'right', pointerId: e.pointerId });
      setMarginBoxesVisible(false);
      tri.setPointerCapture?.(e.pointerId);
      document.addEventListener('pointermove', handleHorizontalMarginDrag);
      document.addEventListener('pointerup', endMarginDrag, true);
      document.addEventListener('pointercancel', endMarginDrag, true);
    }, { passive: false });

    app.rulerV_stops_container.addEventListener('pointerdown', e => {
      const tri = e.target.closest('.tri-v');
      if (!tri) return;
      e.preventDefault();
      setDrag({ kind: 'v', side: tri.classList.contains('top') ? 'top' : 'bottom', pointerId: e.pointerId });
      setMarginBoxesVisible(false);
      tri.setPointerCapture?.(e.pointerId);
      document.addEventListener('pointermove', handleVerticalMarginDrag);
      document.addEventListener('pointerup', endMarginDrag, true);
      document.addEventListener('pointercancel', endMarginDrag, true);
    }, { passive: false });
  }

  function bindZoomControls() {
    app.zoomSlider.addEventListener('pointerdown', onZoomPointerDown, { passive: false });
    window.addEventListener('pointermove', onZoomPointerMove, { passive: true });
    window.addEventListener('pointerup', onZoomPointerUp, { passive: true });
    app.zoomIndicator.addEventListener('dblclick', () => setZoomPercent(100));
  }

  function bindGlobalListeners() {
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('paste', handlePaste, { capture: true });
    app.stage.addEventListener('wheel', handleWheelPan, { passive: false });
    window.addEventListener('resize', () => {
      positionRulers();
      if (!isZooming()) requestHammerNudge();
      requestVirtualization();
    }, { passive: true });
    window.addEventListener('beforeunload', saveStateNow);
    window.addEventListener('click', () => window.focus(), { passive: true });
  }

  function bindPrimaryControls() {
    app.toggleMarginsBtn.onclick = toggleRulers;
    app.exportBtn.addEventListener('click', exportToTextFile);
    if (app.newDocBtn) {
      app.newDocBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        createNewDocument();
      });
    }
  }

  function bindEventListeners() {
    bindPrimaryControls();
    bindOpacitySliders();
    bindInkButtons();
    bindGrainInput();
    bindDialogToggles();
    bindMarginInputs();
    bindStageSizeInputs();
    bindToolbarInputs();
    bindAppearanceControls();
    bindRulerInteractions();
    bindZoomControls();
    bindGlobalListeners();
  }

  function loadPersistedState() {
    let raw = null;
    let savedFont = null;
    let loaded = false;
    try {
      raw = JSON.parse(localStorage.getItem(storageKey));
    } catch {}
    if (raw) savedFont = raw.fontName;
    try {
      loaded = deserializeState(raw);
    } catch {}
    return { loaded, savedFont };
  }

  function populateInitialUI({ loaded }) {
    if (app.inkOpacityBSlider) app.inkOpacityBSlider.value = String(state.inkOpacity.b);
    if (app.inkOpacityRSlider) app.inkOpacityRSlider.value = String(state.inkOpacity.r);
    if (app.inkOpacityWSlider) app.inkOpacityWSlider.value = String(state.inkOpacity.w);
    if (app.inkOpacityBValue) app.inkOpacityBValue.textContent = `${state.inkOpacity.b}%`;
    if (app.inkOpacityRValue) app.inkOpacityRValue.textContent = `${state.inkOpacity.r}%`;
    if (app.inkOpacityWValue) app.inkOpacityWValue.textContent = `${state.inkOpacity.w}%`;

    if (app.grainInput) app.grainInput.value = String(state.grainPct);
    if (app.cpiSelect) app.cpiSelect.value = String(state.cpi || 10);
    updateColsPreviewUI();
    if (app.sizeInput) app.sizeInput.value = String(clamp(Math.round(state.inkWidthPct ?? 84), 1, 150));
    if (app.lhInput) app.lhInput.value = String(state.lineHeightFactor);
    if (app.showMarginBoxCb) app.showMarginBoxCb.checked = !!state.showMarginBox;
    if (app.wordWrapCb) app.wordWrapCb.checked = !!state.wordWrap;
    if (app.mmLeft) app.mmLeft.value = Math.round(mmX(state.marginL));
    if (app.mmRight) app.mmRight.value = Math.round(mmX(app.PAGE_W - state.marginR));
    if (app.mmTop) app.mmTop.value = Math.round(mmY(state.marginTop));
    if (app.mmBottom) app.mmBottom.value = Math.round(mmY(state.marginBottom));
    if (app.stageWidthPct) app.stageWidthPct.value = String(Math.round(sanitizedStageWidthFactor() * 100));
    if (app.stageHeightPct) app.stageHeightPct.value = String(Math.round(sanitizedStageHeightFactor() * 100));
    if (app.appearanceAuto) app.appearanceAuto.checked = !['light', 'dark'].includes(state.themeMode);
    if (app.appearanceLight) app.appearanceLight.checked = state.themeMode === 'light';
    if (app.appearanceDark) app.appearanceDark.checked = state.themeMode === 'dark';
    if (app.darkPageToggle) app.darkPageToggle.checked = !!state.darkPageInDarkMode;
    if (app.darkPageToggle) app.darkPageToggle.disabled = state.themeMode === 'light';

    if (!loaded) {
      state.cpi = 10;
      state.colsAcross = computeColsFromCpi(10).cols2;
      state.inkWidthPct = 84;
      state.inkOpacity = { b: 100, r: 100, w: 100 };
      state.grainPct = 0;
      state.grainSeed = ((Math.random() * 0xFFFFFFFF) >>> 0);
      state.altSeed = ((Math.random() * 0xFFFFFFFF) >>> 0);
      state.wordWrap = true;
      applyDefaultMargins();
    }
  }

  bindEventListeners();

  return {
    saveStateNow,
    saveStateDebounced,
    serializeState,
    deserializeState,
    loadPersistedState,
    populateInitialUI,
  };
}
