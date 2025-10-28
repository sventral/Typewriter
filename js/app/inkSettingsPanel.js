import { EDGE_BLEED, GRAIN_CFG, INK_TEXTURE } from './inkConfig.js';

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const SECTION_DEFS = [
  {
    id: 'texture',
    label: 'Texture',
    config: INK_TEXTURE,
    keyOrder: ['supersample', 'noiseOctaves', 'noiseStrength', 'noiseFloor', 'chip', 'scratch', 'jitterSeed'],
    trigger: 'glyph'
  },
  {
    id: 'bleed',
    label: 'Bleed',
    config: EDGE_BLEED,
    keyOrder: ['inks', 'passes'],
    trigger: 'glyph'
  },
  {
    id: 'grain',
    label: 'Grain',
    config: GRAIN_CFG,
    keyOrder: ['base_scale_from_char_w', 'octave_rel_scales', 'octave_weights', 'pixel_hash_weight', 'post_gamma', 'alpha', 'seeds', 'composite_op'],
    trigger: 'grain'
  }
];

const state = {
  overall: 1,
  sections: {
    texture: INK_TEXTURE.enabled !== false,
    bleed: EDGE_BLEED.enabled !== false,
    grain: GRAIN_CFG.enabled !== false
  },
  callbacks: {
    refreshGlyphs: null,
    refreshGrain: null
  },
  metas: [],
  initialized: false
};

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

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'ink-section-toggle';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = def.id === 'grain' ? state.sections.grain : !!def.config.enabled;
  toggleLabel.appendChild(toggle);
  const toggleText = document.createElement('span');
  toggleText.textContent = 'On';
  toggleLabel.appendChild(toggleText);
  header.appendChild(toggleLabel);

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
  state.metas.push(meta);
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
  if (meta.id === 'texture' || meta.id === 'bleed') {
    if (typeof state.callbacks.refreshGlyphs === 'function') state.callbacks.refreshGlyphs();
  }
  if (meta.id === 'grain') {
    if (typeof state.callbacks.refreshGrain === 'function') state.callbacks.refreshGrain();
  }
  syncInputs(meta);
}

function formatConfigExport() {
  const parts = [
    `export const INK_TEXTURE = ${formatValue(INK_TEXTURE, 0, 'INK_TEXTURE')};`,
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
  return clamp(state.overall, 0, 1);
}

export function isInkSectionEnabled(sectionId) {
  if (sectionId === 'grain') return !!state.sections.grain && GRAIN_CFG.enabled !== false;
  if (sectionId === 'texture') return !!state.sections.texture && INK_TEXTURE.enabled !== false;
  if (sectionId === 'bleed') return !!state.sections.bleed && EDGE_BLEED.enabled !== false;
  return true;
}

function setOverallStrength(percent) {
  const pct = clamp(Number(percent) || 0, 0, 100);
  state.overall = pct / 100;
  if (typeof state.callbacks.refreshGlyphs === 'function') state.callbacks.refreshGlyphs();
  if (typeof state.callbacks.refreshGrain === 'function') state.callbacks.refreshGrain();
  return pct;
}

export function setupInkSettingsPanel(options = {}) {
  if (state.initialized) return;
  const {
    refreshGlyphs,
    refreshGrain
  } = options;
  state.callbacks.refreshGlyphs = typeof refreshGlyphs === 'function' ? refreshGlyphs : null;
  state.callbacks.refreshGrain = typeof refreshGrain === 'function' ? refreshGrain : null;

  const sectionsRoot = document.getElementById('inkSettingsSections');
  const overallInput = document.getElementById('inkOverallStrength');
  const overallApplyBtn = document.getElementById('inkOverallApplyBtn');
  const copyBtn = document.getElementById('inkSettingsCopyBtn');
  if (!sectionsRoot) return;

  state.sections.texture = INK_TEXTURE.enabled !== false;
  state.sections.bleed = EDGE_BLEED.enabled !== false;
  state.sections.grain = GRAIN_CFG.enabled !== false;

  SECTION_DEFS.forEach(def => {
    const meta = buildSection(def, sectionsRoot);
    meta.toggle.addEventListener('change', () => {
      if (meta.id === 'grain') {
        state.sections.grain = !!meta.toggle.checked;
        GRAIN_CFG.enabled = state.sections.grain;
        meta.root.classList.toggle('is-disabled', !state.sections.grain);
        if (typeof state.callbacks.refreshGrain === 'function') state.callbacks.refreshGrain();
      } else if (meta.id === 'texture') {
        state.sections.texture = !!meta.toggle.checked;
        INK_TEXTURE.enabled = state.sections.texture;
        meta.root.classList.toggle('is-disabled', !state.sections.texture);
        if (typeof state.callbacks.refreshGlyphs === 'function') state.callbacks.refreshGlyphs();
      } else if (meta.id === 'bleed') {
        state.sections.bleed = !!meta.toggle.checked;
        EDGE_BLEED.enabled = state.sections.bleed;
        meta.root.classList.toggle('is-disabled', !state.sections.bleed);
        if (typeof state.callbacks.refreshGlyphs === 'function') state.callbacks.refreshGlyphs();
      }
    });
    meta.applyBtn.addEventListener('click', () => applySection(meta));
    const isEnabled = meta.id === 'grain'
      ? state.sections.grain
      : meta.id === 'texture'
        ? state.sections.texture
        : meta.id === 'bleed'
          ? state.sections.bleed
          : true;
    meta.root.classList.toggle('is-disabled', !isEnabled);
    syncInputs(meta);
  });

  if (overallInput) {
    const pct = clamp(Math.round(state.overall * 100), 0, 100);
    overallInput.value = String(pct);
  }
  if (overallApplyBtn && overallInput) {
    overallApplyBtn.addEventListener('click', () => {
      const pct = clamp(Number.parseFloat(overallInput.value) || 0, 0, 100);
      overallInput.value = String(pct);
      setOverallStrength(pct);
    });
  }
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyConfigToClipboard(copyBtn));
  }

  state.initialized = true;
}
