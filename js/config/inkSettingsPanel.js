import { EDGE_BLEED, EDGE_FUZZ, GRAIN_CFG, INK_TEXTURE, POWDER_EFFECT } from './inkConfig.js';

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const clamp01 = (value) => clamp(Number(value) || 0, 0, 1);
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

function syncConfigInputs(meta) {
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

function applyConfig(meta) {
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
  if (meta.id === 'textureConfig' && panelState.appState) {
    const bias = Number(INK_TEXTURE.textureVoidsBias ?? panelState.appState.inkTextureVoidsBias ?? 0);
    panelState.appState.inkTextureVoidsBias = clamp(bias, -1, 1);
  }
  if (['powderConfig', 'textureConfig', 'fuzzConfig', 'bleedConfig'].includes(meta.id)) {
    if (typeof panelState.callbacks.refreshGlyphs === 'function') panelState.callbacks.refreshGlyphs();
    if (typeof panelState.callbacks.saveState === 'function') panelState.callbacks.saveState();
  }
  if (meta.id === 'grainConfig') {
    if (typeof panelState.callbacks.refreshGrain === 'function') panelState.callbacks.refreshGrain();
    if (typeof panelState.callbacks.saveState === 'function') panelState.callbacks.saveState();
  }
  syncConfigInputs(meta);
}

const panelState = {
  overall: 1,
  sectionStrengths: { interior: 1, edge: 1 },
  effectStrengths: { powder: 0, texture: 1, fuzz: 0, bleed: 1 },
  sliderControls: new Map(),
  metas: [],
  callbacks: { refreshGlyphs: null, refreshGrain: null, saveState: null },
  initialized: false,
  appState: null,
  themeGateState: { preferWhite: false, inks: [] },
  themeGateEl: null,
  seedOutputEls: { grain: null, alt: null },
};

const EFFECT_CONFIG = {
  powder: { config: POWDER_EFFECT, stateKey: 'inkPowderStrength', section: 'interior' },
  texture: { config: INK_TEXTURE, stateKey: 'inkTextureStrength', section: 'interior' },
  fuzz: { config: EDGE_FUZZ, stateKey: 'inkFuzzStrength', section: 'edge' },
  bleed: { config: EDGE_BLEED, stateKey: 'inkBleedStrength', section: 'edge' },
};

const SECTION_STATE_KEYS = {
  interior: 'inkInteriorStrength',
  edge: 'inkEdgeStrength',
};

function setPanelStateFromApp(appState) {
  panelState.appState = appState || null;
  const src = panelState.appState || {};
  panelState.overall = clamp01(src.inkEffectsOverall ?? panelState.overall ?? 1);
  panelState.sectionStrengths.interior = clamp01(src.inkInteriorStrength ?? panelState.sectionStrengths.interior ?? 1);
  panelState.sectionStrengths.edge = clamp01(src.inkEdgeStrength ?? panelState.sectionStrengths.edge ?? 1);
  panelState.effectStrengths.powder = clamp01(src.inkPowderStrength ?? panelState.effectStrengths.powder);
  panelState.effectStrengths.texture = clamp01(src.inkTextureStrength ?? panelState.effectStrengths.texture);
  panelState.effectStrengths.fuzz = clamp01(src.inkFuzzStrength ?? panelState.effectStrengths.fuzz);
  panelState.effectStrengths.bleed = clamp01(src.inkBleedStrength ?? panelState.effectStrengths.bleed);
  if (panelState.appState && Number.isFinite(src.inkTextureVoidsBias)) {
    panelState.appState.inkTextureVoidsBias = clamp(Number(src.inkTextureVoidsBias), -1, 1);
  }
  panelState.themeGateState = {
    preferWhite: !!src.inkEffectsPreferWhite,
    inks: Array.isArray(EDGE_BLEED.inks) ? [...EDGE_BLEED.inks] : [],
  };
  syncConfigEnabled();
}

function persistEffectToApp(effectId, normalized) {
  const map = EFFECT_CONFIG[effectId];
  if (!map || !panelState.appState) return;
  panelState.appState[map.stateKey] = normalized;
  if (effectId === 'texture' && Number.isFinite(panelState.appState.inkTextureVoidsBias)) {
    panelState.appState.inkTextureVoidsBias = clamp(Number(panelState.appState.inkTextureVoidsBias), -1, 1);
  }
}

function persistSectionStrengthToApp(sectionId, normalized) {
  if (!panelState.appState) return;
  const key = SECTION_STATE_KEYS[sectionId];
  if (key) panelState.appState[key] = normalized;
}

function syncConfigEnabled() {
  const overall = clamp01(panelState.overall);
  const interior = overall > 0 ? clamp01(panelState.sectionStrengths.interior) : 0;
  const edge = overall > 0 ? clamp01(panelState.sectionStrengths.edge) : 0;
  POWDER_EFFECT.enabled = interior > 0 && clamp01(panelState.effectStrengths.powder) > 0;
  INK_TEXTURE.enabled = interior > 0 && clamp01(panelState.effectStrengths.texture) > 0;
  EDGE_FUZZ.enabled = edge > 0 && clamp01(panelState.effectStrengths.fuzz) > 0;
  EDGE_BLEED.enabled = edge > 0 && clamp01(panelState.effectStrengths.bleed) > 0;
}

function applyEffectStrength(effectId, normalized) {
  const cfg = EFFECT_CONFIG[effectId];
  if (!cfg) return;
  const max = effectId === 'texture' ? 1.5 : 1;
  const sanitized = clamp(Number(normalized) || 0, 0, max);
  if (panelState.effectStrengths[effectId] === sanitized) return;
  panelState.effectStrengths[effectId] = sanitized;
  persistEffectToApp(effectId, sanitized);
  syncConfigEnabled();
  if (typeof panelState.callbacks.refreshGlyphs === 'function') panelState.callbacks.refreshGlyphs();
  if (typeof panelState.callbacks.saveState === 'function') panelState.callbacks.saveState();
}

function applySectionStrength(sectionId, normalized) {
  const key = SECTION_STATE_KEYS[sectionId];
  if (!key) return;
  const value = clamp01(normalized);
  if (panelState.sectionStrengths[sectionId] === value) return;
  panelState.sectionStrengths[sectionId] = value;
  persistSectionStrengthToApp(sectionId, value);
  syncConfigEnabled();
  if (typeof panelState.callbacks.refreshGlyphs === 'function') panelState.callbacks.refreshGlyphs();
  if (sectionId === 'interior' && typeof panelState.callbacks.refreshGrain === 'function') panelState.callbacks.refreshGrain();
  if (typeof panelState.callbacks.saveState === 'function') panelState.callbacks.saveState();
}

function applyOverallStrength(normalized) {
  const clamped = clamp01(normalized);
  if (panelState.overall === clamped) return;
  panelState.overall = clamped;
  if (panelState.appState) {
    panelState.appState.inkEffectsOverall = clamped;
  }
  syncConfigEnabled();
  if (typeof panelState.callbacks.refreshGlyphs === 'function') panelState.callbacks.refreshGlyphs();
  if (typeof panelState.callbacks.refreshGrain === 'function') panelState.callbacks.refreshGrain();
  if (typeof panelState.callbacks.saveState === 'function') panelState.callbacks.saveState();
}

function getSectionStrength(sectionId) {
  return clamp01(panelState.sectionStrengths[sectionId] ?? 1);
}

function defaultFormat(value) {
  return `${Math.round(value)}%`;
}

function registerSlider(key, { input, valueEl, min = 0, max = 100, step = 1, getSliderValue, onSliderChange, formatValue = defaultFormat, disabledWhen = null }) {
  if (!input) return;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  panelState.sliderControls.set(key, { input, valueEl, min, max, getSliderValue, onSliderChange, formatValue, disabledWhen });
  input.addEventListener('input', () => {
    const raw = Number(input.value);
    const clamped = clamp(raw, min, max);
    if (clamped !== raw) input.value = String(clamped);
    if (typeof onSliderChange === 'function') onSliderChange(clamped);
    if (valueEl) valueEl.textContent = formatValue(clamped);
    syncAllSliders();
  });
}

function syncSlider(key) {
  const control = panelState.sliderControls.get(key);
  if (!control) return;
  const { input, valueEl, min, max, getSliderValue, formatValue, disabledWhen } = control;
  if (typeof getSliderValue === 'function') {
    let sliderValue = Number(getSliderValue());
    if (!Number.isFinite(sliderValue)) sliderValue = min;
    sliderValue = clamp(sliderValue, min, max);
    if (input) input.value = String(sliderValue);
    if (valueEl) valueEl.textContent = formatValue(sliderValue);
  }
  if (input) input.disabled = typeof disabledWhen === 'function' ? !!disabledWhen() : false;
}

function syncAllSliders() {
  for (const key of panelState.sliderControls.keys()) {
    syncSlider(key);
  }
}

function createSliderRow({ id, label, key, min = 0, max = 100, step = 1, getValue, onChange, formatValue = defaultFormat, disabledWhen }) {
  const row = document.createElement('div');
  row.className = 'control-row';
  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', id);
  labelEl.textContent = label;
  row.appendChild(labelEl);
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'slider-control';
  const input = document.createElement('input');
  input.type = 'range';
  input.id = id;
  input.className = 'ink-slider';
  const valueEl = document.createElement('span');
  valueEl.className = 'slider-value';
  sliderWrap.appendChild(input);
  sliderWrap.appendChild(valueEl);
  row.appendChild(sliderWrap);
  registerSlider(key, {
    input,
    valueEl,
    min,
    max,
    step,
    getSliderValue: getValue,
    onSliderChange: onChange,
    formatValue,
    disabledWhen,
  });
  return row;
}

function buildConfigGroup(def, container) {
  const group = document.createElement('div');
  group.className = 'ink-subgroup';
  if (def.label) {
    const heading = document.createElement('div');
    heading.className = 'ink-subheading';
    heading.textContent = def.label;
    group.appendChild(heading);
  }
  const meta = {
    id: def.id,
    config: def.config,
    trigger: def.trigger || 'glyph',
    root: group,
    inputs: new Map(),
    applyBtn: null,
  };
  def.keyOrder.forEach(key => {
    const value = def.config[key];
    const path = key;
    if (Array.isArray(value)) {
      buildArrayControls(meta, group, value, path, key);
      return;
    }
    if (value && typeof value === 'object') {
      buildObjectControls(meta, group, value, path, key);
      return;
    }
    const input = createInputForValue(value, path);
    if (typeof value === 'string') input.dataset.string = '1';
    const row = buildControlRow(key, input);
    group.appendChild(row);
    meta.inputs.set(path, input);
  });
  const applyRow = document.createElement('div');
  applyRow.className = 'control-row ink-section-apply-row';
  applyRow.appendChild(document.createElement('div'));
  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn apply-btn';
  applyBtn.textContent = 'Apply';
  applyRow.appendChild(applyBtn);
  group.appendChild(applyRow);
  meta.applyBtn = applyBtn;
  panelState.metas.push(meta);
  applyBtn.addEventListener('click', () => applyConfig(meta));
  syncConfigInputs(meta);
  container.appendChild(group);
  return group;
}

function createSection(title) {
  const sectionEl = document.createElement('section');
  sectionEl.className = 'ink-section';
  const header = document.createElement('div');
  header.className = 'ink-section-header';
  const heading = document.createElement('h4');
  heading.textContent = title;
  header.appendChild(heading);
  sectionEl.appendChild(header);
  const body = document.createElement('div');
  body.className = 'ink-section-body';
  sectionEl.appendChild(body);
  return { sectionEl, header, body };
}

function buildInteriorSection(root) {
  const { sectionEl, body } = createSection('Ink (interior)');
  const strengthRow = createSliderRow({
    id: 'inkInteriorStrengthSlider',
    label: 'Strength',
    key: 'section:interior',
    getValue: () => Math.round(getSectionStrength('interior') * 100),
    onChange: (value) => applySectionStrength('interior', value / 100),
  });
  strengthRow.classList.add('strength-slider');
  body.appendChild(strengthRow);

  const powderSlider = createSliderRow({
    id: 'inkPowderStrengthSlider',
    label: 'Powder mix',
    key: 'effect:powder',
    getValue: () => Math.round(clamp01(panelState.effectStrengths.powder) * 100),
    onChange: (value) => applyEffectStrength('powder', value / 100),
    disabledWhen: () => getSectionStrength('interior') <= 0 || getInkEffectFactor() <= 0,
  });
  powderSlider.classList.add('effect-slider');
  body.appendChild(powderSlider);

  const textureSlider = createSliderRow({
    id: 'inkTextureStrengthSlider',
    label: 'Texture mix',
    key: 'effect:texture',
    getValue: () => Math.round(clamp01(panelState.effectStrengths.texture) * 100),
    onChange: (value) => applyEffectStrength('texture', value / 100),
    disabledWhen: () => getSectionStrength('interior') <= 0 || getInkEffectFactor() <= 0,
  });
  textureSlider.classList.add('effect-slider');
  body.appendChild(textureSlider);

  buildConfigGroup({
    id: 'powderConfig',
    label: 'Powder parameters',
    config: POWDER_EFFECT,
    keyOrder: ['powderStrength', 'powderGrainScale', 'powderCoherence', 'powderEdgeFalloff'],
    trigger: 'glyph',
  }, body);

  buildConfigGroup({
    id: 'textureConfig',
    label: 'Texture',
    config: INK_TEXTURE,
    keyOrder: ['textureStrength', 'textureVoidsBias', 'supersample', 'noiseOctaves', 'noiseStrength', 'noiseFloor', 'chip', 'scratch', 'jitterSeed'],
    trigger: 'glyph',
  }, body);

  buildConfigGroup({
    id: 'grainConfig',
    label: 'Grain overlay',
    config: GRAIN_CFG,
    keyOrder: ['base_scale_from_char_w', 'octave_rel_scales', 'octave_weights', 'pixel_hash_weight', 'post_gamma', 'alpha', 'seeds', 'composite_op'],
    trigger: 'grain',
  }, body);

  root.appendChild(sectionEl);
}

function buildEdgeSection(root) {
  const { sectionEl, body } = createSection('Edge');
  const strengthRow = createSliderRow({
    id: 'inkEdgeStrengthSlider',
    label: 'Strength',
    key: 'section:edge',
    getValue: () => Math.round(getSectionStrength('edge') * 100),
    onChange: (value) => applySectionStrength('edge', value / 100),
  });
  strengthRow.classList.add('strength-slider');
  body.appendChild(strengthRow);

  const fuzzSlider = createSliderRow({
    id: 'inkFuzzStrengthSlider',
    label: 'Fuzz strength',
    key: 'effect:fuzz',
    getValue: () => Math.round(clamp01(panelState.effectStrengths.fuzz) * 100),
    onChange: (value) => applyEffectStrength('fuzz', value / 100),
    disabledWhen: () => getSectionStrength('edge') <= 0 || getInkEffectFactor() <= 0,
  });
  fuzzSlider.classList.add('effect-slider');
  body.appendChild(fuzzSlider);

  const bleedSlider = createSliderRow({
    id: 'inkBleedStrengthSlider',
    label: 'Halo strength',
    key: 'effect:bleed',
    getValue: () => Math.round(clamp01(panelState.effectStrengths.bleed) * 100),
    onChange: (value) => applyEffectStrength('bleed', value / 100),
    disabledWhen: () => getSectionStrength('edge') <= 0 || getInkEffectFactor() <= 0,
  });
  bleedSlider.classList.add('effect-slider');
  body.appendChild(bleedSlider);

  const sharpRow = document.createElement('div');
  sharpRow.className = 'control-row';
  const sharpLabel = document.createElement('label');
  sharpLabel.textContent = 'Edge helper';
  sharpRow.appendChild(sharpLabel);
  const sharpControls = document.createElement('div');
  sharpControls.className = 'ink-inline-controls';
  const sharpBtn = document.createElement('button');
  sharpBtn.type = 'button';
  sharpBtn.className = 'btn';
  sharpBtn.textContent = 'Keep edges sharp';
  sharpBtn.addEventListener('click', () => {
    applyEffectStrength('fuzz', 0);
    applyEffectStrength('bleed', 0);
    syncAllSliders();
  });
  sharpControls.appendChild(sharpBtn);
  sharpRow.appendChild(sharpControls);
  body.appendChild(sharpRow);

  buildConfigGroup({
    id: 'fuzzConfig',
    label: 'Edge fuzz parameters',
    config: EDGE_FUZZ,
    keyOrder: ['fuzzWidthPx', 'fuzzInwardShare', 'fuzzRoughness', 'fuzzFrequency', 'fuzzOpacity'],
    trigger: 'glyph',
  }, body);

  buildConfigGroup({
    id: 'bleedConfig',
    label: 'Halo passes',
    config: EDGE_BLEED,
    keyOrder: ['inks', 'passes'],
    trigger: 'glyph',
  }, body);

  root.appendChild(sectionEl);
}

function formatInkList(inks = []) {
  if (!Array.isArray(inks) || !inks.length) return '';
  const names = { b: 'Black', r: 'Red', w: 'White' };
  return inks.map(ink => names[ink] || ink).join(', ');
}

function applyThemeGateIndicator() {
  if (!panelState.themeGateEl) return;
  const { preferWhite, inks } = panelState.themeGateState;
  const modeLine = panelState.themeGateEl.mode;
  const inksLine = panelState.themeGateEl.inks;
  if (modeLine) {
    modeLine.textContent = preferWhite
      ? 'Theme gating: Effects favor white ink on dark pages.'
      : 'Theme gating: Effects favor black ink on light pages.';
  }
  if (inksLine) {
    const friendly = formatInkList(inks);
    inksLine.textContent = friendly ? `Active inks: ${friendly}` : 'Active inks: —';
  }
}

function updateSeedDisplay() {
  if (!panelState.appState) return;
  const grain = panelState.appState.grainSeed >>> 0;
  const alt = panelState.appState.altSeed >>> 0;
  if (panelState.seedOutputEls.grain) {
    panelState.seedOutputEls.grain.textContent = toHex(grain);
  }
  if (panelState.seedOutputEls.alt) {
    panelState.seedOutputEls.alt.textContent = toHex(alt);
  }
}

function regenerateSeeds() {
  if (!panelState.appState) return;
  const rand = () => (Math.random() * 0xFFFFFFFF) >>> 0;
  panelState.appState.grainSeed = rand();
  panelState.appState.altSeed = rand();
  updateSeedDisplay();
  if (typeof panelState.callbacks.refreshGlyphs === 'function') panelState.callbacks.refreshGlyphs();
  if (typeof panelState.callbacks.refreshGrain === 'function') panelState.callbacks.refreshGrain();
  if (typeof panelState.callbacks.saveState === 'function') panelState.callbacks.saveState();
}

function buildGlobalSection(root) {
  const { sectionEl, body } = createSection('Global');
  const overallRow = createSliderRow({
    id: 'inkEffectsOverallSlider',
    label: 'Overall effects strength',
    key: 'overall',
    getValue: () => Math.round(getInkEffectFactor() * 100),
    onChange: (value) => applyOverallStrength(value / 100),
  });
  overallRow.classList.add('strength-slider');
  body.appendChild(overallRow);

  const themeBlock = document.createElement('div');
  themeBlock.className = 'ink-theme-gate';
  const modeLine = document.createElement('div');
  const inksLine = document.createElement('div');
  themeBlock.appendChild(modeLine);
  themeBlock.appendChild(inksLine);
  panelState.themeGateEl = { container: themeBlock, mode: modeLine, inks: inksLine };
  applyThemeGateIndicator();
  body.appendChild(themeBlock);

  const seedWrap = document.createElement('div');
  seedWrap.className = 'ink-seed-fields';
  const grainField = document.createElement('div');
  grainField.className = 'ink-seed-field';
  const grainLabel = document.createElement('span');
  grainLabel.textContent = 'Grain seed';
  const grainValue = document.createElement('code');
  grainValue.textContent = '—';
  grainField.appendChild(grainLabel);
  grainField.appendChild(grainValue);
  panelState.seedOutputEls.grain = grainValue;
  seedWrap.appendChild(grainField);

  const altField = document.createElement('div');
  altField.className = 'ink-seed-field';
  const altLabel = document.createElement('span');
  altLabel.textContent = 'Alt seed';
  const altValue = document.createElement('code');
  altValue.textContent = '—';
  altField.appendChild(altLabel);
  altField.appendChild(altValue);
  panelState.seedOutputEls.alt = altValue;
  seedWrap.appendChild(altField);

  body.appendChild(seedWrap);

  const regenRow = document.createElement('div');
  regenRow.className = 'control-row';
  regenRow.appendChild(document.createElement('div'));
  const regenBtnWrap = document.createElement('div');
  regenBtnWrap.className = 'ink-inline-controls';
  const regenBtn = document.createElement('button');
  regenBtn.type = 'button';
  regenBtn.className = 'btn apply-btn';
  regenBtn.textContent = 'Regenerate seeds';
  regenBtn.addEventListener('click', regenerateSeeds);
  regenBtnWrap.appendChild(regenBtn);
  regenRow.appendChild(regenBtnWrap);
  body.appendChild(regenRow);

  root.appendChild(sectionEl);
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
    `export const GRAIN_CFG = ${formatValue(GRAIN_CFG, 0, 'GRAIN_CFG')};`,
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
  return clamp01(panelState.overall);
}

export function getPowderEffectStrength() {
  return clamp01(panelState.effectStrengths.powder || 0) * getSectionStrength('interior') * getInkEffectFactor();
}

export function getTextureEffectStrength() {
  return clamp01(panelState.effectStrengths.texture || 0) * getSectionStrength('interior') * getInkEffectFactor();
}

export function getFuzzEffectStrength() {
  return clamp01(panelState.effectStrengths.fuzz || 0) * getSectionStrength('edge') * getInkEffectFactor();
}

export function getBleedEffectStrength() {
  return clamp01(panelState.effectStrengths.bleed || 0) * getSectionStrength('edge') * getInkEffectFactor();
}

export function getTextureVoidsBias() {
  return clamp(Number(panelState.appState?.inkTextureVoidsBias ?? 0), -1, 1);
}

export function isInkSectionEnabled(sectionId) {
  const overall = getInkEffectFactor();
  if (overall <= 0) return false;
  if (sectionId === 'grain') return getSectionStrength('interior') > 0 && GRAIN_CFG.enabled !== false;
  if (sectionId === 'powder') return POWDER_EFFECT.enabled !== false && getPowderEffectStrength() > 0;
  if (sectionId === 'texture') return INK_TEXTURE.enabled !== false && getTextureEffectStrength() > 0;
  if (sectionId === 'fuzz') return EDGE_FUZZ.enabled !== false && getFuzzEffectStrength() > 0;
  if (sectionId === 'bleed') return EDGE_BLEED.enabled !== false && getBleedEffectStrength() > 0;
  return overall > 0;
}

export function updateThemeGateIndicator(preferWhite, inks) {
  panelState.themeGateState = {
    preferWhite: !!preferWhite,
    inks: Array.isArray(inks) ? [...inks] : [],
  };
  applyThemeGateIndicator();
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

  const root = document.getElementById('inkSettingsSections');
  const copyBtn = document.getElementById('inkSettingsCopyBtn');
  if (!root) return;

  root.innerHTML = '';
  panelState.sliderControls.clear();
  panelState.metas = [];

  buildInteriorSection(root);
  buildEdgeSection(root);
  buildGlobalSection(root);

  updateSeedDisplay();
  syncAllSliders();

  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyConfigToClipboard(copyBtn));
  }

  panelState.initialized = true;
}

export function syncInkSettingsUiFromState(appState = panelState.appState) {
  if (!panelState.initialized) {
    setPanelStateFromApp(appState);
    return;
  }
  setPanelStateFromApp(appState);
  syncAllSliders();
  panelState.metas.forEach(syncConfigInputs);
  updateSeedDisplay();
  applyThemeGateIndicator();
}
