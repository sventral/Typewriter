const GUIDE_EMBED_URL = 'guide.html?embed=1';
const GUIDE_TRIGGER_SELECTOR = '[data-open-guide]';
const GUIDE_CLOSE_MESSAGE = 'typomatique-guide-close';
const GUIDE_OPEN_EVENT = 'typomatique:guide-open';

export function setupGuideOverlay() {
  const host = document.getElementById('guideModalHost');
  const frame = document.getElementById('guideModalFrame');
  if (!host || !frame) return;

  const openGuide = () => {
    host.hidden = false;
    host.setAttribute('aria-hidden', 'false');
    document.body.classList.add('guide-open');
    if (frame.src !== GUIDE_EMBED_URL) frame.src = GUIDE_EMBED_URL;
  };

  const closeGuide = () => {
    if (host.hidden) return;
    host.hidden = true;
    host.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('guide-open');
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest(GUIDE_TRIGGER_SELECTOR)
      : null;
    if (!target) return;
    event.preventDefault();
    openGuide();
  });

  window.addEventListener(GUIDE_OPEN_EVENT, () => {
    openGuide();
  });

  window.addEventListener('message', (event) => {
    if (event?.data?.type === GUIDE_CLOSE_MESSAGE) {
      closeGuide();
    }
  });
}
