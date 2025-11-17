const DEFAULT_INK = 'b';
const GLYPH_INKS = new Set(['b', 'r', 'w']);
const SALT_INCREMENT = 0x9E3779B1;
let fallbackSaltState = (Date.now() >>> 0) ^ 0xA511E9;

function normalizeGlyphChar(ch) {
  if (typeof ch === 'string') return ch;
  if (ch == null) return '';
  return String(ch);
}

function normalizeGlyphInk(ink) {
  if (typeof ink !== 'string') return DEFAULT_INK;
  const trimmed = ink.trim();
  if (GLYPH_INKS.has(trimmed)) return trimmed;
  return DEFAULT_INK;
}

export function normalizeGlyphJitterSalt(value) {
  if (!Number.isFinite(value)) return undefined;
  return (value >>> 0);
}

function randomUint32() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    if (arr[0]) return arr[0] >>> 0;
  }
  fallbackSaltState = (fallbackSaltState + SALT_INCREMENT) >>> 0;
  const rand = Math.floor(Math.random() * 0x100000000) >>> 0;
  return rand ^ fallbackSaltState ^ (Date.now() >>> 0);
}

export function generateGlyphJitterSalt() {
  const salt = randomUint32();
  return salt || 0xA511E9;
}

export function createGlyphEntry(char, ink, jitterSalt) {
  const normalizedSalt = normalizeGlyphJitterSalt(jitterSalt);
  return {
    char: normalizeGlyphChar(char),
    ink: normalizeGlyphInk(ink),
    jitterSalt: normalizedSalt !== undefined ? normalizedSalt : generateGlyphJitterSalt(),
  };
}

export function cloneGlyphEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return {
      char: '',
      ink: DEFAULT_INK,
      jitterSalt: undefined,
    };
  }
  return {
    char: normalizeGlyphChar(entry.char),
    ink: normalizeGlyphInk(entry.ink),
    jitterSalt: normalizeGlyphJitterSalt(entry.jitterSalt),
  };
}

export function hydrateGlyphEntry(char, ink, jitterSalt) {
  return {
    char: normalizeGlyphChar(char),
    ink: normalizeGlyphInk(ink),
    jitterSalt: normalizeGlyphJitterSalt(jitterSalt),
  };
}

export function serializeGlyphEntry(entry) {
  const payload = {
    ch: normalizeGlyphChar(entry?.char),
    ink: normalizeGlyphInk(entry?.ink),
  };
  const salt = normalizeGlyphJitterSalt(entry?.jitterSalt);
  if (salt !== undefined) {
    payload.salt = salt;
  }
  return payload;
}
