import { syncRulerToggleButton } from '../init/ui/rulerToggle.js';
import { INK_PALETTE, normalizeInkId } from '../config/inkPalette.js';

export function createDocumentViewAdapter({ app }) {
  function updateCaretDom({ pageEl, left, top, height, width }) {
    const caret = app?.caretEl;
    if (!caret) return;
    caret.style.left = left + 'px';
    caret.style.top = top + 'px';
    caret.style.height = height + 'px';
    caret.style.width = width + 'px';
    if (pageEl && caret.parentNode !== pageEl) {
      caret.remove();
      pageEl.appendChild(caret);
    }
  }

  function setActivePageIndex(index) {
    app.activePageIndex = index;
  }

  function toggleRulers(showRulers) {
    document.body.classList.toggle('rulers-off', !showRulers);
    syncRulerToggleButton(app?.toggleMarginsBtn, showRulers);
  }

  function rebuildStageForNewDocument({ pageIndex = 0, pageHeight, showMarginBox, prepareCanvas }) {
    if (!app.stageInner) return null;
    app.stageInner.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = String(pageIndex);
    const pageEl = document.createElement('div');
    pageEl.className = 'page';
    pageEl.style.height = pageHeight + 'px';
    const canvas = document.createElement('canvas');
    if (typeof prepareCanvas === 'function') {
      prepareCanvas(canvas);
    }
    const marginBox = document.createElement('div');
    marginBox.className = 'margin-box';
    marginBox.style.visibility = showMarginBox ? 'visible' : 'hidden';
    pageEl.appendChild(canvas);
    pageEl.appendChild(marginBox);
    wrap.appendChild(pageEl);
    app.stageInner.appendChild(wrap);
    app.firstPageWrap = wrap;
    app.firstPage = pageEl;
    app.marginBox = marginBox;
    return { wrap, pageEl, canvas, marginBox };
  }

  function setInkButtonsState(ink) {
    const normalized = normalizeInkId(ink);
    INK_PALETTE.forEach(({ id, buttonId }) => {
      const btn = app?.[buttonId];
      if (btn) btn.dataset.active = String(normalized === id);
    });
  }

  return {
    updateCaretDom,
    setActivePageIndex,
    toggleRulers,
    rebuildStageForNewDocument,
    setInkButtonsState,
  };
}
