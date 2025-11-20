function getEffectiveTheme() {
  const root = document.documentElement;
  const explicit = root?.getAttribute('data-theme');
  if (explicit === 'dark') return 'dark';
  if (explicit === 'light') return 'light';
  const prefersDark = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

function overlapAreaRatio(a, b) {
  if (!a || !b) return 0;
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return 0;
  const area = (right - left) * (bottom - top);
  const sliderArea = a.width * a.height;
  if (!sliderArea) return 0;
  return area / sliderArea;
}

function collectPageElements(app) {
  const root = app?.stageInner || document;
  if (!root?.querySelectorAll) return [];
  return Array.from(root.querySelectorAll('.page'));
}

export function createZoomSliderContrastManager({ app } = {}) {
  let rafId = 0;
  let mediaListener = null;
  let themeObserver = null;
  let pageToneObserver = null;

  const getSliderEl = () => {
    if (app?.zoomSlider instanceof Element) return app.zoomSlider;
    if (app?.zoomControls instanceof Element) return app.zoomControls;
    return document.getElementById('zoomSlider') || document.getElementById('zoomControls');
  };

  const hasLightPageTone = () => document?.body?.dataset?.pageTone !== 'dark';

  const sliderOverLightPage = () => {
    const slider = getSliderEl();
    if (!slider || !slider.isConnected) return false;
    if (!hasLightPageTone()) return false;
    const sliderRect = slider.getBoundingClientRect();
    if (!sliderRect || sliderRect.width === 0 || sliderRect.height === 0) return false;
    const center = {
      x: sliderRect.left + sliderRect.width / 2,
      y: sliderRect.top + sliderRect.height / 2,
    };
    const pages = collectPageElements(app);
    for (const page of pages) {
      if (!page) continue;
      const rect = page.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) continue;
      const ratio = overlapAreaRatio(sliderRect, rect);
      const centerInside = center.x > rect.left && center.x < rect.right && center.y > rect.top && center.y < rect.bottom;
      // Require center to be over the page and a modest overlap to avoid early toggles.
      if (centerInside && ratio >= 0.1) return true;
    }
    return false;
  };

  const update = () => {
    rafId = 0;
    const slider = getSliderEl();
    if (!slider) return;
    const shouldForceLightScheme = getEffectiveTheme() === 'dark' && sliderOverLightPage();
    slider.classList.toggle('zoom-controls--light-scheme', shouldForceLightScheme);
  };

  const scheduleUpdate = () => {
    if (rafId) return;
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(update);
    } else {
      update();
    }
  };

  const attachListeners = () => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mediaListener = () => scheduleUpdate();
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', mediaListener);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(mediaListener);
      }
    }

    if (typeof MutationObserver === 'function') {
      themeObserver = new MutationObserver(scheduleUpdate);
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      if (document?.body) {
        pageToneObserver = new MutationObserver(scheduleUpdate);
        pageToneObserver.observe(document.body, { attributes: true, attributeFilter: ['data-page-tone'] });
      }
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', scheduleUpdate, { passive: true });
      window.addEventListener('scroll', scheduleUpdate, { passive: true });
    }
  };

  const destroy = () => {
    if (mediaListener && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', mediaListener);
      } else if (typeof mql.removeListener === 'function') {
        mql.removeListener(mediaListener);
      }
    }
    if (themeObserver) {
      themeObserver.disconnect();
      themeObserver = null;
    }
    if (pageToneObserver) {
      pageToneObserver.disconnect();
      pageToneObserver = null;
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate);
    }
  };

  attachListeners();

  return {
    scheduleUpdate,
    forceUpdate: update,
    destroy,
  };
}
