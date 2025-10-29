export function sanitizeIntegerField(el, options = {}) {
  if (!el) return null;
  const {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    allowEmpty = true,
    fallbackValue = null,
  } = options;
  const raw = el.value ?? '';
  const digits = raw.replace(/\D+/g, '');
  if (!digits) {
    if (!allowEmpty) {
      let fallback = Number.isFinite(fallbackValue) ? fallbackValue : (Number.isFinite(min) ? min : 0);
      if (Number.isFinite(min)) fallback = Math.max(min, fallback);
      if (Number.isFinite(max)) fallback = Math.min(max, fallback);
      el.value = String(fallback);
      return fallback;
    }
    el.value = '';
    return null;
  }
  let n = parseInt(digits, 10);
  if (Number.isFinite(min)) n = Math.max(min, n);
  if (Number.isFinite(max)) n = Math.min(max, n);
  el.value = String(n);
  return n;
}
