import { clamp } from '../../utils/math.js';
import { sanitizeIntegerField } from '../../utils/forms.js';
import {
  LOW_RES_ZOOM_DEFAULTS,
  normalizeLowResZoomSettings,
  ZOOM_SLIDER_MAX_PCT,
  ZOOM_SLIDER_MIN_PCT,
} from '../../config/lowResZoom.js';
import { createDefaultPageNumberingSettings, sanitizePageNumberingSettings } from '../../config/pageNumbering.js';
import { TYPEWRITER_DEFAULTS, normalizeTypewriterSettings } from '../../config/typewriterMode.js';

export function createMeasurementControls({
  app,
  state,
  pxX,
  pxY,
  mmX,
  mmY,
  focusStage,
  renderMargins,
  clampCaretToBounds,
  updateCaretPosition,
  positionRulers,
  queueDirtySave,
  sanitizeStageInput,
  sanitizedStageWidthFactor,
  sanitizedStageHeightFactor,
  updateStageEnvironment,
  requestVirtualization,
  applySubmittedChanges,
  applyLineHeight,
  readStagedLH,
  applyPaperSizeSelection,
  schedulePaint,
  toggleRulers,
  setMarginBoxesVisible,
  setRenderScaleForZoom,
  scheduleZoomCrispRedraw,
  setDrag,
  handleHorizontalMarginDrag,
  handleVerticalMarginDrag,
  endMarginDrag,
  onZoomPointerDown,
  onZoomPointerMove,
  onZoomPointerUp,
  setZoomPercent,
  handleWheelPan,
  handleScrollLaneScroll = () => {},
  requestHammerNudge,
  isZooming,
  applyDefaultMargins,
  computeColsFromCpi,
  gridDiv,
}) {
  function updateColsPreviewUI() {
    const cpi = parseFloat(app.cpiSelect?.value) || 10;
    const { cols2 } = computeColsFromCpi(cpi);
    if (app.colsPreviewSpan) {
      app.colsPreviewSpan.textContent = `Columns: ${cols2.toFixed(2)}`;
    }
  }

  function syncMarginInputsFromState() {
    if (app.mmLeft) app.mmLeft.value = String(Math.round(mmX(state.marginL)));
    if (app.mmRight) app.mmRight.value = String(Math.round(mmX(app.PAGE_W - state.marginR)));
    if (app.mmTop) app.mmTop.value = String(Math.round(mmY(state.marginTop)));
    if (app.mmBottom) app.mmBottom.value = String(Math.round(mmY(app.PAGE_H - state.marginBottom)));
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
      markPageNumbersDirty();
      queueDirtySave();
    };

    [app.mmLeft, app.mmRight, app.mmTop, app.mmBottom].forEach((inp) => {
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

  function bindStageSizeInputs() {
    const updateStageBounds = (allowEmpty) => {
      const widthFactor = sanitizeStageInput(app.stageWidthPct, state.stageWidthFactor, allowEmpty, true);
      const heightFactor = sanitizeStageInput(app.stageHeightPct, state.stageHeightFactor, allowEmpty, false);
      if (widthFactor !== null) state.stageWidthFactor = widthFactor;
      if (heightFactor !== null) state.stageHeightFactor = heightFactor;
      updateStageEnvironment();
      queueDirtySave();
      requestVirtualization();
    };

    [app.stageWidthPct, app.stageHeightPct].forEach((inp) => {
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
        sanitizeIntegerField(app.sizeInput, { min: 1, max: 150, allowEmpty: false, fallbackValue: state.inkWidthPct || 95 });
        applySubmittedChanges();
        focusStage();
      });
      app.sizeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applySubmittedChanges();
        }
      });
    }

    if (app.lhInput) {
      app.lhInput.addEventListener('input', () => {
        app.lhInput.value = String(readStagedLH());
      });
      app.lhInput.addEventListener('change', () => {
        applyLineHeight();
        markPageNumbersDirty();
      });
    }

    if (app.showMarginBoxCb) {
      app.showMarginBoxCb.addEventListener('change', () => {
        state.showMarginBox = !!app.showMarginBoxCb.checked;
        setMarginBoxesVisible(state.showMarginBox);
        renderMargins();
        queueDirtySave();
        focusStage();
      });
    }

    if (app.cpiSelect) {
      app.cpiSelect.addEventListener('change', () => {
        updateColsPreviewUI();
        applySubmittedChanges();
        focusStage();
      });
    }

    if (app.paperSizeSelect) {
      app.paperSizeSelect.addEventListener('change', () => {
        const value = app.paperSizeSelect.value;
        if (typeof applyPaperSizeSelection === 'function') {
          applyPaperSizeSelection(value);
          updateColsPreviewUI();
          queueDirtySave();
          syncMarginInputsFromState();
          markPageNumbersDirty();
        }
        focusStage();
      });
    }

    if (app.wordWrapCb) {
      app.wordWrapCb.addEventListener('change', () => {
        state.wordWrap = !!app.wordWrapCb.checked;
        queueDirtySave();
        focusStage();
      });
    }
  }
  function updateWordWrapAvailability() {
    if (!app.wordWrapCb) return;
    const disabled = state.realTypewriterEnabled === true;
    app.wordWrapCb.disabled = disabled;
    const note = app.wordWrapNote;
    const row = app.wordWrapRow;
    if (disabled) {
      app.wordWrapCb.checked = true;
      if (note) {
        note.hidden = false;
        note.setAttribute('aria-hidden', 'false');
      }
      if (row) row.classList.add('is-disabled');
    } else {
      if (note) {
        note.hidden = true;
        note.setAttribute('aria-hidden', 'true');
      }
      if (row) row.classList.remove('is-disabled');
    }
  }

  function sanitizeLowResZoomInputs() {
    const normalized = normalizeLowResZoomSettings({
      softCapPct: Number.parseFloat(app.lowResZoomSoftCap?.value),
      marginPct: Number.parseFloat(app.lowResZoomMargin?.value),
    });
    state.lowResZoomSoftCapPct = normalized.softCapPct;
    state.lowResZoomMarginPct = normalized.marginPct;
    if (app.lowResZoomSoftCap) {
      app.lowResZoomSoftCap.value = String(normalized.softCapPct);
      app.lowResZoomSoftCap.min = String(ZOOM_SLIDER_MIN_PCT);
      app.lowResZoomSoftCap.max = String(ZOOM_SLIDER_MAX_PCT);
    }
    if (app.lowResZoomMargin) {
      const marginMax = Math.max(0, ZOOM_SLIDER_MAX_PCT - normalized.softCapPct);
      app.lowResZoomMargin.value = String(normalized.marginPct);
      app.lowResZoomMargin.min = '0';
      app.lowResZoomMargin.max = String(marginMax);
    }
    return normalized;
  }

  function syncLowResZoomUI() {
    if (typeof state.lowResZoomEnabled !== 'boolean') {
      state.lowResZoomEnabled = LOW_RES_ZOOM_DEFAULTS.enabled;
    }
    const normalized = normalizeLowResZoomSettings({
      softCapPct: state.lowResZoomSoftCapPct,
      marginPct: state.lowResZoomMarginPct,
    });
    state.lowResZoomSoftCapPct = normalized.softCapPct;
    state.lowResZoomMarginPct = normalized.marginPct;
    const enabled = state.lowResZoomEnabled !== false;
    if (app.lowResZoomToggle) {
      app.lowResZoomToggle.checked = enabled;
    }
    if (app.lowResZoomSoftCap) {
      app.lowResZoomSoftCap.value = String(normalized.softCapPct);
      app.lowResZoomSoftCap.disabled = !enabled;
      app.lowResZoomSoftCap.min = String(ZOOM_SLIDER_MIN_PCT);
      app.lowResZoomSoftCap.max = String(ZOOM_SLIDER_MAX_PCT);
    }
    if (app.lowResZoomMargin) {
      const marginMax = Math.max(0, ZOOM_SLIDER_MAX_PCT - normalized.softCapPct);
      app.lowResZoomMargin.value = String(normalized.marginPct);
      app.lowResZoomMargin.disabled = !enabled;
      app.lowResZoomMargin.min = '0';
      app.lowResZoomMargin.max = String(marginMax);
    }
    if (app.lowResZoomControls) {
      app.lowResZoomControls.classList.toggle('disabled', !enabled);
    }
    return normalized;
  }

  function hideMarginReleaseBtn() {
    if (!app.marginReleaseBtn) return;
    app.marginReleaseBtn.classList.remove('is-visible');
    app.marginReleaseBtn.disabled = true;
    app.marginReleaseBtn.setAttribute('aria-hidden', 'true');
  }

  function syncTypewriterUI() {
    const normalized = normalizeTypewriterSettings(
      {
        enabled: state.realTypewriterEnabled,
        bellSound: state.realTypewriterBellSound,
        bellVolume: state.realTypewriterBellVolume,
        bellLead: state.realTypewriterBellLead,
        stopSound: state.realTypewriterStopSound,
        stopEnabled: state.realTypewriterStopEnabled,
      },
      TYPEWRITER_DEFAULTS,
    );
    state.realTypewriterEnabled = normalized.enabled;
    state.realTypewriterBellSound = normalized.bellSound;
    state.realTypewriterBellVolume = normalized.bellVolume;
    state.realTypewriterBellLead = normalized.bellLead;
    state.realTypewriterStopSound = normalized.stopSound;
    state.realTypewriterStopEnabled = normalized.stopEnabled;

    if (app.typewriterToggle) app.typewriterToggle.checked = normalized.enabled;
    if (app.typewriterBellSelect) app.typewriterBellSelect.value = normalized.bellSound;
    if (app.typewriterBellVolume) app.typewriterBellVolume.value = String(normalized.bellVolume);
    if (app.typewriterBellVolumeValue) app.typewriterBellVolumeValue.textContent = `${normalized.bellVolume}%`;
    if (app.typewriterBellLead) app.typewriterBellLead.value = String(normalized.bellLead);
    if (app.typewriterStopSelect) app.typewriterStopSelect.value = normalized.stopSound;
    if (app.typewriterStopToggle) app.typewriterStopToggle.checked = normalized.stopEnabled;
    if (!normalized.enabled) {
      state.typewriterMarginRelease = false;
      hideMarginReleaseBtn();
    }
    updateWordWrapAvailability();
  }

  function applyLowResZoomEffects() {
    if (typeof setRenderScaleForZoom === 'function') {
      setRenderScaleForZoom();
    }
    if (typeof scheduleZoomCrispRedraw === 'function') {
      scheduleZoomCrispRedraw();
    }
  }

  function ensurePageNumberingState() {
    const sanitized = sanitizePageNumberingSettings(
      state.pageNumbering,
      createDefaultPageNumberingSettings(),
    );
    state.pageNumbering = sanitized;
    return sanitized;
  }

  function markPageNumbersDirty() {
    if (!state?.pageNumbering?.enabled) return;
    const pages = Array.isArray(state.pages) ? state.pages : [];
    pages.forEach((page) => {
      if (!page) return;
      page.dirtyAll = true;
      if (typeof schedulePaint === 'function' && page.active) {
        schedulePaint(page);
      }
    });
    if (typeof requestVirtualization === 'function') {
      requestVirtualization();
    }
  }

  function syncPageNumberingUI() {
    const settings = ensurePageNumberingState();
    const enabled = settings.enabled === true;
    if (app.pageNumberToggle) app.pageNumberToggle.checked = enabled;
    if (app.pageNumberOffset) {
      app.pageNumberOffset.value = String(settings.offsetLines);
      app.pageNumberOffset.disabled = !enabled;
    }
    const alignInputs = [
      app.pageNumberAlignLeft,
      app.pageNumberAlignCenter,
      app.pageNumberAlignRight,
    ].filter(Boolean);
    alignInputs.forEach((inp) => {
      inp.disabled = !enabled;
      inp.checked = inp.value === settings.alignment;
    });
  }

  function bindPageNumberingControls() {
    if (app.pageNumberToggle) {
      app.pageNumberToggle.addEventListener('change', () => {
        const settings = ensurePageNumberingState();
        settings.enabled = !!app.pageNumberToggle.checked;
        syncPageNumberingUI();
        markPageNumbersDirty();
        queueDirtySave();
      });
    }

    if (app.pageNumberOffset) {
      const applyOffset = () => {
        sanitizeIntegerField(app.pageNumberOffset, { min: 0, allowEmpty: true });
        const settings = ensurePageNumberingState();
        settings.offsetLines = Math.max(0, Math.round(Number(app.pageNumberOffset.value) || 0));
        markPageNumbersDirty();
        queueDirtySave();
      };
      app.pageNumberOffset.addEventListener('input', applyOffset);
      app.pageNumberOffset.addEventListener('change', applyOffset);
    }

    [app.pageNumberAlignLeft, app.pageNumberAlignCenter, app.pageNumberAlignRight].forEach((inp) => {
      if (!inp) return;
      inp.addEventListener('change', () => {
        if (!inp.checked) return;
        const settings = ensurePageNumberingState();
        settings.alignment = inp.value;
        markPageNumbersDirty();
        queueDirtySave();
      });
    });
  }

  function bindTypewriterControls() {
    if (app.typewriterToggle) {
      app.typewriterToggle.addEventListener('change', () => {
        state.realTypewriterEnabled = !!app.typewriterToggle.checked;
        if (!state.realTypewriterEnabled) {
          state.typewriterMarginRelease = false;
          hideMarginReleaseBtn();
        }
        updateWordWrapAvailability();
        queueDirtySave();
        focusStage();
      });
    }

    if (app.typewriterBellSelect) {
      app.typewriterBellSelect.addEventListener('change', () => {
        const val = app.typewriterBellSelect.value || TYPEWRITER_DEFAULTS.bellSound;
        state.realTypewriterBellSound = val;
        queueDirtySave();
      });
    }
    const playSample = (id, volumePct) => {
      if (!id) return;
      const isBell = id.startsWith('bell-');
      const ext = isBell ? 'mp3' : 'wav';
      const audio = new Audio(`audio/${id}.${ext}`);
      const vol = clamp(Math.round(Number(volumePct ?? state.realTypewriterBellVolume ?? 70)), 0, 100) / 100 * 0.75;
      audio.volume = vol;
      audio.play().catch(() => {});
    };
    if (app.typewriterBellPreview) {
      app.typewriterBellPreview.addEventListener('click', () => {
        playSample(state.realTypewriterBellSound || TYPEWRITER_DEFAULTS.bellSound, state.realTypewriterBellVolume);
      });
    }

    if (app.typewriterBellVolume) {
      const applyVolume = () => {
        const value = clamp(Math.round(Number(app.typewriterBellVolume.value) || 0), 0, 100);
        state.realTypewriterBellVolume = value;
        if (app.typewriterBellVolumeValue) app.typewriterBellVolumeValue.textContent = `${value}%`;
        queueDirtySave();
      };
      app.typewriterBellVolume.addEventListener('input', applyVolume);
      app.typewriterBellVolume.addEventListener('change', applyVolume);
    }

    if (app.typewriterBellLead) {
      const applyLead = () => {
        sanitizeIntegerField(app.typewriterBellLead, { min: 0, max: 40, allowEmpty: true });
        const value = clamp(Math.round(Number(app.typewriterBellLead.value) || 0), 0, 40);
        state.realTypewriterBellLead = value;
        queueDirtySave();
      };
      app.typewriterBellLead.addEventListener('input', applyLead);
      app.typewriterBellLead.addEventListener('change', applyLead);
    }

    if (app.typewriterStopToggle) {
      app.typewriterStopToggle.addEventListener('change', () => {
        state.realTypewriterStopEnabled = !!app.typewriterStopToggle.checked;
        queueDirtySave();
      });
    }

    if (app.typewriterStopSelect) {
      app.typewriterStopSelect.addEventListener('change', () => {
        const val = app.typewriterStopSelect.value || TYPEWRITER_DEFAULTS.stopSound;
        state.realTypewriterStopSound = val;
        queueDirtySave();
      });
    }
    if (app.typewriterStopPreview) {
      app.typewriterStopPreview.addEventListener('click', () => {
        playSample(state.realTypewriterStopSound || TYPEWRITER_DEFAULTS.stopSound, state.realTypewriterBellVolume);
      });
    }
  }

  function bindLowResZoomControls() {
    if (app.lowResZoomToggle) {
      app.lowResZoomToggle.addEventListener('change', () => {
        state.lowResZoomEnabled = !!app.lowResZoomToggle.checked;
        syncLowResZoomUI();
        queueDirtySave();
        applyLowResZoomEffects();
      });
    }
    [app.lowResZoomSoftCap, app.lowResZoomMargin].forEach((input) => {
      if (!input) return;
      input.addEventListener('change', () => {
        sanitizeLowResZoomInputs();
        syncLowResZoomUI();
        queueDirtySave();
        applyLowResZoomEffects();
      });
      input.addEventListener('blur', () => {
        sanitizeLowResZoomInputs();
        syncLowResZoomUI();
      });
    });
  }

  function bindRulerInteractions() {
    if (app.rulerH_stops_container) {
      app.rulerH_stops_container.addEventListener('pointerdown', (e) => {
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
    }

    if (app.rulerV_stops_container) {
      app.rulerV_stops_container.addEventListener('pointerdown', (e) => {
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
  }

  function bindZoomControls() {
    if (app.zoomSlider) app.zoomSlider.addEventListener('pointerdown', onZoomPointerDown, { passive: false });
    window.addEventListener('pointermove', onZoomPointerMove, { passive: true });
    window.addEventListener('pointerup', onZoomPointerUp, { passive: true });
    if (app.zoomIndicator) {
      app.zoomIndicator.addEventListener('dblclick', () => setZoomPercent(100));
    }
  }

  function bindPrimaryControls() {
    if (app.toggleMarginsBtn) app.toggleMarginsBtn.onclick = toggleRulers;
  }

  function bindMeasurementControls() {
    bindPrimaryControls();
    bindMarginInputs();
    bindStageSizeInputs();
    bindToolbarInputs();
    bindLowResZoomControls();
    bindPageNumberingControls();
    bindTypewriterControls();
    bindRulerInteractions();
    bindZoomControls();
    if (app.stage) {
      app.stage.addEventListener('wheel', handleWheelPan, { passive: false });
    }
    if (app.scrollLane) {
      app.scrollLane.addEventListener('scroll', handleScrollLaneScroll, { passive: true });
    }
    window.addEventListener('resize', () => {
      positionRulers();
      if (!isZooming()) requestHammerNudge();
      requestVirtualization();
    }, { passive: true });
  }

  function applyMeasurementDefaults(loaded) {
    if (loaded) return;
    state.cpi = 10;
    state.colsAcross = computeColsFromCpi(10).cols2;
    state.inkWidthPct = 95;
    state.lineHeightFactor = 1.5;
    const baseGridDiv = Number.isFinite(gridDiv) ? gridDiv : 8;
    state.lineStepMu = Math.round(state.lineHeightFactor * baseGridDiv);
    state.wordWrap = true;
    state.pageNumbering = sanitizePageNumberingSettings(
      state.pageNumbering,
      createDefaultPageNumberingSettings(),
    );
    state.realTypewriterEnabled = TYPEWRITER_DEFAULTS.enabled;
    state.realTypewriterBellSound = TYPEWRITER_DEFAULTS.bellSound;
    state.realTypewriterBellVolume = TYPEWRITER_DEFAULTS.bellVolume;
    state.realTypewriterBellLead = TYPEWRITER_DEFAULTS.bellLead;
    state.realTypewriterStopSound = TYPEWRITER_DEFAULTS.stopSound;
    state.realTypewriterStopEnabled = TYPEWRITER_DEFAULTS.stopEnabled;
    state.typewriterMarginRelease = false;
    applyDefaultMargins();
  }

  function populateMeasurementUI({ loaded } = {}) {
    applyMeasurementDefaults(loaded);
    if (app.cpiSelect) {
      app.cpiSelect.value = String(state.cpi || 10);
      updateColsPreviewUI();
    }
    if (app.paperSizeSelect) {
      app.paperSizeSelect.value = state.paperSize || 'a4';
    }
    if (app.sizeInput) app.sizeInput.value = String(clamp(Math.round(state.inkWidthPct ?? 95), 1, 150));
    if (app.lhInput) app.lhInput.value = String(state.lineHeightFactor);
    if (app.showMarginBoxCb) app.showMarginBoxCb.checked = !!state.showMarginBox;
    if (app.wordWrapCb) app.wordWrapCb.checked = !!state.wordWrap;
    if (app.mmLeft) app.mmLeft.value = Math.round(mmX(state.marginL));
    if (app.mmRight) app.mmRight.value = Math.round(mmX(app.PAGE_W - state.marginR));
    if (app.mmTop) app.mmTop.value = Math.round(mmY(state.marginTop));
    if (app.mmBottom) app.mmBottom.value = Math.round(mmY(state.marginBottom));
    if (app.stageWidthPct) app.stageWidthPct.value = String(Math.round(sanitizedStageWidthFactor() * 100));
    if (app.stageHeightPct) app.stageHeightPct.value = String(Math.round(sanitizedStageHeightFactor() * 100));
    syncPageNumberingUI();
    syncLowResZoomUI();
    syncTypewriterUI();
  }

  return {
    bindMeasurementControls,
    populateMeasurementUI,
    syncLowResZoomUI,
  };
}
