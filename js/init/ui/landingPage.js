const LANDING_CLOSE_MS = 220;
const LIGHTBOX_FADE_MS = 180;
const PREVIEW_MIN_SCALE = 1.25;
const PREVIEW_MAX_SCALE = 6.2;
const PREVIEW_RANDOM_MIN_SCALE = 4.3;
const PREVIEW_RANDOM_MAX_SCALE = 5.9;
const LIGHTBOX_MIN_SCALE = 1;
const LIGHTBOX_MAX_SCALE = 7;
const LIGHTBOX_EXTRA_SCALE = 0.55;
const DRAG_CLICK_THRESHOLD_PX = 4;
const WHEEL_CLICK_SUPPRESS_MS = 220;
const LANDING_FOOTER_COLLISION_GAP_PX = 16;

function isLandingOpen() {
  return Boolean(document.body && document.body.classList.contains('landing-open'));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parsePixelValue(rawValue, fallback = 0) {
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readViewerMetrics(viewer, scale = viewer.scale) {
  const viewportRect = viewer.viewport.getBoundingClientRect();
  const viewportWidth = viewportRect.width;
  const viewportHeight = viewportRect.height;
  const naturalWidth = viewer.image.naturalWidth || viewer.image.width || 1;
  const naturalHeight = viewer.image.naturalHeight || viewer.image.height || 1;

  if (viewportWidth <= 0 || viewportHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
    return {
      viewportWidth: 0,
      viewportHeight: 0,
      panLimitX: 0,
      panLimitY: 0,
    };
  }

  const fitScale = Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
  const renderWidth = naturalWidth * fitScale * scale;
  const renderHeight = naturalHeight * fitScale * scale;

  return {
    viewportWidth,
    viewportHeight,
    panLimitX: Math.max(0, (renderWidth - viewportWidth) / 2),
    panLimitY: Math.max(0, (renderHeight - viewportHeight) / 2),
  };
}

function clampViewerPan(viewer) {
  const metrics = readViewerMetrics(viewer);
  viewer.panX = clamp(viewer.panX, -metrics.panLimitX, metrics.panLimitX);
  viewer.panY = clamp(viewer.panY, -metrics.panLimitY, metrics.panLimitY);
}

function applyViewerTransform(viewer) {
  clampViewerPan(viewer);
  viewer.viewport.style.setProperty('--landing-scale', viewer.scale.toFixed(4));
  viewer.viewport.style.setProperty('--landing-pan-x', `${viewer.panX.toFixed(2)}px`);
  viewer.viewport.style.setProperty('--landing-pan-y', `${viewer.panY.toFixed(2)}px`);
}

function scaleViewerAtPoint(viewer, nextScale, clientX, clientY) {
  const clampedScale = clamp(nextScale, viewer.minScale, viewer.maxScale);
  if (clampedScale === viewer.scale) return;

  const rect = viewer.viewport.getBoundingClientRect();
  const localX = clientX - rect.left - (rect.width / 2);
  const localY = clientY - rect.top - (rect.height / 2);
  const ratio = clampedScale / viewer.scale;

  viewer.panX = ((viewer.panX - localX) * ratio) + localX;
  viewer.panY = ((viewer.panY - localY) * ratio) + localY;
  viewer.scale = clampedScale;
  applyViewerTransform(viewer);
}

function randomizePreviewView(viewer) {
  viewer.scale = PREVIEW_RANDOM_MIN_SCALE + (Math.random() * (PREVIEW_RANDOM_MAX_SCALE - PREVIEW_RANDOM_MIN_SCALE));
  const metrics = readViewerMetrics(viewer);
  viewer.panX = (Math.random() * 2 - 1) * metrics.panLimitX;
  viewer.panY = (Math.random() * 2 - 1) * metrics.panLimitY;
  applyViewerTransform(viewer);
}

function copyPreviewViewToLightbox(previewViewer, lightboxViewer) {
  const previewMetrics = readViewerMetrics(previewViewer);
  const normPanX = previewMetrics.panLimitX > 0 ? (previewViewer.panX / previewMetrics.panLimitX) : 0;
  const normPanY = previewMetrics.panLimitY > 0 ? (previewViewer.panY / previewMetrics.panLimitY) : 0;

  lightboxViewer.scale = clamp(previewViewer.scale + LIGHTBOX_EXTRA_SCALE, lightboxViewer.minScale, lightboxViewer.maxScale);
  const lightboxMetrics = readViewerMetrics(lightboxViewer);
  lightboxViewer.panX = normPanX * lightboxMetrics.panLimitX;
  lightboxViewer.panY = normPanY * lightboxMetrics.panLimitY;
  applyViewerTransform(lightboxViewer);
}

function beginViewerDrag(viewer, event) {
  if (event.button !== 0) return;
  viewer.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: viewer.panX,
    originY: viewer.panY,
    moved: false,
  };
  viewer.viewport.classList.add('is-dragging');
  try { viewer.viewport.setPointerCapture(event.pointerId); } catch {}
  event.preventDefault();
}

function moveViewerDrag(viewer, event) {
  if (!viewer.drag || event.pointerId !== viewer.drag.pointerId) return false;

  const deltaX = event.clientX - viewer.drag.startX;
  const deltaY = event.clientY - viewer.drag.startY;
  if (!viewer.drag.moved && Math.hypot(deltaX, deltaY) >= DRAG_CLICK_THRESHOLD_PX) {
    viewer.drag.moved = true;
  }

  if (viewer.drag.moved) {
    viewer.panX = viewer.drag.originX + deltaX;
    viewer.panY = viewer.drag.originY + deltaY;
    applyViewerTransform(viewer);
  }

  return viewer.drag.moved;
}

function endViewerDrag(viewer, event) {
  if (!viewer.drag || event.pointerId !== viewer.drag.pointerId) return false;
  const moved = viewer.drag.moved;
  try { viewer.viewport.releasePointerCapture(event.pointerId); } catch {}
  viewer.drag = null;
  viewer.viewport.classList.remove('is-dragging');
  return moved;
}

function zoomFromWheel(viewer, event) {
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.12 : 0.89;
  const nextScale = viewer.scale * factor;
  scaleViewerAtPoint(viewer, nextScale, event.clientX, event.clientY);
}

export function setupLandingPage({ app } = {}) {
  const landingPage = document.getElementById('landingPage');
  const landingShell = landingPage?.querySelector('.landing-page__shell');
  const landingHero = landingPage?.querySelector('.landing-hero');
  const landingFooter = landingPage?.querySelector('.landing-footer');
  const openBtn = document.getElementById('landingOpenBtn');
  const guideBtn = document.getElementById('landingGuideBtn');
  const previewBtn = document.getElementById('landingPreviewBtn');
  const previewImage = document.getElementById('landingPreviewImage');
  const lightbox = document.getElementById('landingLightbox');
  const lightboxBackdrop = document.getElementById('landingLightboxBackdrop');
  const lightboxCloseBtn = document.getElementById('landingLightboxCloseBtn');
  const lightboxViewport = document.getElementById('landingLightboxViewport');
  const lightboxImage = document.getElementById('landingLightboxImage');

  if (
    !landingPage
    || !landingShell
    || !landingHero
    || !landingFooter
    || !openBtn
    || !previewBtn
    || !previewImage
    || !lightbox
    || !lightboxViewport
    || !lightboxImage
  ) {
    return;
  }

  const stage = app?.stage || document.getElementById('stage');
  let previewReady = false;
  let suppressPreviewClickUntil = 0;

  const previewViewer = {
    viewport: previewBtn,
    image: previewImage,
    minScale: PREVIEW_MIN_SCALE,
    maxScale: PREVIEW_MAX_SCALE,
    scale: PREVIEW_RANDOM_MIN_SCALE,
    panX: 0,
    panY: 0,
    drag: null,
  };

  const lightboxViewer = {
    viewport: lightboxViewport,
    image: lightboxImage,
    minScale: LIGHTBOX_MIN_SCALE,
    maxScale: LIGHTBOX_MAX_SCALE,
    scale: LIGHTBOX_MIN_SCALE,
    panX: 0,
    panY: 0,
    drag: null,
  };

  const isLightboxOpen = () => Boolean(!lightbox.hidden && lightbox.classList.contains('is-open'));

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
    lightbox.hidden = false;
    lightbox.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => {
      lightbox.classList.add('is-open');
      copyPreviewViewToLightbox(previewViewer, lightboxViewer);
      lightboxCloseBtn?.focus();
    });
  };

  const closeLightbox = () => {
    if (lightbox.hidden) return;
    lightboxViewer.drag = null;
    lightboxViewport.classList.remove('is-dragging');
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => {
      if (!lightbox.classList.contains('is-open')) lightbox.hidden = true;
    }, LIGHTBOX_FADE_MS);
  };

  const updateLandingFooterPlacement = () => {
    if (landingPage.hidden || landingPage.scrollTop > 0) {
      landingShell.classList.remove('is-footer-docked');
      landingShell.style.removeProperty('--landing-footer-height');
      return;
    }

    landingShell.classList.remove('is-footer-docked');
    landingShell.style.removeProperty('--landing-footer-height');

    const footerRect = landingFooter.getBoundingClientRect();
    const heroRect = landingHero.getBoundingClientRect();
    const shellRect = landingShell.getBoundingClientRect();
    if (footerRect.height <= 0 || shellRect.height <= 0) return;

    const shellStyles = window.getComputedStyle(landingShell);
    const pageStyles = window.getComputedStyle(landingPage);
    const footerBottomGap = parsePixelValue(shellStyles.getPropertyValue('--landing-footer-bottom-gap'), 12);
    const pagePaddingBottom = parsePixelValue(pageStyles.paddingBottom, 0);
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight || shellRect.bottom;

    const desiredFooterTop = viewportBottom - pagePaddingBottom - footerBottomGap - footerRect.height;
    const maxFooterTop = shellRect.bottom - footerBottomGap - footerRect.height;
    const dockedFooterTop = Math.min(desiredFooterTop, maxFooterTop);
    const minAllowedFooterTop = heroRect.bottom + LANDING_FOOTER_COLLISION_GAP_PX;
    const canDockFooter = dockedFooterTop >= minAllowedFooterTop;

    if (!canDockFooter) return;
    landingShell.style.setProperty('--landing-footer-height', `${footerRect.height.toFixed(2)}px`);
    landingShell.classList.add('is-footer-docked');
  };

  const ensurePreviewView = () => {
    const metrics = readViewerMetrics(previewViewer);
    if (metrics.viewportWidth <= 0 || metrics.viewportHeight <= 0) {
      updateLandingFooterPlacement();
      return;
    }
    if (!previewReady) {
      randomizePreviewView(previewViewer);
      previewReady = true;
    } else {
      applyViewerTransform(previewViewer);
    }
    updateLandingFooterPlacement();
  };

  openBtn.addEventListener('click', closeLanding);

  if (guideBtn) {
    guideBtn.addEventListener('click', (event) => {
      event.preventDefault();
    });
  }

  previewBtn.addEventListener('click', (event) => {
    if (performance.now() < suppressPreviewClickUntil) {
      event.preventDefault();
      return;
    }
    openLightbox();
  });

  previewBtn.addEventListener('wheel', (event) => {
    zoomFromWheel(previewViewer, event);
    suppressPreviewClickUntil = performance.now() + WHEEL_CLICK_SUPPRESS_MS;
  }, { passive: false });

  previewBtn.addEventListener('pointerdown', (event) => {
    beginViewerDrag(previewViewer, event);
  });
  previewBtn.addEventListener('pointermove', (event) => {
    moveViewerDrag(previewViewer, event);
  });
  previewBtn.addEventListener('pointerup', (event) => {
    const moved = endViewerDrag(previewViewer, event);
    if (moved) suppressPreviewClickUntil = performance.now() + WHEEL_CLICK_SUPPRESS_MS;
  });
  previewBtn.addEventListener('pointercancel', (event) => {
    const moved = endViewerDrag(previewViewer, event);
    if (moved) suppressPreviewClickUntil = performance.now() + WHEEL_CLICK_SUPPRESS_MS;
  });

  lightboxBackdrop?.addEventListener('click', closeLightbox);
  lightboxCloseBtn?.addEventListener('click', closeLightbox);

  lightboxViewport.addEventListener('wheel', (event) => {
    if (!isLightboxOpen()) return;
    zoomFromWheel(lightboxViewer, event);
  }, { passive: false });

  lightboxViewport.addEventListener('pointerdown', (event) => {
    if (!isLightboxOpen()) return;
    beginViewerDrag(lightboxViewer, event);
  });
  lightboxViewport.addEventListener('pointermove', (event) => {
    if (!isLightboxOpen()) return;
    moveViewerDrag(lightboxViewer, event);
  });
  lightboxViewport.addEventListener('pointerup', (event) => {
    endViewerDrag(lightboxViewer, event);
  });
  lightboxViewport.addEventListener('pointercancel', (event) => {
    endViewerDrag(lightboxViewer, event);
  });

  previewImage.addEventListener('load', ensurePreviewView);
  lightboxImage.addEventListener('load', () => {
    if (isLightboxOpen()) applyViewerTransform(lightboxViewer);
  });

  window.addEventListener('keydown', (event) => {
    if (!isLightboxOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLightbox();
    }
  });

  window.addEventListener('resize', () => {
    ensurePreviewView();
    if (isLightboxOpen()) applyViewerTransform(lightboxViewer);
  }, { passive: true });
  landingPage.addEventListener('scroll', updateLandingFooterPlacement, { passive: true });
  window.addEventListener('load', updateLandingFooterPlacement, { once: true });

  window.requestAnimationFrame(() => {
    ensurePreviewView();
  });
}
