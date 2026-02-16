const LIGHT_FAVICON_URL = 'image/favicon.png?v=50.2';

function prefersDarkScheme() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function isDarkThemeActive() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark') return true;
  if (explicit === 'light') return false;
  return prefersDarkScheme();
}

function getOrCreateFaviconLink() {
  let link = document.getElementById('appFavicon');
  if (link) return link;
  link = document.createElement('link');
  link.id = 'appFavicon';
  link.rel = 'icon';
  link.type = 'image/png';
  link.sizes = '512x512';
  link.href = LIGHT_FAVICON_URL;
  document.head.appendChild(link);
  return link;
}

function forceFaviconRefresh(link) {
  const parent = link.parentNode;
  if (!parent) return;
  parent.removeChild(link);
  parent.appendChild(link);
}

async function createInvertedFaviconDataUrl() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 512;
      canvas.height = img.naturalHeight || img.height || 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(LIGHT_FAVICON_URL);
        return;
      }
      ctx.filter = 'invert(1)';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(LIGHT_FAVICON_URL);
    img.src = LIGHT_FAVICON_URL;
  });
}

export function setupFaviconThemeSync() {
  const link = getOrCreateFaviconLink();
  let darkHref = null;
  let applyToken = 0;

  const applyCurrentTheme = async () => {
    const token = ++applyToken;
    if (!isDarkThemeActive()) {
      if (link.href.endsWith(LIGHT_FAVICON_URL)) return;
      link.href = LIGHT_FAVICON_URL;
      forceFaviconRefresh(link);
      return;
    }
    if (!darkHref) darkHref = await createInvertedFaviconDataUrl();
    if (token !== applyToken) return;
    if (!isDarkThemeActive()) return;
    if (link.href === darkHref) return;
    link.href = darkHref;
    forceFaviconRefresh(link);
  };

  const rootObserver = new MutationObserver(() => {
    applyCurrentTheme();
  });
  rootObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  if (window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const mediaHandler = () => applyCurrentTheme();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', mediaHandler);
    } else if (typeof media.addListener === 'function') {
      media.addListener(mediaHandler);
    }
  }

  applyCurrentTheme();
}
