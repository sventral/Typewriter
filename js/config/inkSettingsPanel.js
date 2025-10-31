import { EDGE_BLEED, EDGE_FUZZ, GRAIN_CFG, INK_TEXTURE, POWDER_EFFECT } from './inkConfig.js';

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const SECTION_DEFS = [
  {
    id: 'powder',
    label: 'Powder',
    config: POWDER_EFFECT,
    keyOrder: ['powderStrength', 'powderGrainScale', 'powderEdgeFalloff', 'powderCoherence'],
    trigger: 'glyph',
    supportsToggle: false,
  },
  {
    id: 'texture',
    label: 'Texture',
    config: INK_TEXTURE,
    keyOrder: ['supersample', 'noiseOctaves', 'noiseStrength', 'noiseFloor', 'chip', 'scratch', 'jitterSeed', 'textureStrength', 'textureVoidsBias'],
    trigger: 'glyph',
    supportsToggle: false,
  },
  {
    id: 'fuzz',
    label: 'Edge fuzz',
    config: EDGE_FUZZ,
    keyOrder: ['fuzzWidthPx', 'fuzzInwardShare', 'fuzzRoughness', 'fuzzFrequency', 'fuzzOpacity'],
    trigger: 'glyph',
    supportsToggle: false,
  },
  {
    id: 'bleed',
    label: 'Bleed',
    config: EDGE_BLEED,
    keyOrder: ['inks', 'passes'],
    trigger: 'glyph',
    supportsToggle: false,
  },
  {
    id: 'grain',
    label: 'Grain',
    config: GRAIN_CFG,
    keyOrder: ['base_scale_from_char_w', 'octave_rel_scales', 'octave_weights', 'pixel_hash_weight', 'post_gamma', 'alpha', 'seeds', 'composite_op'],
    trigger: 'grain',
    supportsToggle: true,
  }
];

const panelState = {
  overall: 1,
  effectStrengths: {
    powder: 0,
    texture: 1,
    fuzz: 0,
    bleed: 1,
  },
  sections: {
    grain: GRAIN_CFG.enabled !== false,
  },
  callbacks: {
    refreshGlyphs: null,
    refreshGrain: null,
    saveState: null,
  },
  metas: [],
  initialized: false,
  sliderControls: new Map(),
  appState: null,
};

const EFFECT_CONFIG = {
  powder: { config: POWDER_EFFECT, stateKey: 'inkPowderStrength' },
  texture: { config: INK_TEXTURE, stateKey: 'inkTextureStrength' },
  fuzz: { config: EDGE_FUZZ, stateKey: 'inkFuzzStrength' },
  bleed: { config: EDGE_BLEED, stateKey: 'inkBleedStrength' },
};

const EFFECT_IDS = Object.keys(EFFECT_CONFIG);

const EFFECT_SLIDER_IDS = {
  overall: { slider: 'inkEffectsOverallSlider', value: 'inkEffectsOverallValue' },
  powder: { slider: 'inkEffectsPowderSlider', value: 'inkEffectsPowderValue' },
  texture: { slider: 'inkEffectsTextureSlider', value: 'inkEffectsTextureValue' },
  fuzz: { slider: 'inkEffectsFuzzSlider', value: 'inkEffectsFuzzValue' },
  bleed: { slider: 'inkEffectsBleedSlider', value: 'inkEffectsBleedValue' },
};

function clamp01(value) {
  return clamp(Number(value) || 0, 0, 1);
}

function setPanelStateFromApp(appState) {
  panelState.appState = appState || null;
  const src = appState || {};
  panelState.overall = clamp01(src.inkEffectsOverall ?? panelState.overall ?? 1);
  panelState.effectStrengths.powder = clamp01(src.inkPowderStrength ?? panelState.effectStrengths.powder);
  panelState.effectStrengths.texture = clamp01(src.inkTextureStrength ?? panelState.effectStrengths.texture);
  panelState.effectStrengths.fuzz = clamp01(src.inkFuzzStrength ?? panelState.effectStrengths.fuzz);
  panelState.effectStrengths.bleed = clamp01(src.inkBleedStrength ?? panelState.effectStrengths.bleed);
  if (panelState.appState && Number.isFinite(src.inkTextureVoidsBias)) {
    panelState.appState.inkTextureVoidsBias = clamp(Number(src.inkTextureVoidsBias), -1, 1);
  }
  EFFECT_IDS.forEach((id) => {
    const cfg = EFFECT_CONFIG[id]?.config;
    if (cfg && typeof cfg === 'object') {
      cfg.enabled = panelState.effectStrengths[id] > 0;
    }
  });
  panelState.sections.grain = GRAIN_CFG.enabled !== false;
}

function persistEffectToApp(effectId, normalized) {
  const map = EFFECT_CONFIG[effectId];
  if (!map || !panelState.appState) return;
  const key = map.stateKey;
  if (key) {
    panelState.appState[key] = clamp01(normalized);
  }
  if (effectId === 'texture' && Number.isFinite(panelState.appState.inkTextureVoidsBias)) {
    panelState.appState.inkTextureVoidsBias = clamp(Number(panelState.appState.inkTextureVoidsBias), -1, 1);
  }
}

function applyEffectStrength(effectId, normalized) {
  const cfgEntry = EFFECT_CONFIG[effectId];
  if (!cfgEntry) return;
  const sanitized = clamp01(normalized);
  if (panelState.effectStrengths[effectId] === sanitized) return;
  panelState.effectStrengths[effectId] = sanitized;
  if (cfgEntry.config) {
    cfgEntry.config.enabled = sanitized > 0;
  }
  persistEffectToApp(effectId, sanitized);
  if (typeof panelState.callbacks.refreshGlyphs === 'function') {
    panelState.callbacks.refreshGlyphs();
  }
  if (typeof panelState.callbacks.saveState === 'function') {
    panelState.callbacks.saveState();
  }
}

function applyOverallStrength(normalized) {
  const clamped = clamp01(normalized);
  if (panelState.overall === clamped) return;
  panelState.overall = clamped;
  if (panelState.appState) {
    panelState.appState.inkEffectsOverall = clamped;
  }
  if (typeof panelState.callbacks.refreshGlyphs === 'function') {
    panelState.callbacks.refreshGlyphs();
  }
  if (typeof panelState.callbacks.refreshGrain === 'function') {
    panelState.callbacks.refreshGrain();
  }
  if (typeof panelState.callbacks.saveState === 'function') {
    panelState.callbacks.saveState();
  }
}

function effectStrengthDisplay(effectId) {
  return Math.round(clamp01(panelState.effectStrengths[effectId] || 0) * 100);
}

function syncOverallSlider() {
  const control = panelState.sliderControls.get('overall');
  if (!control) return;
  const pct = Math.round(clamp(panelState.overall, 0, 1) * 100);
  if (control.input) control.input.value = String(pct);
  if (control.valueEl) control.valueEl.textContent = `${pct}%`;
}

function syncEffectSlider(effectId) {
  const control = panelState.sliderControls.get(effectId);
  if (!control) return;
  const pct = effectStrengthDisplay(effectId);
  if (control.input) control.input.value = String(pct);
  if (control.valueEl) control.valueEl.textContent = `${pct}%`;
  if (control.input) control.input.disabled = panelState.overall <= 0;
}

function syncEffectSliders() {
  EFFECT_IDS.forEach(syncEffectSlider);
}

const HEX_MATCH_RE = /seed|hash/i;

function isHexField(path) {
  return HEX_MATCH_RE.test(path || '');
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

function formatNumber(value, path) {
  if (isHexField(path)) return toHex(value);
  if (Number.isInteger(value)) return String(value);
  return String(value);
}

function formatString(value) {
  return `'${String(value).replace(/'/g, "\\'")}'`;
}

function formatValue(value, indent, path) {
  if (Array.isArray(value)) return formatArray(value, indent, path);
  if (value && typeof value === 'object') return formatObject(value, indent, path);
  if (typeof value === 'string') return formatString(value);
  if (typeof value === 'number') return formatNumber(value, path);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return 'null';
}

function formatArray(arr, indent, path) {
  if (arr.length === 0) return '[]';
  const indentStr = '  '.repeat(indent);
  const nextIndent = indent + 1;
  const nextIndentStr = '  '.repeat(nextIndent);
  const isPrimitive = arr.every(v => !(v && typeof v === 'object'));
  if (isPrimitive) {
    const items = arr.map((v, idx) => formatValue(v, nextIndent, `${path}[${idx}]`));
    return `[${items.join(', ')}]`;
  }
  const lines = arr.map((item, idx) => `${nextIndentStr}${formatValue(item, nextIndent, `${path}[${idx}]`)}`);
  return `[\n${lines.join(',\n')}\n${indentStr}]`;
}

function getObjectKeys(path, obj) {
  if (!obj) return [];
  switch (path) {
    case 'chip':
      return ['density', 'strength', 'feather', 'seed'];
    case 'scratch':
      return ['direction', 'scale', 'aspect', 'threshold', 'strength', 'seed'];
    case 'scratch.direction':
      return ['x', 'y'];
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

function formatObject(obj, indent, path) {
  const keys = getObjectKeys(path, obj);
  const indentStr = '  '.repeat(indent);
  const nextIndent = indent + 1;
  const nextIndentStr = '  '.repeat(nextIndent);
  const entries = keys.map(key => {
    const nextPath = path && path.endsWith('[]') ? `${path.slice(0, -2)}.${key}` : (path ? `${path}.${key}` : key);
    const val = obj[key];
    return `${nextIndentStr}${key}: ${formatValue(val, nextIndent, nextPath)}`;
  });
  const singleLine = entries.length && entries.every(line => !line.includes('\n'));
  if (singleLine && entries.length <= 3) {
    return `{ ${entries.map(line => line.trim()).join(', ')} }`;
  }
  return `{\n${entries.join(',\n')}\n${indentStr}}`;
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

function buildSection(def, root) {
  const sectionEl = document.createElement('section');
  sectionEl.className = 'ink-section';

  const header = document.createElement('div');
  header.className = 'ink-section-header';
  const title = document.createElement('h4');
  title.textContent = def.label;
  header.appendChild(title);

  let toggle = null;
  if (def.supportsToggle !== false) {
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'ink-section-toggle';
    toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = def.id === 'grain' ? panelState.sections.grain : !!def.config.enabled;
    toggleLabel.appendChild(toggle);
    const toggleText = document.createElement('span');
    toggleText.textContent = 'On';
    toggleLabel.appendChild(toggleText);
    header.appendChild(toggleLabel);
  }

  sectionEl.appendChild(header);

  const body = document.createElement('div');
  body.className = 'ink-section-body';
  const meta = {
    id: def.id,
    config: def.config,
    trigger: def.trigger,
    root: sectionEl,
    inputs: new Map(),
    toggle,
    applyBtn: null
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
  return meta;
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
  if (meta.id === 'texture' && panelState.appState) {
    const bias = Number(INK_TEXTURE.textureVoidsBias ?? panelState.appState.inkTextureVoidsBias ?? 0);
    panelState.appState.inkTextureVoidsBias = clamp(bias, -1, 1);
  }
  if (['powder', 'texture', 'fuzz', 'bleed'].includes(meta.id)) {
    if (typeof panelState.callbacks.refreshGlyphs === 'function') panelState.callbacks.refreshGlyphs();
    if (typeof panelState.callbacks.saveState === 'function') panelState.callbacks.saveState();
  }
  if (meta.id === 'grain') {
    if (typeof panelState.callbacks.refreshGrain === 'function') panelState.callbacks.refreshGrain();
    if (typeof panelState.callbacks.saveState === 'function') panelState.callbacks.saveState();
  }
  syncInputs(meta);
}

function formatConfigExport() {
  const parts = [
    `export const POWDER_EFFECT = ${formatValue(POWDER_EFFECT, 0, 'POWDER_EFFECT')};`,
    '',
    `export const INK_TEXTURE = ${formatValue(INK_TEXTURE, 0, 'INK_TEXTURE')};`,
    '',
    `export const EDGE_FUZZ = ${formatValue(EDGE_FUZZ, 0, 'EDGE_FUZZ')};`,
    '',
    `export const EDGE_BLEED = ${formatValue(EDGE_BLEED, 0, 'EDGE_BLEED')};`,
    '',
    `export const GRAIN_CFG = ${formatValue(GRAIN_CFG, 0, 'GRAIN_CFG')};`
  ];
  return `${parts.join('\n')}\n`;
}

function copyConfigToClipboard(button) {
  const text = formatConfigExport();
  const done = () => {
    if (!button) return;
    const original = button.textContent;
    button.textContent = 'Copied!';
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  };
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, button));
  } else {
    fallbackCopy(text, button);
  }
}

function fallbackCopy(text, button) {
  try {
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.setAttribute('readonly', '');
    temp.style.position = 'absolute';
    temp.style.left = '-9999px';
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    temp.remove();
    if (button) {
      const original = button.textContent;
      button.textContent = 'Copied!';
      button.disabled = true;
      setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
      }, 1200);
    }
  } catch {}
}

export function getInkEffectFactor() {
  return clamp(panelState.overall, 0, 1);
}

export function getPowderEffectStrength() {
  return clamp(panelState.effectStrengths.powder || 0, 0, 1) * getInkEffectFactor();
}

export function getTextureEffectStrength() {
  return clamp01(panelState.effectStrengths.texture || 0) * getInkEffectFactor();
}

export function getFuzzEffectStrength() {
  return clamp(panelState.effectStrengths.fuzz || 0, 0, 1) * getInkEffectFactor();
}

export function getBleedEffectStrength() {
  return clamp(panelState.effectStrengths.bleed || 0, 0, 1) * getInkEffectFactor();
}

export function getTextureVoidsBias() {
  return clamp(Number(panelState.appState?.inkTextureVoidsBias ?? 0), -1, 1);
}

export function isInkSectionEnabled(sectionId) {
  if (sectionId === 'grain') return !!panelState.sections.grain && GRAIN_CFG.enabled !== false && getInkEffectFactor() > 0;
  if (sectionId === 'powder') return POWDER_EFFECT.enabled !== false && getPowderEffectStrength() > 0;
  if (sectionId === 'texture') return INK_TEXTURE.enabled !== false && getTextureEffectStrength() > 0;
  if (sectionId === 'fuzz') return EDGE_FUZZ.enabled !== false && getFuzzEffectStrength() > 0;
  if (sectionId === 'bleed') return EDGE_BLEED.enabled !== false && getBleedEffectStrength() > 0;
  return getInkEffectFactor() > 0;
}

function setOverallStrength(percent) {
  const pct = clamp(Number(percent) || 0, 0, 100);
  applyOverallStrength(pct / 100);
  return pct;
}

export function setupInkSettingsPanel(options = {}) {
  if (panelState.initialized) return;
  const {
    refreshGlyphs,
    refreshGrain,
    saveStateDebounced,
    state: appState,
  } = options;
  panelState.callbacks.refreshGlyphs = typeof refreshGlyphs === 'function' ? refreshGlyphs : null;
  panelState.callbacks.refreshGrain = typeof refreshGrain === 'function' ? refreshGrain : null;
  panelState.callbacks.saveState = typeof saveStateDebounced === 'function' ? () => saveStateDebounced() : null;

  setPanelStateFromApp(appState);

  const sectionsRoot = document.getElementById('inkSettingsSections');
  const copyBtn = document.getElementById('inkSettingsCopyBtn');
  if (!sectionsRoot) return;

  const registerSlider = (key, onInput) => {
    const ids = EFFECT_SLIDER_IDS[key];
    if (!ids) return;
    const input = document.getElementById(ids.slider);
    const valueEl = document.getElementById(ids.value);
    panelState.sliderControls.set(key, { input, valueEl });
    if (input && typeof onInput === 'function') {
      input.addEventListener('input', () => {
        const pct = clamp(Number(input.value) || 0, 0, 100);
        onInput(pct / 100, pct);
      });
    }
  };

  registerSlider('overall', (normalized, pct) => {
    applyOverallStrength(normalized);
    syncOverallSlider();
    syncEffectSliders();
  });

  EFFECT_IDS.forEach((effectId) => {
    registerSlider(effectId, (normalized) => {
      applyEffectStrength(effectId, normalized);
      syncEffectSlider(effectId);
    });
  });

  SECTION_DEFS.forEach(def => {
    const meta = buildSection(def, sectionsRoot);
    if (meta.toggle) {
      meta.toggle.addEventListener('change', () => {
        if (meta.id === 'grain') {
          panelState.sections.grain = !!meta.toggle.checked;
          GRAIN_CFG.enabled = panelState.sections.grain;
          meta.root.classList.toggle('is-disabled', !panelState.sections.grain);
          if (typeof panelState.callbacks.refreshGrain === 'function') panelState.callbacks.refreshGrain();
          if (typeof panelState.callbacks.saveState === 'function') panelState.callbacks.saveState();
        }
      });
    }
    meta.applyBtn.addEventListener('click', () => applySection(meta));
    const isEnabled = def.id === 'grain'
      ? panelState.sections.grain
      : def.config?.enabled !== false;
    meta.root.classList.toggle('is-disabled', !isEnabled);
    syncInputs(meta);
  });

  syncOverallSlider();
  syncEffectSliders();

  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyConfigToClipboard(copyBtn));
  }

  panelState.initialized = true;
}
