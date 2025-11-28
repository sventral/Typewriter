const CDN_PRIMARY = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
const CDN_FALLBACK = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
let loaderPromise = null;

function loadFromScript(src) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('PDF export is only available in the browser.'));
      return;
    }
    const existing = document.querySelector(`script[data-pdf-lib="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.PDFLib), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load PDF library')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.pdfLib = src;
    script.onload = () => {
      if (window?.PDFLib) {
        resolve(window.PDFLib);
      } else {
        reject(new Error('PDF library unavailable after load'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load PDF library'));
    document.head.appendChild(script);
  });
}

export function loadPdfLib() {
  if (typeof window !== 'undefined' && window.PDFLib) {
    return Promise.resolve(window.PDFLib);
  }
  if (loaderPromise) return loaderPromise;
  loaderPromise = loadFromScript(CDN_PRIMARY).catch(() => loadFromScript(CDN_FALLBACK));
  return loaderPromise;
}
