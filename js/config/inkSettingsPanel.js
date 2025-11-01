import {
  EDGE_BLEED,
  EDGE_FUZZ,
  GRAIN_CFG,
  INK_INTENSITY,
  INK_TEXTURE,
  normalizeEdgeFuzzConfig,
  normalizeInkTextureConfig,
} from './inkConfig.js';

const sanitizedInkTextureDefaults = normalizeInkTextureConfig(INK_TEXTURE);
Object.assign(INK_TEXTURE, sanitizedInkTextureDefaults);

const sanitizedEdgeFuzzDefaults = normalizeEdgeFuzzConfig(EDGE_FUZZ);
Object.assign(EDGE_FUZZ, sanitizedEdgeFuzzDefaults);

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

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

const SECTION_DEFS = [
  {
    id: 'texture',
    label: 'Texture',
    config: INK_TEXTURE,
    keyOrder: ['supersample', 'coarseNoise', 'fineNoise', 'noiseSmoothing', 'centerEdgeBias', 'noiseFloor', 'chip', 'scratch', 'jitterSeed'],
    trigger: 'glyph',
    stateKey: 'inkTextureStrength',
    defaultStrength: INK_TEXTURE.enabled === false ? 0 : 100,
  },
  {
    id: 'fuzz',
    label: 'Edge Fuzz',
    config: EDGE_FUZZ,
    keyOrder: ['inks', 'widths', 'baseOpacity', 'direction', 'noise', 'seed'],
    trigger: 'glyph',
    stateKey: 'edgeFuzzStrength',
    defaultStrength: 100,
  },
  {
    id: 'bleed',
    label: 'Bleed',
    config: EDGE_BLEED,
    keyOrder: ['inks', 'passes'],
    trigger: 'glyph',
    stateKey: 'edgeBleedStrength',
    defaultStrength: EDGE_BLEED.enabled === false ? 0 : 100,
  },
  {
    id: 'grain',
    label: 'Grain',
    config: GRAIN_CFG,
    keyOrder: ['base_scale_from_char_w', 'octave_rel_scales', 'octave_weights', 'pixel_hash_weight', 'post_gamma', 'alpha', 'seeds', 'composite_op'],
    trigger: 'grain',
    stateKey: 'grainPct',
    defaultStrength: 100,
  }
];

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
  centerThickenSlider: null,
  centerThickenNumberInput: null,
  edgeThinSlider: null,
  edgeThinNumberInput: null,
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
      centerThicken: clamp(
        Math.round(Number.isFinite(Number(style?.centerThicken))
          ? Number(style.centerThicken)
          : Number.isFinite(Number(style?.centerThickenPct))
            ? Number(style.centerThickenPct)
            : CENTER_THICKEN_LIMITS.defaultPct),
        CENTER_THICKEN_LIMITS.min,
        CENTER_THICKEN_LIMITS.max,
      ),
      edgeThin: clamp(
        Math.round(Number.isFinite(Number(style?.edgeThin))
          ? Number(style.edgeThin)
          : Number.isFinite(Number(style?.edgeThinPct))
            ? Number(style.edgeThinPct)
            : EDGE_THIN_LIMITS.defaultPct),
        EDGE_THIN_LIMITS.min,
        EDGE_THIN_LIMITS.max,
      ),
      sections: {},
    };
    SECTION_DEFS.forEach(def => {
      const rawSection = style?.sections && typeof style.sections === 'object'
        ? style.sections[def.id]
        : (style && typeof style === 'object' && typeof style[def.id] === 'object' ? style[def.id] : null);
      const section = rawSection && typeof rawSection === 'object' ? rawSection : {};
      const strength = clamp(Math.round(Number(section?.strength ?? def.defaultStrength ?? 0)), 0, 100);
      let configSource = section.config != null
        ? section.config
        : section.settings != null
          ? section.settings
          : ('strength' in section ? def.config : section);
      if (def.id === 'texture') {
        configSource = normalizeInkTextureConfig(configSource);
      } else if (def.id === 'fuzz') {
        configSource = normalizeEdgeFuzzConfig(configSource);
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
    name: `Style ${index + 1}`,
    overall: 100,
    centerThicken: CENTER_THICKEN_LIMITS.defaultPct,
    edgeThin: EDGE_THIN_LIMITS.defaultPct,
    sections: {},
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
    centerThicken: getCenterThickenPercent(),
    edgeThin: getEdgeThinPercent(),
    sections: {},
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
    case 'widths':
      return ['inwardPx', 'outwardPx'];
    case 'direction': {
      const keys = ['angleDeg'];
      Object.keys(obj || {}).forEach(key => {
        if (key !== 'angleDeg' && !keys.includes(key)) keys.push(key);
      });
      return keys;
    }
    case 'noise':
      return ['frequency', 'roughness'];
    case 'alpha':
      return ['max', 'mix_pow', 'low_pow', 'min'];
    case 'seeds':
      return ['octave', 'hash'];
    case 'passes[]':
      return ['width', 'alpha', 'jitter', 'jitterY', 'lighten', 'strokes', 'seed'];
    case 'noiseOctaves[]':
      return ['scale', 'weight', 'seed'];
    default:
      return Object.keys(obj);
  }
}

function buildControlRow(labelText, input) {
  const row = document.createElement('div');
  row.className = 'control-row';
  const label = document.createElement('label');
  label.textContent = labelText;
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function createInputForValue(value, path) {
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
  if (input.type === 'checkbox') return !!input.checked;
  if (input.dataset.hex === '1') return parseHex(input.value);
  if (input.type === 'number') {
    const num = Number.parseFloat(input.value);
    return Number.isFinite(num) ? num : 0;
  }
  return input.value;
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
      const input = createInputForValue(value, itemPath);
      if (typeof value === 'string') input.dataset.string = '1';
      const row = buildControlRow(`${label ? label : 'Item'} ${idx + 1}`, input);
      group.appendChild(row);
      meta.inputs.set(itemPath, input);
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
      const input = createInputForValue(val, itemPath);
      const row = buildControlRow(key, input);
      if (typeof val === 'string') input.dataset.string = '1';
      item.appendChild(row);
      meta.inputs.set(itemPath, input);
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
    const input = createInputForValue(value, keyPath);
    if (typeof value === 'string') input.dataset.string = '1';
    const row = buildControlRow(key, input);
    group.appendChild(row);
    meta.inputs.set(keyPath, input);
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
    applyBtn: null,
  };

  def.keyOrder.forEach(key => {
    const value = def.config[key];
    const path = key;
    if (Array.isArray(value)) {
      buildArrayControls(meta, body, value, path, key);
      return;
    }
    if (value && typeof value === 'object') {
      buildObjectControls(meta, body, value, path, key);
      return;
    }
    const input = createInputForValue(value, path);
    if (typeof value === 'string') input.dataset.string = '1';
    const row = buildControlRow(key, input);
    body.appendChild(row);
    meta.inputs.set(path, input);
  });

  const applyRow = document.createElement('div');
  applyRow.className = 'control-row ink-section-apply-row';
  applyRow.appendChild(document.createElement('div'));
  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn apply-btn';
  applyBtn.textContent = 'Apply';
  applyRow.appendChild(applyBtn);
  body.appendChild(applyRow);
  meta.applyBtn = applyBtn;

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
    meta.config.enabled = pct > 0;
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
    if (input.dataset.hex === '1') {
      input.value = toHex(value ?? 0);
    } else if (input.type === 'checkbox') {
      input.checked = !!value;
    } else if (input.dataset.string === '1') {
      if (Array.isArray(value)) input.value = value.join(', ');
      else input.value = value == null ? '' : String(value);
    } else if (input.type === 'number') {
      input.value = value == null ? '' : String(value);
    } else {
      input.value = value == null ? '' : String(value);
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
  if (Number.isFinite(style.centerThicken)) {
    setCenterThickenPercent(style.centerThicken);
  }
  if (Number.isFinite(style.edgeThin)) {
    setEdgeThinPercent(style.edgeThin);
  }
  SECTION_DEFS.forEach(def => {
    const meta = findMetaById(def.id);
    if (!meta) return;
    const section = style.sections && style.sections[def.id];
    if (section && section.config) {
      applyConfigToTarget(meta.config, section.config);
      syncInputs(meta);
      scheduleRefreshForMeta(meta, { forceRebuild: true });
    }
    const strength = Number(section && section.strength);
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
  return clamp(pct / 100, CENTER_THICKEN_LIMITS.min / 100, CENTER_THICKEN_LIMITS.max / 100);
}

export function getEdgeThinFactor() {
  const pct = getEdgeThinPercent();
  return clamp(pct / 100, EDGE_THIN_LIMITS.min / 100, EDGE_THIN_LIMITS.max / 100);
}

export function getInkSectionStrength(sectionId) {
  switch (sectionId) {
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
  if (sectionId === 'grain') return strength > 0 && GRAIN_CFG.enabled !== false;
  if (sectionId === 'texture') return strength > 0 && INK_TEXTURE.enabled !== false;
  if (sectionId === 'fuzz') return strength > 0 && EDGE_FUZZ.enabled !== false;
  if (sectionId === 'bleed') return strength > 0 && EDGE_BLEED.enabled !== false;
  return strength > 0;
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

function syncCenterThickenUI() {
  const pct = getCenterThickenPercent();
  if (panelState.centerThickenSlider && panelState.centerThickenSlider.value !== String(pct)) {
    panelState.centerThickenSlider.value = String(pct);
  }
  if (panelState.centerThickenNumberInput && panelState.centerThickenNumberInput.value !== String(pct)) {
    panelState.centerThickenNumberInput.value = String(pct);
  }
}

function setCenterThickenPercent(percent, options = {}) {
  const { silent = false, syncUI = true } = options || {};
  const raw = Number(percent);
  const pct = clamp(
    Number.isFinite(raw) ? Math.round(raw) : CENTER_THICKEN_LIMITS.defaultPct,
    CENTER_THICKEN_LIMITS.min,
    CENTER_THICKEN_LIMITS.max,
  );
  setScalarOnState('centerThickenPct', pct, CENTER_THICKEN_LIMITS.min, CENTER_THICKEN_LIMITS.max);
  if (syncUI) syncCenterThickenUI();
  if (!silent) scheduleGlyphRefresh();
  persistPanelState();
  return pct;
}

function syncEdgeThinUI() {
  const pct = getEdgeThinPercent();
  if (panelState.edgeThinSlider && panelState.edgeThinSlider.value !== String(pct)) {
    panelState.edgeThinSlider.value = String(pct);
  }
  if (panelState.edgeThinNumberInput && panelState.edgeThinNumberInput.value !== String(pct)) {
    panelState.edgeThinNumberInput.value = String(pct);
  }
}

function setEdgeThinPercent(percent, options = {}) {
  const { silent = false, syncUI = true } = options || {};
  const raw = Number(percent);
  const pct = clamp(
    Number.isFinite(raw) ? Math.round(raw) : EDGE_THIN_LIMITS.defaultPct,
    EDGE_THIN_LIMITS.min,
    EDGE_THIN_LIMITS.max,
  );
  setScalarOnState('edgeThinPct', pct, EDGE_THIN_LIMITS.min, EDGE_THIN_LIMITS.max);
  if (syncUI) syncEdgeThinUI();
  if (!silent) scheduleGlyphRefresh();
  persistPanelState();
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
    syncCenterThickenUI();
    syncEdgeThinUI();
    panelState.metas.forEach(meta => {
      if (!meta) return;
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
  if (sectionId === 'centerThicken') {
    syncCenterThickenUI();
    return;
  }
  if (sectionId === 'edgeThin') {
    syncEdgeThinUI();
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
  panelState.centerThickenSlider = document.getElementById('inkCenterThickenSlider');
  panelState.centerThickenNumberInput = document.getElementById('inkCenterThickenNumber');
  panelState.edgeThinSlider = document.getElementById('inkEdgeThinSlider');
  panelState.edgeThinNumberInput = document.getElementById('inkEdgeThinNumber');
  panelState.styleNameInput = document.getElementById('inkStyleNameInput');
  panelState.saveStyleButton = document.getElementById('inkStyleSaveBtn');
  panelState.stylesList = document.getElementById('inkStylesList');
  panelState.exportButton = document.getElementById('inkStyleExportBtn');
  panelState.importButton = document.getElementById('inkStyleImportBtn');
  panelState.importInput = document.getElementById('inkStyleImportInput');

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
  if (panelState.centerThickenSlider) {
    panelState.centerThickenSlider.min = String(CENTER_THICKEN_LIMITS.min);
    panelState.centerThickenSlider.max = String(CENTER_THICKEN_LIMITS.max);
    panelState.centerThickenSlider.step = '1';
    panelState.centerThickenSlider.value = String(getCenterThickenPercent());
    panelState.centerThickenSlider.addEventListener('input', () => {
      const raw = Number.parseFloat(panelState.centerThickenSlider.value);
      setCenterThickenPercent(raw);
    });
  }
  if (panelState.centerThickenNumberInput) {
    panelState.centerThickenNumberInput.min = String(CENTER_THICKEN_LIMITS.min);
    panelState.centerThickenNumberInput.max = String(CENTER_THICKEN_LIMITS.max);
    panelState.centerThickenNumberInput.step = '1';
    panelState.centerThickenNumberInput.value = String(getCenterThickenPercent());
    panelState.centerThickenNumberInput.addEventListener('input', () => {
      const raw = Number.parseFloat(panelState.centerThickenNumberInput.value);
      if (!Number.isFinite(raw)) return;
      setCenterThickenPercent(raw, { syncUI: false });
      syncCenterThickenUI();
    });
    panelState.centerThickenNumberInput.addEventListener('blur', () => {
      if (panelState.centerThickenNumberInput.value !== '') return;
      syncCenterThickenUI();
    });
  }
  if (panelState.edgeThinSlider) {
    panelState.edgeThinSlider.min = String(EDGE_THIN_LIMITS.min);
    panelState.edgeThinSlider.max = String(EDGE_THIN_LIMITS.max);
    panelState.edgeThinSlider.step = '1';
    panelState.edgeThinSlider.value = String(getEdgeThinPercent());
    panelState.edgeThinSlider.addEventListener('input', () => {
      const raw = Number.parseFloat(panelState.edgeThinSlider.value);
      setEdgeThinPercent(raw);
    });
  }
  if (panelState.edgeThinNumberInput) {
    panelState.edgeThinNumberInput.min = String(EDGE_THIN_LIMITS.min);
    panelState.edgeThinNumberInput.max = String(EDGE_THIN_LIMITS.max);
    panelState.edgeThinNumberInput.step = '1';
    panelState.edgeThinNumberInput.value = String(getEdgeThinPercent());
    panelState.edgeThinNumberInput.addEventListener('input', () => {
      const raw = Number.parseFloat(panelState.edgeThinNumberInput.value);
      if (!Number.isFinite(raw)) return;
      setEdgeThinPercent(raw, { syncUI: false });
      syncEdgeThinUI();
    });
    panelState.edgeThinNumberInput.addEventListener('blur', () => {
      if (panelState.edgeThinNumberInput.value !== '') return;
      syncEdgeThinUI();
    });
  }
  syncOverallStrengthUI();
  syncCenterThickenUI();
  syncEdgeThinUI();

  if (sectionsRoot) {
    SECTION_DEFS.forEach(def => {
      const meta = buildSection(def, sectionsRoot);
      if (meta.applyBtn) {
        meta.applyBtn.addEventListener('click', () => applySection(meta));
      }
      syncInputs(meta);
    });
  }

  panelState.initialized = true;
  syncInkStrengthDisplays();
}

export function refreshSavedInkStylesUI() {
  renderSavedStylesList();
}
