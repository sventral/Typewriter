import { clamp } from '../../utils/math.js';
import { sanitizeIntegerField } from '../../utils/forms.js';
import {
  LOW_RES_ZOOM_DEFAULTS,
  normalizeLowResZoomSettings,
  ZOOM_SLIDER_MAX_PCT,
  ZOOM_SLIDER_MIN_PCT,
} from '../../config/lowResZoom.js';

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

    if (app.wordWrapCb) {
      app.wordWrapCb.addEventListener('change', () => {
        state.wordWrap = !!app.wordWrapCb.checked;
        queueDirtySave();
        focusStage();
      });
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

  function applyLowResZoomEffects() {
    if (typeof setRenderScaleForZoom === 'function') {
      setRenderScaleForZoom();
    }
    if (typeof scheduleZoomCrispRedraw === 'function') {
      scheduleZoomCrispRedraw();
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
    bindRulerInteractions();
    bindZoomControls();
    if (app.stage) {
      app.stage.addEventListener('wheel', handleWheelPan, { passive: false });
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
    applyDefaultMargins();
  }

  function populateMeasurementUI({ loaded } = {}) {
    applyMeasurementDefaults(loaded);
    if (app.cpiSelect) {
      app.cpiSelect.value = String(state.cpi || 10);
      updateColsPreviewUI();
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
    syncLowResZoomUI();
  }

  return {
    bindMeasurementControls,
    populateMeasurementUI,
    syncLowResZoomUI,
  };
}
