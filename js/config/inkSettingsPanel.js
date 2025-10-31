import { EDGE_BLEED, EDGE_FUZZ, GRAIN_CFG, INK_TEXTURE } from './inkConfig.js';

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const SECTION_DEFS = [
  {
    id: 'texture',
    label: 'Texture',
    config: INK_TEXTURE,
    keyOrder: ['supersample', 'noiseOctaves', 'noiseStrength', 'noiseFloor', 'chip', 'scratch', 'jitterSeed'],
    trigger: 'glyph',
    stateKey: 'inkTextureStrength',
    defaultStrength: INK_TEXTURE.enabled === false ? 0 : 100,
  },
  {
    id: 'fuzz',
    label: 'Edge Fuzz',
    config: EDGE_FUZZ,
    keyOrder: ['inks', 'widthPx', 'inwardShare', 'roughness', 'frequency', 'opacity', 'seed'],
    trigger: 'glyph',
    stateKey: 'edgeFuzzStrength',
    defaultStrength: 0,
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
    defaultStrength: 0,
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
  pendingGlyphRAF: 0,
  pendingGrainRAF: 0,
  pendingGlyphOptions: null,
  styleNameInput: null,
  saveStyleButton: null,
  stylesList: null,
  renameContext: null,
  lastLoadedStyleId: null,
};

const HEX_MATCH_RE = /seed|hash/i;
const STYLE_NAME_MAX_LEN = 60;

function deepCloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => deepCloneValue(item));
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

function generateStyleId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `style-${ts}-${rand}`;
}

function sanitizeStyleRecord(style, index = 0) {
  const record = {
    id: typeof style?.id === 'string' && style.id.trim() ? style.id.trim() : generateStyleId(),
    name: sanitizeStyleName(style?.name) || `Style ${index + 1}`,
    overall: clamp(Math.round(Number(style?.overall ?? 100)), 0, 100),
    sections: {},
  };
  SECTION_DEFS.forEach(def => {
    const rawSection = style?.sections && typeof style.sections === 'object'
      ? style.sections[def.id]
      : (style && typeof style === 'object' && typeof style[def.id] === 'object' ? style[def.id] : null);
    const section = rawSection && typeof rawSection === 'object' ? rawSection : {};
    const strength = clamp(Math.round(Number(section?.strength ?? def.defaultStrength ?? 0)), 0, 100);
    const configSource = section.config != null
      ? section.config
      : section.settings != null
        ? section.settings
        : ('strength' in section ? def.config : section);
    record.sections[def.id] = {
      strength,
      config: deepCloneValue(configSource == null ? def.config : configSource),
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
  if (!panelState.appState) return [];
  const normalized = Array.isArray(styles)
    ? styles.map((style, index) => sanitizeStyleRecord(style, index))
    : [];
  panelState.appState.savedInkStyles = normalized;
  return normalized;
}

function createStyleSnapshot(name, existingId = null) {
  const base = {
    id: existingId || generateStyleId(),
    name,
    overall: getPercentFromState('effectsOverallStrength', 100),
    sections: {},
  };
  SECTION_DEFS.forEach(def => {
    base.sections[def.id] = {
      strength: getPercentFromState(def.stateKey, def.defaultStrength ?? 0),
      config: deepCloneValue(def.config),
    };
  });
  return sanitizeStyleRecord(base);
}

function applyConfigToTarget(target, source) {
  if (!target || typeof target !== 'object') return;
  const clone = source == null ? null : deepCloneValue(source);
  if (!clone || typeof clone !== 'object') {
    return;
  }
  Object.keys(target).forEach(key => {
    if (!(key in clone)) delete target[key];
  });
  Object.entries(clone).forEach(([key, value]) => {
    target[key] = value;
  });
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

function cancelRenameStyle(restoreFocus = false) {
  const ctx = panelState.renameContext;
  if (!ctx) return;
  if (ctx.form && ctx.form.parentNode) {
    ctx.form.remove();
  }
  if (ctx.item) {
    ctx.item.classList.remove('is-renaming');
  }
  if (restoreFocus && ctx.trigger && typeof ctx.trigger.focus === 'function') {
    ctx.trigger.focus();
  }
  panelState.renameContext = null;
}

function renderSavedStylesList(options = {}) {
  const list = panelState.stylesList;
  if (!list) return;
  const { focusId } = options || {};
  cancelRenameStyle();
  list.innerHTML = '';
  const styles = getSavedStyles();
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

    const header = document.createElement('div');
    header.className = 'ink-style-item-header';

    const main = document.createElement('div');
    main.className = 'ink-style-item-main';
    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'btn btn-small';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => applySavedStyle(style.id));
    const name = document.createElement('div');
    name.className = 'ink-style-name';
    name.textContent = style.name;
    name.title = style.name;
    main.appendChild(loadBtn);
    main.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'ink-style-actions';
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'btn-text';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', () => startRenameStyle(style.id, item, renameBtn));
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-text danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => removeSavedStyle(style.id));
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);

    header.appendChild(main);
    header.appendChild(actions);
    item.appendChild(header);
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
  cancelRenameStyle();
  renderSavedStylesList();
}

function startRenameStyle(styleId, item, trigger) {
  if (!item) return;
  const styles = getSavedStyles();
  const style = styles.find(s => s && s.id === styleId);
  if (!style) return;
  cancelRenameStyle();
  item.classList.add('is-renaming');
  const form = document.createElement('div');
  form.className = 'ink-style-rename-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = style.name;
  input.maxLength = STYLE_NAME_MAX_LEN;
  form.appendChild(input);
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-small';
  saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-small';
  cancelBtn.textContent = 'Cancel';
  form.appendChild(saveBtn);
  form.appendChild(cancelBtn);
  item.appendChild(form);
  panelState.renameContext = { styleId, item, input, form, trigger };
  input.focus();
  input.select();
  input.addEventListener('input', () => input.classList.remove('input-error'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRenameStyle(styleId, input);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRenameStyle(true);
    }
  });
  saveBtn.addEventListener('click', () => commitRenameStyle(styleId, input));
  cancelBtn.addEventListener('click', () => cancelRenameStyle(true));
}

function commitRenameStyle(styleId, input) {
  if (!input) return;
  const sanitized = sanitizeStyleName(input.value);
  if (!sanitized) {
    input.classList.add('input-error');
    input.focus();
    return;
  }
  const styles = getSavedStyles();
  const updated = styles.map(style => {
    if (!style || style.id !== styleId) return style;
    return { ...style, name: sanitized };
  });
  setSavedStyles(updated);
  persistPanelState();
  cancelRenameStyle();
  renderSavedStylesList({ focusId: styleId });
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
    const section = style.sections?.[def.id];
    if (section && section.config) {
      applyConfigToTarget(meta.config, section.config);
      syncInputs(meta);
      scheduleRefreshForMeta(meta, { forceRebuild: true });
    }
    const strength = Number(section?.strength);
    if (Number.isFinite(strength)) {
      applySectionStrength(meta, strength);
    }
  });
  panelState.lastLoadedStyleId = styleId;
  persistPanelState();
  renderSavedStylesList();
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

function formatConfigExport() {
  const parts = [
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
  const pct = getPercentFromState('effectsOverallStrength', 100);
  return normalizedPercent(pct);
}

export function getInkSectionStrength(sectionId) {
  switch (sectionId) {
    case 'texture':
      return normalizedPercent(getPercentFromState('inkTextureStrength', INK_TEXTURE.enabled === false ? 0 : 100));
    case 'fuzz':
      return normalizedPercent(getPercentFromState('edgeFuzzStrength', 0));
    case 'bleed':
      return normalizedPercent(getPercentFromState('edgeBleedStrength', EDGE_BLEED.enabled === false ? 0 : 100));
    case 'grain':
      return normalizedPercent(getPercentFromState('grainPct', 0));
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

function findMetaById(sectionId) {
  if (!sectionId) return null;
  return panelState.metas.find(meta => meta && meta.id === sectionId) || null;
}

export function syncInkStrengthDisplays(sectionId) {
  if (!panelState.initialized) return;
  if (!sectionId) {
    syncOverallStrengthUI();
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
  const copyBtn = document.getElementById('inkSettingsCopyBtn');
  panelState.styleNameInput = document.getElementById('inkStyleNameInput');
  panelState.saveStyleButton = document.getElementById('inkStyleSaveBtn');
  panelState.stylesList = document.getElementById('inkStylesList');

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

  if (panelState.appState) {
    setSavedStyles(getSavedStyles());
  }
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
    SECTION_DEFS.forEach(def => {
      const meta = buildSection(def, sectionsRoot);
      if (meta.applyBtn) {
        meta.applyBtn.addEventListener('click', () => applySection(meta));
      }
      syncInputs(meta);
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyConfigToClipboard(copyBtn));
  }

  panelState.initialized = true;
  syncInkStrengthDisplays();
}

export function refreshSavedInkStylesUI() {
  renderSavedStylesList();
}
