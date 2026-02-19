const LANDING_CLOSE_MS = 220;
const LIGHTBOX_FADE_MS = 180;
const LIGHTBOX_MIN_SCALE = 1;
const LIGHTBOX_INITIAL_SCALE = 1.9;
const LIGHTBOX_MAX_SCALE = 4.6;

function isLandingOpen() {
  return Boolean(document.body && document.body.classList.contains('landing-open'));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setRandomPreviewFocus(previewEl) {
  if (!previewEl) return;
  const focusX = 15 + (Math.random() * 70);
  const focusY = 14 + (Math.random() * 72);
  const zoom = 2.55 + (Math.random() * 1.35);
  previewEl.style.setProperty('--landing-preview-focus-x', `${focusX.toFixed(2)}%`);
  previewEl.style.setProperty('--landing-preview-focus-y', `${focusY.toFixed(2)}%`);
  previewEl.style.setProperty('--landing-preview-scale', zoom.toFixed(2));
}

export function setupLandingPage({ app } = {}) {
  const landingPage = document.getElementById('landingPage');
  const openBtn = document.getElementById('landingOpenBtn');
  const guideBtn = document.getElementById('landingGuideBtn');
  const previewBtn = document.getElementById('landingPreviewBtn');
  const lightbox = document.getElementById('landingLightbox');
  const lightboxBackdrop = document.getElementById('landingLightboxBackdrop');
  const lightboxCloseBtn = document.getElementById('landingLightboxCloseBtn');
  const lightboxViewport = document.getElementById('landingLightboxViewport');
  const lightboxImage = document.getElementById('landingLightboxImage');

  if (!landingPage || !openBtn) return;

  const stage = app?.stage || document.getElementById('stage');
  setRandomPreviewFocus(previewBtn);

  let viewerScale = LIGHTBOX_INITIAL_SCALE;
  let viewerPanX = 0;
  let viewerPanY = 0;
  let dragState = null;

  const isLightboxOpen = () => Boolean(lightbox && !lightbox.hidden && lightbox.classList.contains('is-open'));

  const clampPanToViewport = () => {
    if (!lightboxViewport || !lightboxImage) return;

    const viewportRect = lightboxViewport.getBoundingClientRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) {
      viewerPanX = 0;
      viewerPanY = 0;
      return;
    }

    const naturalWidth = lightboxImage.naturalWidth || lightboxImage.width || 1;
    const naturalHeight = lightboxImage.naturalHeight || lightboxImage.height || 1;
    const fitScale = Math.min(viewportRect.width / naturalWidth, viewportRect.height / naturalHeight);
    const renderWidth = naturalWidth * fitScale * viewerScale;
    const renderHeight = naturalHeight * fitScale * viewerScale;

    const maxPanX = Math.max(0, (renderWidth - viewportRect.width) / 2);
    const maxPanY = Math.max(0, (renderHeight - viewportRect.height) / 2);

    viewerPanX = clamp(viewerPanX, -maxPanX, maxPanX);
    viewerPanY = clamp(viewerPanY, -maxPanY, maxPanY);
  };

  const applyViewerTransform = () => {
    if (!lightboxViewport) return;
    clampPanToViewport();
    lightboxViewport.style.setProperty('--landing-scale', viewerScale.toFixed(4));
    lightboxViewport.style.setProperty('--landing-pan-x', `${viewerPanX.toFixed(2)}px`);
    lightboxViewport.style.setProperty('--landing-pan-y', `${viewerPanY.toFixed(2)}px`);
  };

  const resetViewer = () => {
    viewerScale = LIGHTBOX_INITIAL_SCALE;
    viewerPanX = 0;
    viewerPanY = 0;
    applyViewerTransform();
  };

  const closeLanding = () => {
    if (!isLandingOpen()) return;

    landingPage.classList.add('is-closing');
    document.body.classList.remove('landing-open');

    window.setTimeout(() => {
      landingPage.hidden = true;
      landingPage.setAttribute('aria-hidden', 'true');
      landingPage.classList.remove('is-closing');
      if (stage && typeof stage.focus === 'function') stage.focus();
    }, LANDING_CLOSE_MS);
  };

  const openLightbox = () => {
    if (!lightbox) return;
    lightbox.hidden = false;
    lightbox.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => {
      lightbox.classList.add('is-open');
      resetViewer();
    });
  };

  const closeLightbox = () => {
    if (!lightbox || lightbox.hidden) return;
    dragState = null;
    lightboxViewport?.classList.remove('is-dragging');
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      if (!lightbox.classList.contains('is-open')) {
        lightbox.hidden = true;
      }
    }, LIGHTBOX_FADE_MS);
  };

  const beginDrag = (event) => {
    if (!isLightboxOpen() || !lightboxViewport) return;
    if (event.button !== 0) return;
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewerPanX,
      originY: viewerPanY,
    };
    lightboxViewport.classList.add('is-dragging');
    try { lightboxViewport.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  };

  const drag = (event) => {
    if (!dragState || !isLightboxOpen()) return;
    if (event.pointerId !== dragState.pointerId) return;

    viewerPanX = dragState.originX + (event.clientX - dragState.startX);
    viewerPanY = dragState.originY + (event.clientY - dragState.startY);
    applyViewerTransform();
  };

  const endDrag = (event) => {
    if (!dragState || !lightboxViewport) return;
    if (event.pointerId !== dragState.pointerId) return;
    try { lightboxViewport.releasePointerCapture(event.pointerId); } catch {}
    dragState = null;
    lightboxViewport.classList.remove('is-dragging');
  };

  const handleWheelZoom = (event) => {
    if (!isLightboxOpen() || !lightboxViewport) return;

    event.preventDefault();
    const deltaFactor = event.deltaY < 0 ? 1.12 : 0.89;
    const nextScale = clamp(viewerScale * deltaFactor, LIGHTBOX_MIN_SCALE, LIGHTBOX_MAX_SCALE);
    if (nextScale === viewerScale) return;

    const viewportRect = lightboxViewport.getBoundingClientRect();
    const localX = event.clientX - viewportRect.left - (viewportRect.width / 2);
    const localY = event.clientY - viewportRect.top - (viewportRect.height / 2);
    const ratio = nextScale / viewerScale;

    viewerPanX = ((viewerPanX - localX) * ratio) + localX;
    viewerPanY = ((viewerPanY - localY) * ratio) + localY;
    viewerScale = nextScale;
    applyViewerTransform();
  };

  openBtn.addEventListener('click', closeLanding);

  if (guideBtn) {
    guideBtn.addEventListener('click', (event) => {
      event.preventDefault();
    });
  }

  previewBtn?.addEventListener('click', () => {
    openLightbox();
  });

  lightboxCloseBtn?.addEventListener('click', () => {
    closeLightbox();
  });

  lightboxBackdrop?.addEventListener('click', () => {
    closeLightbox();
  });

  lightboxViewport?.addEventListener('pointerdown', beginDrag);
  lightboxViewport?.addEventListener('pointermove', drag);
  lightboxViewport?.addEventListener('pointerup', endDrag);
  lightboxViewport?.addEventListener('pointercancel', endDrag);
  lightboxViewport?.addEventListener('wheel', handleWheelZoom, { passive: false });

  lightboxImage?.addEventListener('load', () => {
    if (isLightboxOpen()) applyViewerTransform();
  });

  window.addEventListener('keydown', (event) => {
    if (!isLightboxOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLightbox();
    }
  });

  window.addEventListener('resize', () => {
    if (isLightboxOpen()) applyViewerTransform();
  }, { passive: true });
}
