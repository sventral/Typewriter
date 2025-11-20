import { sanitizeIntegerField } from '../../utils/forms.js';
import {
  createDefaultHeaderFooterSettings,
  sanitizeHeaderFooterSettings,
} from '../../config/headerFooter.js';

function ensureSettings(state) {
  if (!state.headerFooter || typeof state.headerFooter !== 'object') {
    state.headerFooter = createDefaultHeaderFooterSettings();
  }
  state.headerFooter = sanitizeHeaderFooterSettings(state.headerFooter);
  return state.headerFooter;
}

export function createHeaderFooterControls({
  app,
  state,
  mmX,
  pxX,
  renderHeaderFooter,
  queueDirtySave,
}) {
  const toMmX = (px) => (typeof mmX === 'function' ? mmX(px) : 0);
  const toPxX = (mm) => (typeof pxX === 'function' ? pxX(mm) : 0);
  const notifyChange = () => {
    queueDirtySave();
    if (typeof renderHeaderFooter === 'function') {
      renderHeaderFooter();
    }
  };

  function syncDisabledStates(settings) {
    const useCustomMargins = settings.useCustomMargins === true;
    if (app.headerFooterMarginLeft) app.headerFooterMarginLeft.disabled = !useCustomMargins;
    if (app.headerFooterMarginRight) app.headerFooterMarginRight.disabled = !useCustomMargins;
    const startToggle = settings.startPageNumberEnabled === true;
    if (app.headerFooterStartPageInput) app.headerFooterStartPageInput.disabled = !startToggle;
  }

  function syncHeaderFooterUI() {
    const settings = ensureSettings(state);
    if (app.headerLeft) app.headerLeft.value = settings.header.left;
    if (app.headerCenter) app.headerCenter.value = settings.header.center;
    if (app.headerRight) app.headerRight.value = settings.header.right;
    if (app.footerLeft) app.footerLeft.value = settings.footer.left;
    if (app.footerCenter) app.footerCenter.value = settings.footer.center;
    if (app.footerRight) app.footerRight.value = settings.footer.right;
    if (app.headerLinesFromTop) app.headerLinesFromTop.value = String(settings.header.offsetLines || 0);
    if (app.footerLinesFromBottom) app.footerLinesFromBottom.value = String(settings.footer.offsetLines || 0);
    if (app.headerFooterCustomMarginToggle) {
      app.headerFooterCustomMarginToggle.checked = settings.useCustomMargins === true;
    }
    if (app.headerFooterMarginLeft) {
      const mmLeft = settings.customMarginLeftPx == null ? '' : Math.round(toMmX(settings.customMarginLeftPx));
      app.headerFooterMarginLeft.value = mmLeft;
    }
    if (app.headerFooterMarginRight) {
      const mmRight = settings.customMarginRightPx == null ? '' : Math.round(toMmX(settings.customMarginRightPx));
      app.headerFooterMarginRight.value = mmRight;
    }
    if (app.headerFooterStartPageToggle) {
      app.headerFooterStartPageToggle.checked = settings.startPageNumberEnabled === true;
    }
    if (app.headerFooterStartPageInput) {
      app.headerFooterStartPageInput.value = String(settings.startPageNumber || 1);
    }
    syncDisabledStates(settings);
  }

  function bindTextInputs() {
    const applyText = () => {
      const settings = ensureSettings(state);
      settings.header.left = app.headerLeft?.value ?? '';
      settings.header.center = app.headerCenter?.value ?? '';
      settings.header.right = app.headerRight?.value ?? '';
      settings.footer.left = app.footerLeft?.value ?? '';
      settings.footer.center = app.footerCenter?.value ?? '';
      settings.footer.right = app.footerRight?.value ?? '';
      notifyChange();
    };
    [
      app.headerLeft,
      app.headerCenter,
      app.headerRight,
      app.footerLeft,
      app.footerCenter,
      app.footerRight,
    ].forEach((inp) => {
      if (!inp) return;
      inp.addEventListener('input', applyText);
    });
  }

  function bindOffsetInputs() {
    const applyOffsets = () => {
      const settings = ensureSettings(state);
      if (app.headerLinesFromTop) {
        sanitizeIntegerField(app.headerLinesFromTop, { min: 0, allowEmpty: true });
        settings.header.offsetLines = Math.max(0, Math.round(Number(app.headerLinesFromTop.value) || 0));
      }
      if (app.footerLinesFromBottom) {
        sanitizeIntegerField(app.footerLinesFromBottom, { min: 0, allowEmpty: true });
        settings.footer.offsetLines = Math.max(0, Math.round(Number(app.footerLinesFromBottom.value) || 0));
      }
      notifyChange();
    };
    [app.headerLinesFromTop, app.footerLinesFromBottom].forEach((inp) => {
      if (!inp) return;
      inp.addEventListener('input', applyOffsets);
      inp.addEventListener('change', applyOffsets);
    });
  }

  function bindMarginControls() {
    if (app.headerFooterCustomMarginToggle) {
      app.headerFooterCustomMarginToggle.addEventListener('change', () => {
        const settings = ensureSettings(state);
        settings.useCustomMargins = !!app.headerFooterCustomMarginToggle.checked;
        syncDisabledStates(settings);
        notifyChange();
      });
    }

    const applyCustomMargins = () => {
      const settings = ensureSettings(state);
      if (settings.useCustomMargins) {
        if (app.headerFooterMarginLeft) {
          sanitizeIntegerField(app.headerFooterMarginLeft, { min: 0, allowEmpty: true });
          settings.customMarginLeftPx = toPxX(Math.max(0, Number(app.headerFooterMarginLeft.value) || 0));
        }
        if (app.headerFooterMarginRight) {
          sanitizeIntegerField(app.headerFooterMarginRight, { min: 0, allowEmpty: true });
          settings.customMarginRightPx = toPxX(Math.max(0, Number(app.headerFooterMarginRight.value) || 0));
        }
      }
      notifyChange();
    };

    [app.headerFooterMarginLeft, app.headerFooterMarginRight].forEach((inp) => {
      if (!inp) return;
      inp.addEventListener('input', applyCustomMargins);
      inp.addEventListener('change', applyCustomMargins);
    });
  }

  function bindNumberingControls() {
    if (app.headerFooterStartPageToggle) {
      app.headerFooterStartPageToggle.addEventListener('change', () => {
        const settings = ensureSettings(state);
        settings.startPageNumberEnabled = !!app.headerFooterStartPageToggle.checked;
        syncDisabledStates(settings);
        notifyChange();
      });
    }
    if (app.headerFooterStartPageInput) {
      const applyStartPage = () => {
        sanitizeIntegerField(app.headerFooterStartPageInput, { min: 1, allowEmpty: false, fallbackValue: 1 });
        const settings = ensureSettings(state);
        settings.startPageNumber = Math.max(1, Math.round(Number(app.headerFooterStartPageInput.value) || 1));
        notifyChange();
      };
      app.headerFooterStartPageInput.addEventListener('input', applyStartPage);
      app.headerFooterStartPageInput.addEventListener('change', applyStartPage);
    }
  }

  function bindHeaderFooterControls() {
    bindTextInputs();
    bindOffsetInputs();
    bindMarginControls();
    bindNumberingControls();
  }

  return {
    bindHeaderFooterControls,
    populateHeaderFooterUI: syncHeaderFooterUI,
  };
}
