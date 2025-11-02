import {
  EDGE_BLEED,
  EDGE_FUZZ,
  GRAIN_CFG,
  INK_BLUR,
  INK_INTENSITY,
  INK_TEXTURE,
  normalizeEdgeBleedConfig,
  normalizeInkBlurConfig,
  normalizeInkTextureConfig,
} from './inkConfig.js';

const sanitizedInkTextureDefaults = normalizeInkTextureConfig(INK_TEXTURE);
Object.assign(INK_TEXTURE, sanitizedInkTextureDefaults);

const sanitizedEdgeBleedDefaults = normalizeEdgeBleedConfig(EDGE_BLEED);
Object.assign(EDGE_BLEED, sanitizedEdgeBleedDefaults);

const sanitizedInkBlurDefaults = normalizeInkBlurConfig(INK_BLUR);
Object.assign(INK_BLUR, sanitizedInkBlurDefaults);

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const INPUT_OVERRIDES = {
  'fill.centerThickenPct': {
    type: 'range',
    min: () => CENTER_THICKEN_LIMITS.min,
    max: () => CENTER_THICKEN_LIMITS.max,
    step: 1,
    precision: 0,
  },
  'fill.edgeThinPct': {
    type: 'range',
    min: () => EDGE_THIN_LIMITS.min,
    max: () => EDGE_THIN_LIMITS.max,
    step: 1,
    precision: 0,
  },
  'grain.scale': { type: 'range', min: 0.25, max: 3, step: 0.05, precision: 2 },
  'grain.gamma': { type: 'range', min: 0.2, max: 3, step: 0.05, precision: 2 },
  'grain.opacity': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'grain.blend_mode': {
    type: 'enum-range',
    options: ['destination-out', 'multiply', 'screen', 'overlay', 'soft-light'],
  },
  'blur.radiusPx': { type: 'range', min: 0, max: 6, step: 0.1, precision: 2 },
};

function getInputOverride(sectionId, path) {
  if (!path) return null;
  const key = sectionId ? `${sectionId}.${path}` : path;
  const override = INPUT_OVERRIDES[key];
  if (!override) return null;
  if (typeof override.min === 'function' || typeof override.max === 'function') {
    return {
      ...override,
      min: typeof override.min === 'function' ? override.min() : override.min,
      max: typeof override.max === 'function' ? override.max() : override.max,
    };
  }
  return override;
}

function resolveIntensityConfig(key) {
  const source = INK_INTENSITY && typeof INK_INTENSITY === 'object' ? INK_INTENSITY[key] : null;
  const min = Number.isFinite(source?.minPct) ? source.minPct : 0;
  const max = Number.isFinite(source?.maxPct) ? Math.max(source.maxPct, min) : Math.max(200, min);
  const defaultPct = Number.isFinite(source?.defaultPct) ? source.defaultPct : 100;
  return {
    min,
    max,
    defaultPct: clamp(defaultPct, min, max),
  };
}

const CENTER_THICKEN_LIMITS = resolveIntensityConfig('centerThicken');
const EDGE_THIN_LIMITS = resolveIntensityConfig('edgeThin');

const FILL_CFG = {
  enabled: true,
  centerThickenPct: CENTER_THICKEN_LIMITS.defaultPct,
  edgeThinPct: EDGE_THIN_LIMITS.defaultPct,
};

const SECTION_DEFS = [
  {
    id: 'blur',
    label: 'Blur',
    config: INK_BLUR,
    keyOrder: [
      { path: 'enabled', label: 'Enable blur' },
      { path: 'radiusPx', label: 'Radius (px)' },
    ],
    trigger: 'glyph',
    stateKey: 'inkBlurStrength',
    defaultStrength: INK_BLUR.enabled === false ? 0 : 100,
    autoEnable: false,
  },
];

const DEFAULT_SECTION_ORDER = SECTION_DEFS.map(def => def.id);
function normalizeSectionOrder(order) {
  const normalized = [];
  if (Array.isArray(order)) {
    order.forEach(id => {
      if (typeof id !== 'string') return;
      const trimmed = id.trim();
      if (trimmed === 'blur' && !normalized.includes('blur')) {
        normalized.push('blur');
      }
    });
  }
  if (!normalized.length) {
    normalized.push('blur');
  }
  return normalized;
}

function clampFillPercent(value, limits) {
  const raw = Number(value);
  const min = limits?.min ?? 0;
  const max = limits?.max ?? Math.max(min, 200);
  if (!Number.isFinite(raw)) {
    return clamp(limits?.defaultPct ?? 100, min, max);
  }
  return clamp(Math.round(raw), min, max);
}

function normalizeFillConfig(config, styleFallback = {}) {
  const src = config && typeof config === 'object' ? config : {};
  const fallback = styleFallback && typeof styleFallback === 'object' ? styleFallback : {};
  const centerFallbacks = [
    src.centerThicken,
    src.centerThickenPct,
    fallback.centerThicken,
    fallback.centerThickenPct,
  ];
  const edgeFallbacks = [
    src.edgeThin,
    src.edgeThinPct,
    fallback.edgeThin,
    fallback.edgeThinPct,
  ];
  const resolveValue = (candidates, limits) => {
    for (const candidate of candidates) {
      const num = Number(candidate);
      if (Number.isFinite(num)) {
        return clampFillPercent(num, limits);
      }
    }
    return clampFillPercent(limits.defaultPct, limits);
  };
  const centerThickenPct = resolveValue(centerFallbacks, CENTER_THICKEN_LIMITS);
  const edgeThinPct = resolveValue(edgeFallbacks, EDGE_THIN_LIMITS);
  return {
    enabled: src.enabled === false ? false : true,
    centerThickenPct,
    edgeThinPct,
  };
}

function syncFillConfigValues() {
  FILL_CFG.centerThickenPct = getCenterThickenPercent();
  FILL_CFG.edgeThinPct = getEdgeThinPercent();
  FILL_CFG.enabled = getFillStrengthPercent() > 0;
}

function applyFillConfigToState(config, options = {}) {
  if (!config || typeof config !== 'object') return;
  const { silent = false } = options;
  if (Number.isFinite(Number(config.centerThickenPct))) {
    setCenterThickenPercent(config.centerThickenPct, { silent: true, updateConfig: false });
  }
  if (Number.isFinite(Number(config.edgeThinPct))) {
    setEdgeThinPercent(config.edgeThinPct, { silent: true, updateConfig: false });
  }
  if (!silent) {
    syncFillConfigValues();
    scheduleGlyphRefresh();
    persistPanelState();
  }
}

const panelState = {
  appState: null,
  app: null,
  callbacks: {
    refreshGlyphs: null,
    refreshGrain: null,
  },
  metas: [],
  initialized: false,
  saveState: null,
  overallSlider: null,
  overallNumberInput: null,
  pendingGlyphRAF: 0,
  pendingGrainRAF: 0,
  pendingGlyphOptions: null,
  styleNameInput: null,
  saveStyleButton: null,
  stylesList: null,
  lastLoadedStyleId: null,
  exportButton: null,
  importButton: null,
  importInput: null,
  sectionsRoot: null,
};

const HEX_MATCH_RE = /seed|hash/i;
const STYLE_NAME_MAX_LEN = 60;
const STYLE_EXPORT_VERSION = 2;

function deepCloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => deepCloneValue(item));
  }
  if (value instanceof Set) {
    return Array.from(value, item => deepCloneValue(item));
  }
  if (value instanceof Map) {
    const clone = {};
    for (const [key, val] of value.entries()) {
      clone[key] = deepCloneValue(val);
    }
    return clone;
  }
  if (value && typeof value === 'object') {
    const clone = {};
    for (const [key, val] of Object.entries(value)) {
      clone[key] = deepCloneValue(val);
    }
    return clone;
  }
  return value;
}

function sanitizeStyleName(name) {
  if (typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, STYLE_NAME_MAX_LEN);
}

function ensureUniqueStyleName(name, existingStyles, excludeId = null) {
  const base = sanitizeStyleName(name) || 'Imported style';
  const lowerExisting = new Set(
    (existingStyles || [])
      .filter(style => style && style.id !== excludeId && typeof style.name === 'string')
      .map(style => style.name.toLowerCase())
  );
  if (!lowerExisting.has(base.toLowerCase())) {
    return base;
  }
  let counter = 2;
  let candidate = '';
  do {
    candidate = `${base} (${counter})`;
    counter += 1;
  } while (lowerExisting.has(candidate.toLowerCase()));
  return candidate;
}

function generateStyleId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `style-${ts}-${rand}`;
}

function normalizeStyleRecord(style, index = 0) {
  try {
    const record = {
      id: typeof style?.id === 'string' && style.id.trim() ? style.id.trim() : generateStyleId(),
      name: sanitizeStyleName(style?.name) || `Style ${index + 1}`,
      overall: clamp(Math.round(Number(style?.overall ?? 100)), 0, 100),
      centerThicken: CENTER_THICKEN_LIMITS.defaultPct,
      edgeThin: EDGE_THIN_LIMITS.defaultPct,
      sections: {},
      sectionOrder: normalizeSectionOrder(style?.sectionOrder),
    };
    SECTION_DEFS.forEach(def => {
      const rawSection = style?.sections && typeof style.sections === 'object'
        ? style.sections[def.id]
        : (style && typeof style === 'object' && typeof style[def.id] === 'object' ? style[def.id] : null);
      const section = rawSection && typeof rawSection === 'object' ? rawSection : {};
      if (def.id === 'fill') {
        const legacyFill = style && typeof style.fill === 'object' ? style.fill : null;
        const fillSource = section && Object.keys(section).length ? section : (legacyFill || {});
        const rawStrength = fillSource?.strength ?? style?.fillStrength ?? legacyFill?.value ?? legacyFill?.percent;
        const strength = clamp(Math.round(Number.isFinite(Number(rawStrength)) ? Number(rawStrength) : def.defaultStrength ?? 100), 0, 100);
        const configCandidate = fillSource?.config != null
          ? fillSource.config
          : fillSource?.settings != null
            ? fillSource.settings
            : ('strength' in fillSource ? null : fillSource);
        const normalizedFill = normalizeFillConfig(configCandidate, style);
        normalizedFill.enabled = normalizedFill.enabled && strength > 0;
        record.centerThicken = normalizedFill.centerThickenPct;
        record.edgeThin = normalizedFill.edgeThinPct;
        record.fillStrength = strength;
        record.sections[def.id] = {
          strength,
          config: deepCloneValue(normalizedFill),
        };
        return;
      }
      const strength = clamp(Math.round(Number(section?.strength ?? def.defaultStrength ?? 0)), 0, 100);
      let configSource = section.config != null
        ? section.config
        : section.settings != null
          ? section.settings
          : ('strength' in section ? def.config : section);
      if (def.id === 'texture') {
        configSource = normalizeInkTextureConfig(configSource);
      } else if (def.id === 'bleed') {
        configSource = normalizeEdgeBleedConfig(configSource);
      } else if (def.id === 'blur') {
        configSource = normalizeInkBlurConfig(configSource);
      }
      record.sections[def.id] = {
        strength,
        config: deepCloneValue(configSource == null ? def.config : configSource),
      };
    });
    return record;
  } catch (error) {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('Failed to normalize ink style.', error);
    }
    return null;
  }
}

function createDefaultStyleRecord(index = 0) {
  const record = {
    id: generateStyleId(),
    name: index === 0 ? 'Current style' : `Style ${index + 1}`,
    overall: 100,
    fillStrength: 100,
    centerThicken: CENTER_THICKEN_LIMITS.defaultPct,
    edgeThin: EDGE_THIN_LIMITS.defaultPct,
    sections: {},
    sectionOrder: DEFAULT_SECTION_ORDER.slice(),
  };
  SECTION_DEFS.forEach(def => {
    record.sections[def.id] = {
      strength: def.defaultStrength ?? 0,
      config: deepCloneValue(def.config),
    };
  });
  return record;
}

function getSavedStyles() {
  const appState = getAppState();
  if (!appState) return [];
  if (!Array.isArray(appState.savedInkStyles)) {
    appState.savedInkStyles = [];
  }
  return appState.savedInkStyles;
}

function setSavedStyles(styles) {
  const appState = getAppState();
  if (!appState) return [];
  const normalized = [];
  if (Array.isArray(styles)) {
    styles.forEach((style, index) => {
      const record = normalizeStyleRecord(style, index);
      if (record) normalized.push(record);
    });
  }
  appState.savedInkStyles = normalized;
  return normalized;
}

function createStyleSnapshot(name, existingId = null) {
  const base = {
    id: existingId || generateStyleId(),
    name,
    overall: getPercentFromState('effectsOverallStrength', 100),
    fillStrength: getFillStrengthPercent(),
    centerThicken: getCenterThickenPercent(),
    edgeThin: getEdgeThinPercent(),
    sections: {},
    sectionOrder: DEFAULT_SECTION_ORDER.slice(),
  };
  SECTION_DEFS.forEach(def => {
    const meta = findMetaById(def.id);
    const configSource = meta && meta.config ? meta.config : def.config;
    base.sections[def.id] = {
      strength: getPercentFromState(def.stateKey, def.defaultStrength ?? 0),
      config: deepCloneValue(configSource),
    };
  });
  return normalizeStyleRecord(base);
}

function getCurrentStyleName() {
  const input = panelState.styleNameInput;
  const fromInput = input ? sanitizeStyleName(input.value) : '';
  if (fromInput) return fromInput;
  const styles = getSavedStyles();
  if (panelState.lastLoadedStyleId && Array.isArray(styles)) {
    const match = styles.find(style => style && style.id === panelState.lastLoadedStyleId);
    if (match && match.name) {
      return sanitizeStyleName(match.name);
    }
  }
  return 'Current style';
}

function makeExportFileName(style) {
  const rawName = sanitizeStyleName(style?.name) || 'Ink style';
  const safe = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = safe || 'ink-style';
  return `${base}.ink-style.json`;
}

function buildExportPayload(style) {
  return {
    version: STYLE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    style: normalizeStyleRecord(style || {}) || createDefaultStyleRecord(0),
  };
}

function triggerDownload(text, filename) {
  if (
    typeof document === 'undefined'
    || typeof document.createElement !== 'function'
    || typeof Blob === 'undefined'
    || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function'
  ) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert('Export is not supported in this environment.');
    }
    return;
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportStyleToFile(style) {
  if (!style) return;
  const payload = buildExportPayload(style);
  const text = JSON.stringify(payload, null, 2);
  const filename = makeExportFileName(style);
  triggerDownload(text, filename);
}

function exportCurrentStyle() {
  const snapshot = createStyleSnapshot(getCurrentStyleName());
  if (!snapshot) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert('Could not export the current style.');
    }
    return;
  }
  exportStyleToFile(snapshot);
}

function extractStyleFromPayload(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const extracted = extractStyleFromPayload(item);
      if (extracted) return extracted;
    }
    return null;
  }
  if (typeof payload !== 'object') return null;
  if (payload.style && typeof payload.style === 'object') {
    return payload.style;
  }
  if (payload.data && typeof payload.data === 'object') {
    const nested = extractStyleFromPayload(payload.data);
    if (nested) return nested;
  }
  if (payload.sections && typeof payload.sections === 'object') {
    return payload;
  }
  return null;
}

function normalizeImportedStyle(rawStyle) {
  const existing = getSavedStyles();
  const baseIndex = Array.isArray(existing) ? existing.length : 0;
  let sanitized = normalizeStyleRecord(rawStyle, baseIndex);
  const usedFallback = !sanitized;
  if (!sanitized) {
    sanitized = createDefaultStyleRecord(baseIndex);
  }
  if (existing && existing.some(style => style && style.id === sanitized.id)) {
    sanitized.id = generateStyleId();
  }
  sanitized.name = ensureUniqueStyleName(usedFallback ? 'Imported style' : sanitized.name, existing);
  return sanitized;
}

function notifyImportError() {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('Failed to import ink style: file was not in the expected format.');
  }
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert('Could not import ink style. Please choose a valid file.');
  }
}

function handleImportStyleContent(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    notifyImportError();
    return;
  }
  const rawStyle = extractStyleFromPayload(data);
  if (!rawStyle) {
    notifyImportError();
    return;
  }
  const normalized = normalizeImportedStyle(rawStyle);
  const styles = getSavedStyles();
  const updated = [normalized, ...(Array.isArray(styles) ? styles : [])];
  setSavedStyles(updated);
  persistPanelState();
  renderSavedStylesList({ focusId: normalized.id });
}

function handleImportInputChange(event) {
  const input = event?.target;
  if (!input || !input.files || !input.files.length) return;
  const file = input.files[0];
  const resetInput = () => {
    input.value = '';
  };
  if (typeof FileReader === 'undefined') {
    notifyImportError();
    resetInput();
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try {
      handleImportStyleContent(reader.result);
    } finally {
      resetInput();
    }
  });
  reader.addEventListener('error', () => {
    notifyImportError();
    resetInput();
  });
  reader.readAsText(file);
}

function isHexField(path) {
  return HEX_MATCH_RE.test(path || '');
}

function getAppState() {
  return panelState.appState;
}

function getSectionOrderFromState() {
  const appState = getAppState();
  if (!appState) return DEFAULT_SECTION_ORDER.slice();
  return normalizeSectionOrder(appState.inkSectionOrder);
}

function getPercentFromState(key, fallback = 0) {
  const appState = getAppState();
  if (!appState || !(key in appState)) {
    return clamp(Number.isFinite(fallback) ? fallback : 0, 0, 100);
  }
  const raw = Number(appState[key]);
  return clamp(Number.isFinite(raw) ? raw : (Number.isFinite(fallback) ? fallback : 0), 0, 100);
}

function setPercentOnState(key, value) {
  const appState = getAppState();
  if (!appState) return;
  appState[key] = clamp(Number(value) || 0, 0, 100);
}

function getScalarFromState(key, fallback, min = 0, max = 100) {
  const appState = getAppState();
  if (!appState || !(key in appState)) {
    const safeFallback = Number.isFinite(fallback) ? fallback : min;
    return clamp(safeFallback, min, max);
  }
  const raw = Number(appState[key]);
  return clamp(Number.isFinite(raw) ? raw : (Number.isFinite(fallback) ? fallback : min), min, max);
}

function setScalarOnState(key, value, min = 0, max = 100) {
  const appState = getAppState();
  if (!appState) return;
  const next = Number.isFinite(value) ? value : min;
  appState[key] = clamp(next, min, max);
}

function normalizedPercent(value) {
  return clamp((Number(value) || 0) / 100, 0, 1);
}

function toHex(value) {
  const n = (Number(value) >>> 0);
  let hex = n.toString(16).toUpperCase();
  if (hex.length < 8) hex = hex.padStart(8, '0');
  return `0x${hex}`;
}

function parseHex(value) {
  if (typeof value !== 'string') {
    const num = Number(value) >>> 0;
    return num >>> 0;
  }
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (/^0x/i.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 16);
    return Number.isFinite(parsed) ? (parsed >>> 0) : 0;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? (parsed >>> 0) : 0;
}

function getObjectKeys(path, obj) {
  if (!obj) return [];
  switch (path) {
    case 'coarseNoise':
      return ['scale', 'strength', 'seed'];
    case 'fineNoise': {
      const keys = ['scale', 'strength', 'seed'];
      if (obj && Object.prototype.hasOwnProperty.call(obj, 'hashWeight')) keys.push('hashWeight');
      return keys;
    }
    case 'chip':
      return ['enabled', 'density', 'strength', 'feather', 'seed'];
    case 'scratch':
      return ['enabled', 'direction', 'scale', 'aspect', 'threshold', 'strength', 'seed'];
    case 'scratch.direction':
      return ['x', 'y'];
    case 'alpha':
      return ['max', 'mix_pow', 'low_pow', 'min'];
    case 'seeds':
      return ['octave', 'hash'];
    case 'tile':
      return ['enabled', 'size', 'reuse', 'seed'];
    case 'passes[]':
      return ['width', 'alpha', 'jitter', 'jitterY', 'lighten', 'strokes', 'seed'];
    case 'noiseOctaves[]':
      return ['scale', 'weight', 'seed'];
    default:
      return Object.keys(obj);
  }
}

function formatSliderNumber(value, precision = 2) {
  if (!Number.isFinite(value)) return '';
  let text = value.toFixed(Math.max(0, precision));
  if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '');
  }
  return text;
}

function updateSliderDisplay(input) {
  if (!input || !input._valueDisplay) return;
  if (input.dataset.enumOptions) {
    const options = input.dataset.enumOptions.split('|');
    const raw = Number.parseFloat(input.value);
    const idx = clamp(Number.isFinite(raw) ? Math.round(raw) : 0, 0, Math.max(0, options.length - 1));
    const label = options[idx] || '';
    input.dataset.enumValue = label;
    input._valueDisplay.textContent = label;
    input.setAttribute('aria-valuetext', label);
    return;
  }
  const precision = Number.isFinite(Number.parseInt(input.dataset.precision, 10))
    ? Math.max(0, Number.parseInt(input.dataset.precision, 10))
    : 2;
  const num = Number.parseFloat(input.value);
  const text = Number.isFinite(num) ? formatSliderNumber(num, precision) : (input.value || '');
  input._valueDisplay.textContent = text;
  input.setAttribute('aria-valuetext', text);
}

function buildControlRow(labelText, input) {
  const row = document.createElement('div');
  row.className = 'control-row';
  const label = document.createElement('label');
  label.textContent = labelText;
  row.appendChild(label);
  row.appendChild(input);
  if (input.dataset.slider === '1') {
    const display = document.createElement('span');
    display.className = 'ink-control-value';
    input._valueDisplay = display;
    updateSliderDisplay(input);
    row.appendChild(display);
    input.addEventListener('input', () => updateSliderDisplay(input));
  }
  return row;
}

function createInputForValue(value, path, sectionId) {
  const override = getInputOverride(sectionId, path);
  if (override) {
    if (override.type === 'range') {
      const min = Number.isFinite(override.min) ? override.min : 0;
      const max = Number.isFinite(override.max) ? override.max : Math.max(min, 1);
      const initial = Number.isFinite(value)
        ? clamp(value, min, max)
        : Number.isFinite(override.default)
          ? clamp(override.default, min, max)
          : min;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = Number.isFinite(override.step) ? String(override.step) : '0.01';
      input.value = String(initial);
      input.dataset.slider = '1';
      const precision = Number.isFinite(override.precision) ? Math.max(0, override.precision) : 2;
      input.dataset.precision = String(precision);
      return input;
    }
    if (override.type === 'enum-range') {
      const options = Array.isArray(override.options) && override.options.length
        ? override.options
        : ['destination-out'];
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = String(Math.max(0, options.length - 1));
      input.step = '1';
      let idx = 0;
      if (typeof value === 'string') {
        idx = options.indexOf(value);
      } else if (Number.isFinite(value)) {
        idx = Math.round(value);
      }
      idx = clamp(Number.isFinite(idx) ? idx : 0, 0, Math.max(0, options.length - 1));
      input.value = String(idx);
      input.dataset.enumOptions = options.join('|');
      input.dataset.slider = '1';
      input.dataset.precision = '0';
      input.dataset.enumValue = options[idx] || '';
      return input;
    }
  }
  if (typeof value === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!value;
    return input;
  }
  if (typeof value === 'number') {
    if (isHexField(path)) {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = toHex(value);
      input.classList.add('ink-seed-input');
      input.dataset.hex = '1';
      return input;
    }
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.value = String(value);
    return input;
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value == null ? '' : String(value);
  return input;
}

function parseInputValue(input, path) {
  if (!input) return null;
  if (input.dataset.enumOptions) {
    const options = input.dataset.enumOptions.split('|');
    const raw = Number.parseFloat(input.value);
    const idx = clamp(Number.isFinite(raw) ? Math.round(raw) : 0, 0, Math.max(0, options.length - 1));
    const choice = options[idx] || '';
    input.dataset.enumValue = choice;
    if (input._valueDisplay) {
      input._valueDisplay.textContent = choice;
    }
    return choice;
  }
  if (input.type === 'checkbox') return !!input.checked;
  if (input.dataset.hex === '1') return parseHex(input.value);
  if (input.type === 'number' || input.type === 'range') {
    const num = Number.parseFloat(input.value);
    return Number.isFinite(num) ? num : 0;
  }
  return input.value;
}

function attachFillRealtimeHandler(meta, path, input) {
  if (!meta || meta.id !== 'fill') return false;
  if (!input || (path !== 'centerThickenPct' && path !== 'edgeThinPct')) return false;
  const setter = path === 'centerThickenPct' ? setCenterThickenPercent : setEdgeThinPercent;
  const handleRealtimeUpdate = () => {
    const value = parseInputValue(input, path);
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const pct = setter(numeric);
    if (Number.isFinite(pct) && input.value !== String(pct)) {
      input.value = String(pct);
      if (input.dataset.slider === '1') {
        updateSliderDisplay(input);
      }
    }
  };
  input.addEventListener('input', handleRealtimeUpdate);
  input.addEventListener('change', handleRealtimeUpdate);
  return true;
}

function registerMetaInput(meta, path, input) {
  if (!meta || !path || !input) return;
  meta.inputs.set(path, input);
  if (attachFillRealtimeHandler(meta, path, input)) {
    return;
  }
  const applyCurrentSection = () => applySection(meta);
  if (input.type === 'range') {
    input.addEventListener('input', applyCurrentSection);
  }
  input.addEventListener('change', applyCurrentSection);
}

function parseArrayString(value) {
  if (typeof value !== 'string') return [];
  if (!value.trim()) return [];
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

function pathTokens(path) {
  const tokens = [];
  const regex = /([^\.\[\]]+)|(\[(\d+)\])/g;
  let match = null;
  while ((match = regex.exec(path)) !== null) {
    if (match[1]) tokens.push(match[1]);
    else if (match[3]) tokens.push(Number.parseInt(match[3], 10));
  }
  return tokens;
}

function getValueByPath(root, path) {
  if (!path) return undefined;
  const tokens = pathTokens(path);
  let current = root;
  for (const token of tokens) {
    if (current == null) return undefined;
    current = typeof token === 'number' ? current[token] : current[token];
  }
  return current;
}

function setValueByPath(root, path, value) {
  if (!path) return;
  const tokens = pathTokens(path);
  if (!tokens.length) return;
  let current = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (typeof token === 'number') {
      if (!Array.isArray(current)) return;
      current = current[token];
    } else {
      if (current[token] == null) current[token] = {};
      current = current[token];
    }
  }
  const last = tokens[tokens.length - 1];
  if (typeof last === 'number') {
    if (Array.isArray(current)) current[last] = value;
  } else {
    current[last] = value;
  }
}

function buildArrayControls(meta, container, arr, path, label) {
  if (!Array.isArray(arr)) return;
  if (!arr.length) return;
  const isPrimitive = arr.every(v => !(v && typeof v === 'object'));
  if (isPrimitive) {
    const group = document.createElement('div');
    group.className = 'ink-subgroup';
    if (label) {
      const heading = document.createElement('div');
      heading.className = 'ink-subheading';
      heading.textContent = label;
      group.appendChild(heading);
    }
    arr.forEach((value, idx) => {
      const itemPath = `${path}[${idx}]`;
      const input = createInputForValue(value, itemPath, meta?.id);
      if (!input.dataset.enumOptions && typeof value === 'string') input.dataset.string = '1';
      const row = buildControlRow(`${label ? label : 'Item'} ${idx + 1}`, input);
      group.appendChild(row);
      registerMetaInput(meta, itemPath, input);
    });
    container.appendChild(group);
    return;
  }
  const group = document.createElement('div');
  group.className = 'ink-subgroup';
  if (label) {
    const heading = document.createElement('div');
    heading.className = 'ink-subheading';
    heading.textContent = label;
    group.appendChild(heading);
  }
  arr.forEach((value, idx) => {
    const item = document.createElement('div');
    item.className = 'ink-array-item';
    const title = document.createElement('div');
    title.className = 'ink-array-title';
    title.textContent = `${label || 'Item'} ${idx + 1}`;
    item.appendChild(title);
    const keys = getObjectKeys(`${label}[]`, value);
    keys.forEach(key => {
      const itemPath = `${path}[${idx}].${key}`;
      const val = value[key];
      if (Array.isArray(val)) {
        buildArrayControls(meta, item, val, `${path}[${idx}].${key}`, key);
        return;
      }
      if (val && typeof val === 'object') {
        buildObjectControls(meta, item, val, `${path}[${idx}].${key}`, key);
        return;
      }
      const input = createInputForValue(val, itemPath, meta?.id);
      const row = buildControlRow(key, input);
      if (!input.dataset.enumOptions && typeof val === 'string') input.dataset.string = '1';
      item.appendChild(row);
      registerMetaInput(meta, itemPath, input);
    });
    group.appendChild(item);
  });
  container.appendChild(group);
}

function buildObjectControls(meta, container, obj, path, label) {
  if (!obj || typeof obj !== 'object') return;
  const group = document.createElement('div');
  group.className = 'ink-subgroup';
  if (label) {
    const heading = document.createElement('div');
    heading.className = 'ink-subheading';
    heading.textContent = label;
    group.appendChild(heading);
  }
  const keys = getObjectKeys(path, obj);
  keys.forEach(key => {
    const keyPath = path ? `${path}.${key}` : key;
    const value = obj[key];
    if (Array.isArray(value)) {
      buildArrayControls(meta, group, value, keyPath, key);
      return;
    }
    if (value && typeof value === 'object') {
      buildObjectControls(meta, group, value, keyPath, key);
      return;
    }
    const input = createInputForValue(value, keyPath, meta?.id);
    if (!input.dataset.enumOptions && typeof value === 'string') input.dataset.string = '1';
    const row = buildControlRow(key, input);
    group.appendChild(row);
    registerMetaInput(meta, keyPath, input);
  });
  container.appendChild(group);
}

function setSectionCollapsed(meta, collapsed) {
  if (!meta) return;
  const isCollapsed = !!collapsed;
  meta.isCollapsed = isCollapsed;
  if (meta.root) {
    meta.root.classList.toggle('is-collapsed', isCollapsed);
  }
  if (meta.body) {
    meta.body.hidden = isCollapsed;
  }
  if (meta.toggleButton) {
    meta.toggleButton.setAttribute('aria-expanded', String(!isCollapsed));
  }
}

function buildSection(def, root) {
  const sectionEl = document.createElement('section');
  sectionEl.className = 'ink-section';
  sectionEl.dataset.sectionId = def.id;

  const header = document.createElement('div');
  header.className = 'ink-section-header';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'ink-section-toggle';
  toggleBtn.setAttribute('aria-expanded', 'false');
  const icon = document.createElement('span');
  icon.className = 'ink-section-toggle-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '▸';
  toggleBtn.appendChild(icon);
  const title = document.createElement('span');
  title.className = 'ink-section-title';
  title.textContent = def.label;
  toggleBtn.appendChild(title);

  const topLine = document.createElement('div');
  topLine.className = 'ink-section-topline';
  topLine.appendChild(toggleBtn);
  header.appendChild(topLine);

  const strengthWrap = document.createElement('div');
  strengthWrap.className = 'ink-section-controls';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  const startPercent = getPercentFromState(def.stateKey, def.defaultStrength ?? 0);
  slider.value = String(startPercent);
  strengthWrap.appendChild(slider);
  const numberInput = document.createElement('input');
  numberInput.type = 'number';
  numberInput.min = '0';
  numberInput.max = '100';
  numberInput.step = '1';
  numberInput.value = String(startPercent);
  numberInput.setAttribute('aria-label', `${def.label} strength`);
  strengthWrap.appendChild(numberInput);
  header.appendChild(strengthWrap);

  sectionEl.appendChild(header);

  const body = document.createElement('div');
  body.className = 'ink-section-body';
  const bodyId = `inkSection-${def.id}`;
  body.id = bodyId;
  toggleBtn.setAttribute('aria-controls', bodyId);
  const meta = {
    id: def.id,
    config: def.config,
    trigger: def.trigger,
    stateKey: def.stateKey,
    root: sectionEl,
    inputs: new Map(),
    slider,
    numberInput,
    body,
    toggleButton: toggleBtn,
    defaultStrength: def.defaultStrength ?? 0,
    autoEnable: def.autoEnable !== false,
  };

  def.keyOrder.forEach(entry => {
    let path = null;
    let labelText = '';
    if (typeof entry === 'string') {
      path = entry;
      labelText = def.labels && typeof def.labels === 'object' && def.labels[entry]
        ? def.labels[entry]
        : entry;
    } else if (entry && typeof entry === 'object') {
      path = entry.path || entry.key || entry.name || null;
      labelText = entry.label || entry.title || entry.name || entry.key || entry.path || '';
    }
    if (!path) return;
    const value = getValueByPath(meta.config, path);
    if (Array.isArray(value)) {
      buildArrayControls(meta, body, value, path, labelText || path);
      return;
    }
    if (value && typeof value === 'object') {
      buildObjectControls(meta, body, value, path, labelText || path);
      return;
    }
    const input = createInputForValue(value, path, meta.id);
    if (!input.dataset.enumOptions && typeof value === 'string') input.dataset.string = '1';
    const row = buildControlRow(labelText || path, input);
    body.appendChild(row);
    registerMetaInput(meta, path, input);
  });

  sectionEl.appendChild(body);
  root.appendChild(sectionEl);
  panelState.metas.push(meta);

  toggleBtn.addEventListener('click', () => {
    setSectionCollapsed(meta, !meta.isCollapsed);
  });
  slider.addEventListener('input', () => {
    applySectionStrength(meta, Number.parseFloat(slider.value) || 0);
  });
  numberInput.addEventListener('input', () => {
    const raw = Number.parseFloat(numberInput.value);
    if (!Number.isFinite(raw)) return;
    applySectionStrength(meta, raw);
  });
  numberInput.addEventListener('blur', () => {
    if (numberInput.value !== '') return;
    const fallback = meta.defaultStrength ?? 0;
    const pct = getPercentFromState(meta.stateKey, fallback);
    applySectionStrength(meta, pct, { silent: true });
  });

  setSectionCollapsed(meta, true);
  applySectionStrength(meta, startPercent, { silent: true, syncSlider: false, syncNumber: false });
  return meta;
}

function persistPanelState() {
  if (typeof panelState.saveState === 'function') {
    panelState.saveState();
  }
}

function scheduleGlyphRefresh(rebuild = true) {
  if (typeof panelState.callbacks.refreshGlyphs !== 'function') return;
  if (panelState.pendingGlyphRAF) {
    if (rebuild && panelState.pendingGlyphOptions && panelState.pendingGlyphOptions.rebuild === false) {
      panelState.pendingGlyphOptions.rebuild = true;
    }
    return;
  }
  panelState.pendingGlyphOptions = { rebuild: rebuild !== false };
  panelState.pendingGlyphRAF = requestAnimationFrame(() => {
    const opts = panelState.pendingGlyphOptions || { rebuild: rebuild !== false };
    panelState.pendingGlyphRAF = 0;
    panelState.pendingGlyphOptions = null;
    panelState.callbacks.refreshGlyphs(opts);
  });
}

function scheduleGrainRefresh() {
  if (panelState.pendingGrainRAF || typeof panelState.callbacks.refreshGrain !== 'function') return;
  panelState.pendingGrainRAF = requestAnimationFrame(() => {
    panelState.pendingGrainRAF = 0;
    panelState.callbacks.refreshGrain();
  });
}

function scheduleRefreshForMeta(meta, options = {}) {
  if (!meta) return;
  if (meta.trigger === 'glyph') {
    const needsFullRebuild = options.forceRebuild === true
      ? true
      : options.forceRebuild === false
        ? false
        : meta.id !== 'fuzz';
    scheduleGlyphRefresh(needsFullRebuild);
  } else if (meta.trigger === 'grain') {
    scheduleGrainRefresh();
  }
}

function syncGrainInputField(pct) {
  const app = panelState.app;
  if (!app || !app.grainInput) return;
  const normalized = clamp(Math.round(pct), 0, 100);
  if (app.grainInput.value !== String(normalized)) {
    app.grainInput.value = String(normalized);
  }
}

function applySectionStrength(meta, percent, options = {}) {
  if (!meta) return;
  const pct = clamp(Math.round(Number(percent) || 0), 0, 100);
  if (options.syncSlider !== false && meta.slider && meta.slider.value !== String(pct)) {
    meta.slider.value = String(pct);
  }
  if (options.syncNumber !== false && meta.numberInput && meta.numberInput.value !== String(pct)) {
    meta.numberInput.value = String(pct);
  }
  if (meta.root) {
    meta.root.classList.toggle('is-disabled', pct <= 0);
  }
  if (options.silent) return;
  setPercentOnState(meta.stateKey, pct);
  if (meta.config && typeof meta.config === 'object') {
    if (meta.autoEnable !== false) {
      meta.config.enabled = pct > 0;
    }
  }
  if (meta.id === 'grain') {
    syncGrainInputField(pct);
  }
  scheduleRefreshForMeta(meta);
  persistPanelState();
}

function syncInputs(meta) {
  for (const [path, input] of meta.inputs.entries()) {
    const value = getValueByPath(meta.config, path);
    if (input.dataset.enumOptions) {
      const options = input.dataset.enumOptions.split('|');
      let idx = -1;
      if (typeof value === 'string') {
        idx = options.indexOf(value);
      }
      if (idx < 0 && Number.isFinite(Number(value))) {
        idx = Math.round(Number(value));
      }
      const bounded = clamp(idx >= 0 ? idx : 0, 0, Math.max(0, options.length - 1));
      if (input.value !== String(bounded)) {
        input.value = String(bounded);
      }
      updateSliderDisplay(input);
      continue;
    }
    if (input.dataset.hex === '1') {
      input.value = toHex(value ?? 0);
    } else if (input.type === 'checkbox') {
      input.checked = !!value;
    } else if (input.dataset.string === '1') {
      if (Array.isArray(value)) input.value = value.join(', ');
      else input.value = value == null ? '' : String(value);
    } else if (input.type === 'number') {
      input.value = value == null ? '' : String(value);
      if (input.dataset.slider === '1') updateSliderDisplay(input);
    } else if (input.type === 'range') {
      const fallback = Number.parseFloat(input.value);
      const min = Number.parseFloat(input.min);
      const max = Number.parseFloat(input.max);
      let next = Number.parseFloat(value);
      if (!Number.isFinite(next)) {
        next = Number.isFinite(fallback) ? fallback : 0;
      }
      const hasBounds = Number.isFinite(min) && Number.isFinite(max);
      const lower = hasBounds ? Math.min(min, max) : next;
      const upper = hasBounds ? Math.max(min, max) : next;
      const clamped = hasBounds ? clamp(next, lower, upper) : next;
      if (Number.isFinite(clamped)) {
        input.value = String(clamped);
      }
      updateSliderDisplay(input);
    } else {
      input.value = value == null ? '' : String(value);
      if (input.dataset.slider === '1') updateSliderDisplay(input);
    }
  }
}

function applySection(meta) {
  for (const [path, input] of meta.inputs.entries()) {
    if (!input) continue;
    if (input.dataset.string === '1' && Array.isArray(getValueByPath(meta.config, path))) {
      const list = parseArrayString(input.value);
      setValueByPath(meta.config, path, list);
      continue;
    }
    const value = parseInputValue(input, path);
    setValueByPath(meta.config, path, value);
  }
  if (meta.id === 'fill') {
    applyFillConfigToState(meta.config, { silent: true });
    syncFillConfigValues();
  }
  scheduleRefreshForMeta(meta, { forceRebuild: true });
  persistPanelState();
  syncInputs(meta);
}

function applyConfigToTarget(target, source) {
  if (!target || typeof target !== 'object') return;
  if (!source || typeof source !== 'object') return;
  Object.keys(source).forEach(key => {
    target[key] = deepCloneValue(source[key]);
  });
}

function revertInlineStyleNameInput(input) {
  if (!input) return;
  const original = typeof input.dataset.originalName === 'string' ? input.dataset.originalName : '';
  input.value = original;
  input.title = original;
  input.classList.remove('input-error');
}

function commitInlineStyleName(styleId, input) {
  if (!input) return;
  const original = typeof input.dataset.originalName === 'string' ? input.dataset.originalName : '';
  const sanitized = sanitizeStyleName(input.value);
  if (!sanitized) {
    revertInlineStyleNameInput(input);
    input.classList.add('input-error');
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return;
  }
  if (sanitized === original) {
    input.value = sanitized;
    input.title = sanitized;
    input.classList.remove('input-error');
    return;
  }
  const styles = getSavedStyles();
  if (!Array.isArray(styles) || !styles.length) {
    input.dataset.originalName = sanitized;
    input.value = sanitized;
    input.title = sanitized;
    input.classList.remove('input-error');
    return;
  }
  const index = styles.findIndex(style => style && style.id === styleId);
  if (index < 0) {
    input.dataset.originalName = sanitized;
    input.value = sanitized;
    input.title = sanitized;
    input.classList.remove('input-error');
    return;
  }
  const updated = styles.slice();
  const next = { ...updated[index], name: sanitized };
  updated[index] = next;
  setSavedStyles(updated);
  persistPanelState();
  input.dataset.originalName = sanitized;
  input.value = sanitized;
  input.title = sanitized;
  input.classList.remove('input-error');
  if (panelState.lastLoadedStyleId === styleId && panelState.styleNameInput) {
    panelState.styleNameInput.value = sanitized;
    panelState.styleNameInput.classList.remove('input-error');
  }
}

function renderSavedStylesList(options = {}) {
  const list = panelState.stylesList;
  if (!list) return;
  const { focusId } = options || {};
  list.innerHTML = '';
  let styles = [];
  try {
    styles = getSavedStyles();
  } catch (error) {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('Failed to read saved ink styles.', error);
    }
    styles = [];
  }
  if (!styles.length) {
    const empty = document.createElement('div');
    empty.className = 'ink-styles-empty';
    empty.textContent = 'No saved styles yet.';
    list.appendChild(empty);
    return;
  }
  styles.forEach(style => {
    if (!style) return;
    const item = document.createElement('div');
    item.className = 'ink-style-item';
    item.dataset.styleId = style.id;
    if (panelState.lastLoadedStyleId && panelState.lastLoadedStyleId === style.id) {
      item.classList.add('is-active');
    }

    const nameRow = document.createElement('div');
    nameRow.className = 'ink-style-name-row';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ink-style-name-input';
    nameInput.value = style.name;
    nameInput.title = style.name;
    nameInput.maxLength = STYLE_NAME_MAX_LEN;
    nameInput.dataset.originalName = style.name;
    nameInput.addEventListener('input', () => {
      nameInput.classList.remove('input-error');
      nameInput.title = nameInput.value;
    });
    nameInput.addEventListener('blur', () => commitInlineStyleName(style.id, nameInput));
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        nameInput.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        revertInlineStyleNameInput(nameInput);
        nameInput.select();
      }
    });
    nameRow.appendChild(nameInput);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'ink-style-actions-row';
    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn btn-small';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => applySavedStyle(style.id));
    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.className = 'btn-text';
    updateBtn.textContent = 'Update';
    updateBtn.title = 'Update this style with the current settings';
    updateBtn.addEventListener('click', () => updateSavedStyle(style.id));
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-text danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => removeSavedStyle(style.id));
    actionsRow.appendChild(loadBtn);
    actionsRow.appendChild(updateBtn);
    actionsRow.appendChild(deleteBtn);

    item.appendChild(nameRow);
    item.appendChild(actionsRow);
    list.appendChild(item);

    if (focusId && focusId === style.id) {
      requestAnimationFrame(() => loadBtn.focus());
    }
  });
}

function handleSaveStyle(event) {
  if (event) event.preventDefault();
  const input = panelState.styleNameInput;
  if (!input) return;
  const sanitized = sanitizeStyleName(input.value);
  if (!sanitized) {
    input.classList.add('input-error');
    input.focus();
    return;
  }
  const existingStyles = getSavedStyles();
  const existingIdx = existingStyles.findIndex(style => style && style.name && style.name.toLowerCase() === sanitized.toLowerCase());
  const existingId = existingIdx >= 0 ? existingStyles[existingIdx].id : null;
  const snapshot = createStyleSnapshot(sanitized, existingId);
  if (!snapshot) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert('Could not save ink style. Please try again.');
    }
    return;
  }
  let updated;
  if (existingIdx >= 0) {
    updated = existingStyles.slice();
    updated[existingIdx] = snapshot;
  } else {
    updated = [snapshot, ...existingStyles];
  }
  setSavedStyles(updated);
  persistPanelState();
  renderSavedStylesList({ focusId: snapshot.id });
  input.value = '';
  input.classList.remove('input-error');
}

function updateSavedStyle(styleId) {
  if (!styleId) return;
  const styles = getSavedStyles();
  if (!Array.isArray(styles) || !styles.length) return;
  const index = styles.findIndex(style => style && style.id === styleId);
  if (index < 0) return;
  const target = styles[index];
  const preservedName = sanitizeStyleName(target?.name) || 'Updated style';
  const snapshot = createStyleSnapshot(preservedName, styleId);
  if (!snapshot) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert('Could not update this style. Please try again.');
    }
    return;
  }
  const updated = styles.slice();
  updated[index] = { ...snapshot, id: styleId, name: preservedName };
  setSavedStyles(updated);
  persistPanelState();
  renderSavedStylesList({ focusId: styleId });
}

function removeSavedStyle(styleId) {
  const styles = getSavedStyles();
  if (!styles.length) return;
  const target = styles.find(style => style && style.id === styleId);
  if (!target) return;
  let confirmed = true;
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    confirmed = window.confirm(`Delete style "${target.name}"?`);
  }
  if (!confirmed) return;
  const updated = styles.filter(style => style && style.id !== styleId);
  setSavedStyles(updated);
  if (panelState.lastLoadedStyleId === styleId) {
    panelState.lastLoadedStyleId = null;
  }
  persistPanelState();
  renderSavedStylesList();
}

function applySavedStyle(styleId) {
  const styles = getSavedStyles();
  const style = styles.find(s => s && s.id === styleId);
  if (!style) return;
  if (Number.isFinite(style.overall)) {
    setOverallStrength(style.overall);
  }
  SECTION_DEFS.forEach(def => {
    const meta = findMetaById(def.id);
    if (!meta) return;
    const section = style.sections && style.sections[def.id];
    if (def.id === 'fill') {
      const fillConfig = section && section.config
        ? normalizeFillConfig(section.config, style)
        : normalizeFillConfig(null, style);
      applyConfigToTarget(meta.config, fillConfig);
      applyFillConfigToState(meta.config, { silent: true });
      syncFillConfigValues();
      syncInputs(meta);
      scheduleRefreshForMeta(meta, { forceRebuild: true });
    } else if (section && section.config) {
      applyConfigToTarget(meta.config, section.config);
      syncInputs(meta);
      scheduleRefreshForMeta(meta, { forceRebuild: true });
    }
    const rawStrength = section && section.strength;
    const strengthSource = def.id === 'fill'
      ? (rawStrength ?? style.fillStrength)
      : rawStrength;
    const strength = Number(strengthSource);
    if (Number.isFinite(strength)) {
      applySectionStrength(meta, strength);
    }
  });
  panelState.lastLoadedStyleId = styleId;
  if (panelState.styleNameInput) {
    panelState.styleNameInput.value = style.name;
    panelState.styleNameInput.classList.remove('input-error');
  }
  persistPanelState();
  renderSavedStylesList();
}

export function getInkEffectFactor() {
  const pct = getPercentFromState('effectsOverallStrength', 100);
  return normalizedPercent(pct);
}

function getFillStrengthPercent() {
  return getPercentFromState('inkFillStrength', 100);
}

function getFillStrengthFactor() {
  return normalizedPercent(getFillStrengthPercent());
}

function getCenterThickenPercent() {
  return getScalarFromState(
    'centerThickenPct',
    CENTER_THICKEN_LIMITS.defaultPct,
    CENTER_THICKEN_LIMITS.min,
    CENTER_THICKEN_LIMITS.max,
  );
}

function getEdgeThinPercent() {
  return getScalarFromState(
    'edgeThinPct',
    EDGE_THIN_LIMITS.defaultPct,
    EDGE_THIN_LIMITS.min,
    EDGE_THIN_LIMITS.max,
  );
}

export function getCenterThickenFactor() {
  const pct = getCenterThickenPercent();
  const base = clamp(pct / 100, CENTER_THICKEN_LIMITS.min / 100, CENTER_THICKEN_LIMITS.max / 100);
  const strength = getFillStrengthFactor();
  return 1 + (base - 1) * strength;
}

export function getEdgeThinFactor() {
  const pct = getEdgeThinPercent();
  const base = clamp(pct / 100, EDGE_THIN_LIMITS.min / 100, EDGE_THIN_LIMITS.max / 100);
  const strength = getFillStrengthFactor();
  return 1 + (base - 1) * strength;
}

export function getInkSectionStrength(sectionId) {
  switch (sectionId) {
    case 'fill':
      return getFillStrengthFactor();
    case 'blur':
      return normalizedPercent(getPercentFromState('inkBlurStrength', INK_BLUR.enabled === false ? 0 : 100));
    case 'texture':
      return normalizedPercent(getPercentFromState('inkTextureStrength', INK_TEXTURE.enabled === false ? 0 : 100));
    case 'fuzz':
      return normalizedPercent(getPercentFromState('edgeFuzzStrength', 100));
    case 'bleed':
      return normalizedPercent(getPercentFromState('edgeBleedStrength', EDGE_BLEED.enabled === false ? 0 : 100));
    case 'grain':
      return normalizedPercent(getPercentFromState('grainPct', GRAIN_CFG.enabled === false ? 0 : 100));
    default:
      return 1;
  }
}

export function isInkSectionEnabled(sectionId) {
  const strength = getInkSectionStrength(sectionId);
  if (sectionId === 'fill') return strength > 0 && FILL_CFG.enabled !== false;
  if (sectionId === 'grain') return strength > 0 && GRAIN_CFG.enabled !== false;
  if (sectionId === 'texture') return strength > 0 && INK_TEXTURE.enabled !== false;
  if (sectionId === 'blur') return strength > 0 && INK_BLUR.enabled !== false;
  if (sectionId === 'fuzz') return strength > 0 && EDGE_FUZZ.enabled !== false;
  if (sectionId === 'bleed') return strength > 0 && EDGE_BLEED.enabled !== false;
  return strength > 0;
}

export function getInkSectionOrder() {
  return normalizeSectionOrder(getSectionOrderFromState());
}

function syncOverallStrengthUI() {
  const pct = getPercentFromState('effectsOverallStrength', 100);
  if (panelState.overallSlider && panelState.overallSlider.value !== String(pct)) {
    panelState.overallSlider.value = String(pct);
  }
  if (panelState.overallNumberInput && panelState.overallNumberInput.value !== String(pct)) {
    panelState.overallNumberInput.value = String(pct);
  }
}

function setOverallStrength(percent) {
  const pct = clamp(Math.round(Number(percent) || 0), 0, 100);
  setPercentOnState('effectsOverallStrength', pct);
  syncOverallStrengthUI();
  scheduleGlyphRefresh();
  scheduleGrainRefresh();
  persistPanelState();
  return pct;
}

function setCenterThickenPercent(percent, options = {}) {
  const { silent = false, updateConfig = true } = options || {};
  const raw = Number(percent);
  const pct = clamp(
    Number.isFinite(raw) ? Math.round(raw) : CENTER_THICKEN_LIMITS.defaultPct,
    CENTER_THICKEN_LIMITS.min,
    CENTER_THICKEN_LIMITS.max,
  );
  setScalarOnState('centerThickenPct', pct, CENTER_THICKEN_LIMITS.min, CENTER_THICKEN_LIMITS.max);
  if (updateConfig === false) {
    syncFillConfigValues();
  } else {
    FILL_CFG.centerThickenPct = pct;
  }
  if (!silent) {
    scheduleGlyphRefresh();
    persistPanelState();
  }
  return pct;
}

function setEdgeThinPercent(percent, options = {}) {
  const { silent = false, updateConfig = true } = options || {};
  const raw = Number(percent);
  const pct = clamp(
    Number.isFinite(raw) ? Math.round(raw) : EDGE_THIN_LIMITS.defaultPct,
    EDGE_THIN_LIMITS.min,
    EDGE_THIN_LIMITS.max,
  );
  setScalarOnState('edgeThinPct', pct, EDGE_THIN_LIMITS.min, EDGE_THIN_LIMITS.max);
  if (updateConfig === false) {
    syncFillConfigValues();
  } else {
    FILL_CFG.edgeThinPct = pct;
  }
  if (!silent) {
    scheduleGlyphRefresh();
    persistPanelState();
  }
  return pct;
}

function findMetaById(sectionId) {
  if (!sectionId) return null;
  return panelState.metas.find(meta => meta && meta.id === sectionId) || null;
}

export function syncInkStrengthDisplays(sectionId) {
  if (!panelState.initialized) return;
  if (!sectionId) {
    syncOverallStrengthUI();
    syncFillConfigValues();
    panelState.metas.forEach(meta => {
      if (!meta) return;
      if (meta.id === 'fill') {
        syncInputs(meta);
      }
      const fallback = meta.defaultStrength ?? 0;
      const pct = getPercentFromState(meta.stateKey, fallback);
      applySectionStrength(meta, pct, { silent: true });
    });
    return;
  }
  if (sectionId === 'overall') {
    syncOverallStrengthUI();
    return;
  }
  if (sectionId === 'fill') {
    const meta = findMetaById('fill');
    if (!meta) return;
    syncFillConfigValues();
    syncInputs(meta);
    const fallback = meta.defaultStrength ?? 0;
    const pct = getPercentFromState(meta.stateKey, fallback);
    applySectionStrength(meta, pct, { silent: true });
    return;
  }
  const meta = findMetaById(sectionId);
  if (!meta) return;
  const fallback = meta.defaultStrength ?? 0;
  const pct = getPercentFromState(meta.stateKey, fallback);
  applySectionStrength(meta, pct, { silent: true });
}

export function setupInkSettingsPanel(options = {}) {
  if (panelState.initialized) return;
  const {
    state,
    app,
    refreshGlyphs,
    refreshGrain,
    saveState,
  } = options || {};

  if (state && typeof state === 'object') {
    panelState.appState = state;
  }
  if (app && typeof app === 'object') {
    panelState.app = app;
  }
  panelState.callbacks.refreshGlyphs = typeof refreshGlyphs === 'function' ? refreshGlyphs : null;
  panelState.callbacks.refreshGrain = typeof refreshGrain === 'function' ? refreshGrain : null;
  panelState.saveState = typeof saveState === 'function' ? saveState : null;

  const sectionsRoot = document.getElementById('inkSettingsSections');
  panelState.overallSlider = document.getElementById('inkEffectsOverallSlider');
  panelState.overallNumberInput = document.getElementById('inkEffectsOverallNumber');
  panelState.styleNameInput = document.getElementById('inkStyleNameInput');
  panelState.saveStyleButton = document.getElementById('inkStyleSaveBtn');
  panelState.stylesList = document.getElementById('inkStylesList');
  panelState.exportButton = document.getElementById('inkStyleExportBtn');
  panelState.importButton = document.getElementById('inkStyleImportBtn');
  panelState.importInput = document.getElementById('inkStyleImportInput');
  panelState.sectionsRoot = sectionsRoot;

  syncFillConfigValues();

  if (panelState.styleNameInput) {
    panelState.styleNameInput.addEventListener('input', () => panelState.styleNameInput.classList.remove('input-error'));
    panelState.styleNameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleSaveStyle();
      }
    });
  }
  if (panelState.saveStyleButton) {
    panelState.saveStyleButton.addEventListener('click', handleSaveStyle);
  }
  if (panelState.exportButton) {
    panelState.exportButton.addEventListener('click', exportCurrentStyle);
  }
  if (panelState.importButton && panelState.importInput) {
    panelState.importButton.addEventListener('click', () => panelState.importInput.click());
    panelState.importInput.addEventListener('change', handleImportInputChange);
  }

  if (panelState.appState) {
    setSavedStyles(getSavedStyles());
  }
  panelState.lastLoadedStyleId = null;
  renderSavedStylesList();

  if (panelState.overallSlider) {
    panelState.overallSlider.addEventListener('input', () => {
      const pct = clamp(Number.parseFloat(panelState.overallSlider.value) || 0, 0, 100);
      setOverallStrength(pct);
    });
  }
  if (panelState.overallNumberInput) {
    panelState.overallNumberInput.addEventListener('input', () => {
      const raw = Number.parseFloat(panelState.overallNumberInput.value);
      if (!Number.isFinite(raw)) return;
      setOverallStrength(raw);
    });
    panelState.overallNumberInput.addEventListener('blur', () => {
      if (panelState.overallNumberInput.value !== '') return;
      syncOverallStrengthUI();
    });
  }
  syncOverallStrengthUI();

  if (sectionsRoot) {
    panelState.metas = [];
    SECTION_DEFS.forEach(def => {
      const meta = buildSection(def, sectionsRoot);
      if (meta) {
        syncInputs(meta);
      }
    });
  }

  panelState.initialized = true;
  syncInkStrengthDisplays();
}

export function refreshSavedInkStylesUI() {
  renderSavedStylesList();
}
