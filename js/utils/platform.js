// Lightweight runtime platform helpers. Keep user-agent parsing scoped
// so other modules can stay framework-agnostic.

export function isSafari() {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
  const ua = navigator.userAgent;
  const isAppleWebKit = /AppleWebKit/i.test(ua);
  const isChromium = /(Chrome|CriOS|Edg|OPR)/i.test(ua);
  const isFirefoxiOS = /FxiOS/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  return isAppleWebKit && !isChromium && !isFirefoxiOS && !isAndroid && /Safari/i.test(ua);
}

