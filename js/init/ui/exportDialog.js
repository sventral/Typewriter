export function createExportDialog({ app, onExportRaw, onExportPlain }) {
  const state = { open: false };

  const hasDialog = () => !!app.exportDialog;

  function setVisibility(isOpen) {
    state.open = isOpen;
    if (!hasDialog()) return;
    app.exportDialog.classList.toggle('open', isOpen);
    app.exportDialog.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    app.exportDialogScrim?.classList.toggle('open', isOpen);
  }

  function focusDefault() {
    const target = app.exportRawBtn || app.exportPlainBtn || app.exportDialogCloseBtn;
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
  }

  function open() {
    if (!hasDialog()) {
      onExportPlain?.();
      return;
    }
    setVisibility(true);
    focusDefault();
  }

  function close() {
    if (!state.open) return;
    setVisibility(false);
    if (app.exportBtn && typeof app.exportBtn.focus === 'function') {
      app.exportBtn.focus();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && state.open) {
      e.preventDefault();
      close();
    }
  }

  function bind() {
    if (hasDialog()) {
      app.exportDialog.addEventListener('pointerdown', (e) => e.stopPropagation());
      app.exportDialogScrim?.addEventListener('click', close);
      app.exportDialogCloseBtn?.addEventListener('click', close);
      app.exportRawBtn?.addEventListener('click', () => {
        onExportRaw?.();
        close();
      });
      app.exportPlainBtn?.addEventListener('click', () => {
        onExportPlain?.();
        close();
      });
    }
    document.addEventListener('keydown', handleKeydown);
  }

  return { open, close, bind, isOpen: () => state.open };
}
