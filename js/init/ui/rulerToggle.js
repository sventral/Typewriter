export function syncRulerToggleButton(buttonEl, showRulers) {
  if (!buttonEl) return;
  const label = showRulers ? 'Hide rulers' : 'Show rulers';
  buttonEl.title = label;
  buttonEl.setAttribute('aria-label', label);
  buttonEl.dataset.rulersVisible = showRulers ? 'true' : 'false';
}
