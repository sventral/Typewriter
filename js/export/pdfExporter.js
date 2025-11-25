import { loadPdfLib } from './pdfLibLoader.js';
import { getPaperSize, normalizePaperSizeId, DEFAULT_PAPER_SIZE } from '../config/paperSizes.js';

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function canvasToBlob(canvas) {
  if (!canvas) return Promise.reject(new Error('No canvas to export'));
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode canvas'));
      }, 'image/png');
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const bin = atob(dataUrl.split(',')[1]);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      resolve(new Blob([bytes], { type: 'image/png' }));
    } catch (err) {
      reject(err);
    }
  });
}

async function waitForFullPaint(page, schedulePaint) {
  if (!page) return false;
  page.dirtyAll = true;
  page._dirtyRowMinMu = page._dirtyRowMaxMu = undefined;
  if (page._dirtyRows) page._dirtyRows.clear();
  schedulePaint?.(page);
  const start = performance.now();
  while (true) {
    await nextFrame();
    const hasDirtyRows = page._dirtyRowMinMu !== undefined || page._dirtyRowMaxMu !== undefined;
    const busy = page.dirtyAll || page.fullPaintInProgress || page.raf || hasDirtyRows;
    if (!busy) return true;
    if (performance.now() - start > 1500) return false;
  }
}

async function capturePageCanvas(page, { app, schedulePaint, setPageActive }) {
  if (!page) return null;
  const wasActive = page.active;
  if (!wasActive) {
    setPageActive?.(page, true);
  }
  await waitForFullPaint(page, schedulePaint);
  const srcCanvas = page.backCanvas || page.canvas;
  if (!srcCanvas) {
    if (!wasActive) setPageActive?.(page, false);
    return null;
  }
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = srcCanvas.width;
  exportCanvas.height = srcCanvas.height;
  const ctx = exportCanvas.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
  if (!wasActive) {
    setPageActive?.(page, false);
  }
  return exportCanvas;
}

function resolvePdfPageSize(state) {
  const paper = getPaperSize(normalizePaperSizeId(state?.paperSize || DEFAULT_PAPER_SIZE));
  const widthPts = (paper.widthIn || 8.27) * 72;
  const heightPts = (paper.heightIn || 11.69) * 72;
  return { widthPts, heightPts };
}

export async function exportDocumentAsPdf({
  app,
  state,
  buildExportFileName,
  downloadBlob,
  schedulePaint,
  setPageActive,
  requestVirtualization,
}) {
  if (!state?.pages || !state.pages.length) {
    throw new Error('No pages to export');
  }
  const { PDFDocument } = await loadPdfLib();
  const pdfDoc = await PDFDocument.create();
  const { widthPts, heightPts } = resolvePdfPageSize(state);

  try {
    for (let i = 0; i < state.pages.length; i++) {
      const page = state.pages[i];
      const canvas = await capturePageCanvas(page, { app, schedulePaint, setPageActive });
      if (!canvas) continue;
      const blob = await canvasToBlob(canvas);
      const imgBytes = await blob.arrayBuffer();
    const pngImage = await pdfDoc.embedPng(imgBytes);
    const pageWidth = widthPts;
    const pageHeight = heightPts;
    const scale = Math.min(pageWidth / pngImage.width, pageHeight / pngImage.height);
    const drawWidth = pngImage.width * scale;
    const drawHeight = pngImage.height * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    const pdfPage = pdfDoc.addPage([pageWidth, pageHeight]);
    pdfPage.drawImage(pngImage, { x, y, width: drawWidth, height: drawHeight });
  }

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    downloadBlob(pdfBlob, buildExportFileName({ suffix: 'pages', ext: 'pdf' }));
  } finally {
    requestVirtualization?.();
  }
}
