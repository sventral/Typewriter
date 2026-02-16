import { clamp } from '../../utils/math.js';
import {
  INPUT_OVERRIDES,
  getInputOverride,
  EXPERIMENTAL_EFFECTS_CONFIG,
  EXP_TONE_KEYS,
  EXP_EDGE_KEYS,
  EXP_EDGE_LABELS,
  EXP_GRAIN_KEYS,
  EXP_DEFECT_KEYS,
  FILTER_KEYS,
  FILTER_LABELS,
  SECTION_DEFS,
  EFFECT_QUALITY_DEFAULT,
  EFFECT_QUALITY_MIN,
  EFFECT_QUALITY_MAX,
  EFFECT_SCALE_DEFAULT,
  EFFECT_SCALE_MIN,
  EFFECT_SCALE_MAX,
  SUBGROUP_CONFIG,
  SUBSECTION_STAGE_MAP,
  SUBSECTION_DEFS,
  SUBSECTION_DEF_MAP,
  DEFAULT_SUBSECTION_ORDER,
  SUBSECTION_IDS_BY_SECTION,
  SUBSECTION_QUALITY_CONFIG,
  SUBSECTION_SCALE_CONFIG,
  VISIBLE_SECTION_DEFS,
  DEFAULT_SECTION_ORDER,
  SECTION_DEF_MAP,
  SECTION_STATE_KEY_MAP,
  normalizeSectionOrder,
  normalizeSubsectionOrder,
} from './inkSettingsConfig.js';
import {
  getDefaultInkSubsectionQuality,
  getDefaultInkSubsectionScale,
} from '../inkEffectDefaultStyle.js';
import {
  STYLE_INCLUDE_KEYS,
  DEFAULT_STYLE_INCLUDES,
  deepCloneValue,
  sanitizeStyleName,
  ensureUniqueStyleName,
  normalizeStyleIncludes,
  normalizeStyleRecord,
  cloneDefaultStyleSnapshot,
  generateStyleId,
  makeStyleExportFileName,
  buildStyleExportPayload,
  extractStyleFromPayload,
  normalizeImportedStyle,
} from './inkStyleLibrary.js';

const CURRENT_STYLE_STATE_ID = 'current-style';

const panelState = {
  appState: null,
  app: null,
  metricsStore: null,
  callbacks: {
    refreshGlyphs: null,
  },
  metas: [],
  initialized: false,
  saveState: null,
  overallSlider: null,
  overallNumberInput: null,
  pendingGlyphRAF: 0,
  pendingGlyphOptions: null,
  saveStyleButton: null,
  saveToFileButton: null,
  loadFromFileButton: null,
  lastLoadedStyleId: null,
  selectedStyleId: null,
  transientStyleName: '',
  styleManagerStatus: null,
  loadMenuButton: null,
  deleteMenuButton: null,
  loadMenu: null,
  deleteMenu: null,
  loadMenuList: null,
  deleteMenuList: null,
  openMenuKind: '',
  importInput: null,
  styleDialogScrim: null,
  styleDialog: null,
  styleDialogTitle: null,
  styleDialogSubtitle: null,
  styleDialogNameInput: null,
  styleDialogConfirmButton: null,
  styleDialogCancelButton: null,
  styleDialogMode: 'save',
  styleDialogFocusReturnTarget: null,
  resetButton: null,
  randomizeButton: null,
  keepOrderCheckbox: null,
  includeInputs: {},
  lockState: {
    groups: {},
    quality: {},
    scale: {},
  },
  sectionsRoot: null,
  sectionOrder: DEFAULT_SECTION_ORDER.slice(),
  subsectionOrder: DEFAULT_SUBSECTION_ORDER.slice(),
  dragState: null,
  subgroupDragState: null,
  persistDepth: 0,
};

function lockKey(metaId, path) {
  return `${metaId || 'unknown'}:${path || 'root'}`;
}

function setGroupLocked(meta, path, locked) {
  if (!meta || !path) return;
  const key = lockKey(meta.id, path);
  panelState.lockState.groups[key] = !!locked;
  const groupEl = meta.groupElements?.get(path);
  if (groupEl) {
    groupEl.classList.toggle('is-locked', !!locked);
    const lockBtn = groupEl.querySelector('.ink-lock-toggle');
    if (lockBtn) {
      lockBtn.dataset.locked = locked ? '1' : '0';
      lockBtn.textContent = locked ? '🔒' : '🔓';
      lockBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
      const labelText = lockBtn.getAttribute('title')?.replace(/^(Lock|Unlock)\s+/i, '') || '';
      lockBtn.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${labelText}`.trim());
      lockBtn.title = `${locked ? 'Unlock' : 'Lock'} ${labelText}`.trim();
    }
    groupEl.querySelectorAll('input, select, textarea, button').forEach(el => {
      if (el.classList.contains('ink-lock-toggle')) return;
      el.disabled = !!locked;
      if (locked) el.blur();
    });
  }
}

function isGroupLocked(meta, path) {
  if (!meta || !path) return false;
  const key = lockKey(meta.id, path);
  return !!panelState.lockState.groups[key];
}

function setQualityLocked(meta, locked, scope = 'quality') {
  if (!meta) return;
  const key = lockKey(meta.id, scope);
  panelState.lockState.quality[key] = !!locked;
  const qc = meta.qualityControl;
  if (qc) {
    qc.wrapper.classList.toggle('is-locked', !!locked);
    const lockBtn = qc.wrapper.querySelector('.ink-lock-toggle');
    if (lockBtn) {
      lockBtn.dataset.locked = locked ? '1' : '0';
      lockBtn.textContent = locked ? '🔒' : '🔓';
      lockBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
      const labelText = lockBtn.getAttribute('title')?.replace(/^(Lock|Unlock)\s+/i, '') || qc.wrapper.dataset.lockLabel || 'Quality';
      lockBtn.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${labelText}`.trim());
      lockBtn.title = `${locked ? 'Unlock' : 'Lock'} ${labelText}`.trim();
    }
    [qc.slider, qc.numberInput].forEach(input => {
      if (!input) return;
      input.disabled = !!locked;
      if (locked) input.blur();
    });
  }
}

function isQualityLocked(meta, scope = 'quality') {
  if (!meta) return false;
  const key = lockKey(meta.id, scope);
  return !!panelState.lockState.quality[key];
}

function setScaleLocked(meta, locked, scope = 'scale') {
  if (!meta) return;
  const key = lockKey(meta.id, scope);
  panelState.lockState.scale[key] = !!locked;
  const sc = meta.scaleControl;
  if (sc) {
    sc.wrapper.classList.toggle('is-locked', !!locked);
    const lockBtn = sc.wrapper.querySelector('.ink-lock-toggle');
    if (lockBtn) {
      lockBtn.dataset.locked = locked ? '1' : '0';
      lockBtn.textContent = locked ? '🔒' : '🔓';
      lockBtn.setAttribute('aria-pressed', locked ? 'true' : 'false');
      const labelText = lockBtn.getAttribute('title')?.replace(/^(Lock|Unlock)\s+/i, '') || sc.wrapper.dataset.lockLabel || 'Scale';
      lockBtn.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${labelText}`.trim());
      lockBtn.title = `${locked ? 'Unlock' : 'Lock'} ${labelText}`.trim();
    }
    [sc.slider, sc.numberInput].forEach(input => {
      if (!input) return;
      input.disabled = !!locked;
      if (locked) input.blur();
    });
  }
}

function isScaleLocked(meta, scope = 'scale') {
  if (!meta) return false;
  const key = lockKey(meta.id, scope);
  return !!panelState.lockState.scale[key];
}

function setSubgroupCollapsed(meta, subgroupId, collapsed = true) {
  if (!meta || !subgroupId) return;
  if (!meta.subgroupCollapsed) meta.subgroupCollapsed = new Map();
  meta.subgroupCollapsed.set(subgroupId, !!collapsed);
  const group = meta.groupElements?.get(subgroupId);
  if (group) {
    group.classList.toggle('is-collapsed', !!collapsed);
    const toggle = group.querySelector('.ink-subgroup-collapse');
    if (toggle) {
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.dataset.collapsed = collapsed ? '1' : '0';
    }
  }
}

function isSubgroupCollapsed(meta, subgroupId) {
  if (!meta || !subgroupId) return false;
  return !!meta.subgroupCollapsed?.get(subgroupId);
}

const HEX_MATCH_RE = /seed|hash/i;
const INCLUDE_LABELS = Object.freeze({
  font: 'Font',
  slant: 'Slant',
  jitter: 'Jitter',
  effects: 'Filters',
});

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

function getIncludeSelectionFromInputs() {
  const flags = {};
  STYLE_INCLUDE_KEYS.forEach((key) => {
    const input = panelState.includeInputs?.[key];
    flags[key] = input ? !!input.checked : DEFAULT_STYLE_INCLUDES[key];
  });
  return normalizeStyleIncludes(flags);
}

function resolveIncludesForSnapshot(existingId = null) {
  const fromInputs = getIncludeSelectionFromInputs();
  if (fromInputs) return fromInputs;
  const styles = getSavedStyles();
  if (existingId && Array.isArray(styles)) {
    const match = styles.find(style => style && style.id === existingId);
    if (match) return normalizeStyleIncludes(match.includes);
  }
  if (panelState.lastLoadedStyleId && Array.isArray(styles)) {
    const loaded = styles.find(style => style && style.id === panelState.lastLoadedStyleId);
    if (loaded) return normalizeStyleIncludes(loaded.includes);
  }
  const fromState = getCurrentStyleFromState();
  if (fromState?.includes) return normalizeStyleIncludes(fromState.includes);
  return normalizeStyleIncludes(DEFAULT_STYLE_INCLUDES);
}

function syncIncludeInputsFromStyle(style) {
  const includes = normalizeStyleIncludes(style?.includes);
  STYLE_INCLUDE_KEYS.forEach((key) => {
    const input = panelState.includeInputs?.[key];
    if (input) input.checked = includes[key];
  });
}

function findSavedStyleById(styleId) {
  if (!styleId) return null;
  const styles = getSavedStyles();
  return styles.find(style => style && style.id === styleId) || null;
}

function getStyleIncludeSummary(style) {
  const includes = normalizeStyleIncludes(style?.includes);
  const enabled = STYLE_INCLUDE_KEYS
    .filter(key => includes[key])
    .map(key => INCLUDE_LABELS[key] || key);
  return enabled.length ? enabled.join(' | ') : 'No fields selected';
}

function setStyleMenuButtonExpanded(button, expanded) {
  if (!button) return;
  button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function closeStyleMenus() {
  panelState.openMenuKind = '';
  if (panelState.loadMenu) panelState.loadMenu.classList.remove('open');
  if (panelState.deleteMenu) panelState.deleteMenu.classList.remove('open');
  setStyleMenuButtonExpanded(panelState.loadMenuButton, false);
  setStyleMenuButtonExpanded(panelState.deleteMenuButton, false);
}

function openStyleMenu(kind) {
  const styles = getSavedStyles();
  if (!Array.isArray(styles) || !styles.length) return;
  closeStyleMenus();
  if (kind === 'load' && panelState.loadMenu) {
    panelState.loadMenu.classList.add('open');
    setStyleMenuButtonExpanded(panelState.loadMenuButton, true);
    panelState.openMenuKind = 'load';
    return;
  }
  if (kind === 'delete' && panelState.deleteMenu) {
    panelState.deleteMenu.classList.add('open');
    setStyleMenuButtonExpanded(panelState.deleteMenuButton, true);
    panelState.openMenuKind = 'delete';
  }
}

function toggleStyleMenu(kind) {
  if (!kind) return;
  if (panelState.openMenuKind === kind) {
    closeStyleMenus();
  } else {
    openStyleMenu(kind);
  }
}

function updateStyleManagerStatus() {
  const target = panelState.styleManagerStatus;
  if (!target) return;
  const styles = getSavedStyles();
  const count = Array.isArray(styles) ? styles.length : 0;
  const loaded = panelState.lastLoadedStyleId
    ? styles.find(style => style && style.id === panelState.lastLoadedStyleId)
    : null;
  const transient = sanitizeStyleName(panelState.transientStyleName);
  if (loaded) {
    target.textContent = `${count} saved | loaded: ${loaded.name}`;
    return;
  }
  if (transient) {
    target.textContent = `${count} saved | preview: ${transient}`;
    return;
  }
  target.textContent = count ? `${count} saved` : 'No saved styles';
}

function renderStyleActionMenu(menuType, styles) {
  const list = menuType === 'delete' ? panelState.deleteMenuList : panelState.loadMenuList;
  if (!list) return;
  list.innerHTML = '';
  if (!Array.isArray(styles) || !styles.length) {
    const empty = document.createElement('div');
    empty.className = 'ink-style-action-empty';
    empty.textContent = 'No saved styles yet.';
    list.appendChild(empty);
    return;
  }
  styles.forEach((style) => {
    if (!style) return;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `ink-style-action-item${menuType === 'delete' ? ' ink-style-action-item--danger' : ''}`;
    item.setAttribute('role', 'menuitem');
    item.dataset.styleId = style.id;
    if (menuType === 'load' && panelState.lastLoadedStyleId && panelState.lastLoadedStyleId === style.id) {
      item.classList.add('is-loaded');
    }

    const head = document.createElement('span');
    head.className = 'ink-style-action-item__head';
    const name = document.createElement('span');
    name.className = 'ink-style-action-item__name';
    name.textContent = style.name;
    head.appendChild(name);

    if (menuType === 'load' && panelState.lastLoadedStyleId && panelState.lastLoadedStyleId === style.id) {
      const loadedLabel = document.createElement('span');
      loadedLabel.className = 'ink-style-action-item__state';
      loadedLabel.textContent = 'Loaded';
      head.appendChild(loadedLabel);
    }
    item.appendChild(head);

    const meta = document.createElement('span');
    meta.className = 'ink-style-action-item__meta';
    meta.textContent = getStyleIncludeSummary(style);
    item.appendChild(meta);

    item.addEventListener('click', (event) => {
      event.preventDefault();
      closeStyleMenus();
      if (menuType === 'delete') {
        removeSavedStyle(style.id);
      } else {
        applySavedStyle(style.id);
      }
    });
    list.appendChild(item);
  });
}

function applyFontFromStyle(style) {
  const includes = normalizeStyleIncludes(style?.includes);
  if (!includes.font || !style?.fontName) return;
  if (panelState.app && typeof panelState.app.setActiveFontName === 'function') {
    panelState.app.setActiveFontName(style.fontName);
  }
}

function applySlantFromStyle(style) {
  const includes = normalizeStyleIncludes(style?.includes);
  if (!includes.slant) return;
  const state = getAppState();
  if (!state) return;
  if (typeof style?.lineSlantEnabled === 'boolean') {
    state.lineSlantEnabled = style.lineSlantEnabled;
  }
  if (style?.lineSlantRangeDeg && typeof style.lineSlantRangeDeg === 'object') {
    state.lineSlantRangeDeg = deepCloneValue(style.lineSlantRangeDeg);
  }
  const toggle = document.getElementById('lineSlantToggle');
  if (toggle) toggle.checked = !!state.lineSlantEnabled;
  const minInput = document.getElementById('lineSlantMin');
  const maxInput = document.getElementById('lineSlantMax');
  const range = state.lineSlantRangeDeg;
  if (minInput && range?.min != null) minInput.value = String(range.min);
  if (maxInput && range?.max != null) maxInput.value = String(range.max);
}

function applyJitterFromStyle(style) {
  const includes = normalizeStyleIncludes(style?.includes);
  if (!includes.jitter) return;
  const state = getAppState();
  if (!state) return;
  if (typeof style?.glyphJitterEnabled === 'boolean') {
    state.glyphJitterEnabled = style.glyphJitterEnabled;
  }
  if (style?.glyphJitterAmountPct) {
    state.glyphJitterAmountPct = deepCloneValue(style.glyphJitterAmountPct);
  }
  if (style?.glyphJitterFrequencyPct) {
    state.glyphJitterFrequencyPct = deepCloneValue(style.glyphJitterFrequencyPct);
  }
  if (Number.isFinite(style?.glyphJitterSeed)) {
    state.glyphJitterSeed = style.glyphJitterSeed >>> 0;
  }
  if (typeof style?.glyphBaselineOffsetAboveChars === 'string') {
    state.glyphBaselineOffsetAboveChars = style.glyphBaselineOffsetAboveChars;
  }
  if (style?.glyphBaselineOffsetAboveRangePct) {
    state.glyphBaselineOffsetAboveRangePct = deepCloneValue(style.glyphBaselineOffsetAboveRangePct);
  }
  if (typeof style?.glyphBaselineOffsetBelowChars === 'string') {
    state.glyphBaselineOffsetBelowChars = style.glyphBaselineOffsetBelowChars;
  }
  if (style?.glyphBaselineOffsetBelowRangePct) {
    state.glyphBaselineOffsetBelowRangePct = deepCloneValue(style.glyphBaselineOffsetBelowRangePct);
  }
  const toggle = document.getElementById('glyphJitterToggle');
  if (toggle) toggle.checked = !!state.glyphJitterEnabled;
  const amountMin = document.getElementById('glyphJitterAmountMin');
  const amountMax = document.getElementById('glyphJitterAmountMax');
  if (amountMin && state.glyphJitterAmountPct?.min != null) {
    amountMin.value = String(state.glyphJitterAmountPct.min);
  }
  if (amountMax && state.glyphJitterAmountPct?.max != null) {
    amountMax.value = String(state.glyphJitterAmountPct.max);
  }
  const freqMin = document.getElementById('glyphJitterFrequencyMin');
  const freqMax = document.getElementById('glyphJitterFrequencyMax');
  if (freqMin && state.glyphJitterFrequencyPct?.min != null) {
    freqMin.value = String(state.glyphJitterFrequencyPct.min);
  }
  if (freqMax && state.glyphJitterFrequencyPct?.max != null) {
    freqMax.value = String(state.glyphJitterFrequencyPct.max);
  }
  const aboveCharsInput = document.getElementById('glyphBaselineOffsetAboveChars');
  if (aboveCharsInput && typeof state.glyphBaselineOffsetAboveChars === 'string') {
    aboveCharsInput.value = state.glyphBaselineOffsetAboveChars;
  }
  const aboveMin = document.getElementById('glyphBaselineOffsetAboveMin');
  const aboveMax = document.getElementById('glyphBaselineOffsetAboveMax');
  if (aboveMin && state.glyphBaselineOffsetAboveRangePct?.min != null) {
    aboveMin.value = String(state.glyphBaselineOffsetAboveRangePct.min);
  }
  if (aboveMax && state.glyphBaselineOffsetAboveRangePct?.max != null) {
    aboveMax.value = String(state.glyphBaselineOffsetAboveRangePct.max);
  }
  const belowCharsInput = document.getElementById('glyphBaselineOffsetBelowChars');
  if (belowCharsInput && typeof state.glyphBaselineOffsetBelowChars === 'string') {
    belowCharsInput.value = state.glyphBaselineOffsetBelowChars;
  }
  const belowMin = document.getElementById('glyphBaselineOffsetBelowMin');
  const belowMax = document.getElementById('glyphBaselineOffsetBelowMax');
  if (belowMin && state.glyphBaselineOffsetBelowRangePct?.min != null) {
    belowMin.value = String(state.glyphBaselineOffsetBelowRangePct.min);
  }
  if (belowMax && state.glyphBaselineOffsetBelowRangePct?.max != null) {
    belowMax.value = String(state.glyphBaselineOffsetBelowRangePct.max);
  }
}

function createStyleSnapshot(name, existingId = null) {
  const appState = getAppState();
  const includes = resolveIncludesForSnapshot(existingId);
  const fontName = includes.font
    ? (panelState.app?.getActiveFontName?.()
      || panelState.metricsStore?.ACTIVE_FONT_NAME
      || null)
    : null;
  const jitterAmount = includes.jitter ? deepCloneValue(appState?.glyphJitterAmountPct) : null;
  const jitterFreq = includes.jitter ? deepCloneValue(appState?.glyphJitterFrequencyPct) : null;
  const jitterSeed = includes.jitter && Number.isFinite(appState?.glyphJitterSeed)
    ? appState.glyphJitterSeed >>> 0
    : null;
  const jitterEnabled = includes.jitter && typeof appState?.glyphJitterEnabled === 'boolean'
    ? appState.glyphJitterEnabled
    : null;
  const baselineAboveChars = includes.jitter && typeof appState?.glyphBaselineOffsetAboveChars === 'string'
    ? appState.glyphBaselineOffsetAboveChars
    : null;
  const baselineAboveRange = includes.jitter ? deepCloneValue(appState?.glyphBaselineOffsetAboveRangePct) : null;
  const baselineBelowChars = includes.jitter && typeof appState?.glyphBaselineOffsetBelowChars === 'string'
    ? appState.glyphBaselineOffsetBelowChars
    : null;
  const baselineBelowRange = includes.jitter ? deepCloneValue(appState?.glyphBaselineOffsetBelowRangePct) : null;
  const slantEnabled = includes.slant && typeof appState?.lineSlantEnabled === 'boolean'
    ? appState.lineSlantEnabled
    : null;
  const slantRange = includes.slant && appState?.lineSlantRangeDeg
    ? deepCloneValue(appState.lineSlantRangeDeg)
    : null;
  const base = {
    id: existingId || generateStyleId(),
    name,
    overall: getPercentFromState('effectsOverallStrength', 100),
    sections: {},
    sectionOrder: Array.isArray(panelState.sectionOrder)
      ? panelState.sectionOrder.slice()
      : DEFAULT_SECTION_ORDER.slice(),
    subsectionOrder: Array.isArray(panelState.subsectionOrder)
      ? panelState.subsectionOrder.slice()
      : DEFAULT_SUBSECTION_ORDER.slice(),
    includes,
    fontName,
    lineSlantEnabled: slantEnabled,
    lineSlantRangeDeg: slantRange,
    glyphJitterEnabled: jitterEnabled,
    glyphJitterAmountPct: jitterAmount,
    glyphJitterFrequencyPct: jitterFreq,
    glyphJitterSeed: jitterSeed,
    glyphBaselineOffsetAboveChars: baselineAboveChars,
    glyphBaselineOffsetAboveRangePct: baselineAboveRange,
    glyphBaselineOffsetBelowChars: baselineBelowChars,
    glyphBaselineOffsetBelowRangePct: baselineBelowRange,
  };
  SECTION_DEFS.forEach(def => {
    const meta = findMetaById(def.id);
    const configSource = meta && meta.config ? meta.config : def.config;
    const strengthValue = def.stateKey
      ? getPercentFromState(def.stateKey, def.defaultStrength ?? 0)
      : (Number.isFinite(def.defaultStrength) ? def.defaultStrength : 100);
    const sectionRecord = {
      strength: strengthValue,
      config: deepCloneValue(configSource),
      qualities: {},
      scales: {},
      order: getSectionSubsectionOrder(def.id),
    };
    const subsectionIds = SUBSECTION_IDS_BY_SECTION[def.id] || [];
    subsectionIds.forEach(subId => {
      const subKey = subId.split('.')[1];
      const defaultQuality = getDefaultInkSubsectionQuality(subId);
      sectionRecord.qualities[subKey] = getSubsectionQualityPercent(subId, defaultQuality);
      const defaultScale = getDefaultInkSubsectionScale(subId);
      sectionRecord.scales[subKey] = getSubsectionScalePercent(subId, defaultScale);
    });
    base.sections[def.id] = sectionRecord;
  });
  return normalizeStyleRecord(base);
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
  const payload = buildStyleExportPayload(style);
  const text = JSON.stringify(payload, null, 2);
  const filename = makeStyleExportFileName(style);
  triggerDownload(text, filename);
}

function notifyImportError() {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('Failed to load ink style: file was not in the expected format.');
  }
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert('Could not load style file. Please choose a valid style JSON file.');
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
  applyStyleSnapshot(normalized, {
    persist: true,
    rememberLoaded: false,
    refreshList: false,
    clearTransientStyle: false,
  });
  panelState.selectedStyleId = null;
  panelState.transientStyleName = normalized.name || 'Imported style';
  renderSavedStylesList();
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

function getCurrentStyleFromState() {
  const appState = getAppState();
  if (!appState || !appState.currentInkStyle) return null;
  return normalizeStyleRecord(appState.currentInkStyle, 0);
}

function getSectionOrderFromState() {
  const appState = getAppState();
  if (!appState) return DEFAULT_SECTION_ORDER.slice();
  return normalizeSectionOrder(appState.inkSectionOrder);
}

function setSectionOrderOnState(order) {
  const appState = getAppState();
  if (!appState) return;
  appState.inkSectionOrder = normalizeSectionOrder(order);
}

function getSubsectionOrderFromState() {
  const appState = getAppState();
  if (!appState) return DEFAULT_SUBSECTION_ORDER.slice();
  return normalizeSubsectionOrder(appState.inkSubsectionOrder);
}

function setSubsectionOrderOnState(order) {
  const appState = getAppState();
  if (!appState) return;
  appState.inkSubsectionOrder = normalizeSubsectionOrder(order);
}

function getKeepOrderFlagFromState() {
  const appState = getAppState();
  if (!appState) return false;
  return appState.inkRandomizeKeepOrder === true;
}

function setKeepOrderFlagOnState(value) {
  const appState = getAppState();
  if (!appState) return;
  appState.inkRandomizeKeepOrder = value === true;
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function reorderMetas(order) {
  if (!Array.isArray(panelState.metas) || !Array.isArray(order)) return;
  panelState.metas.sort((a, b) => {
    const aIdx = order.indexOf(a?.id);
    const bIdx = order.indexOf(b?.id);
    return (aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx)
      - (bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx);
  });
}

function updateSectionsDomOrder(order) {
  const root = panelState.sectionsRoot;
  if (!root || typeof root.appendChild !== 'function') return;
  if (!Array.isArray(order)) return;
  order.forEach(id => {
    const meta = findMetaById(id);
    if (!meta || !meta.root || meta.root.parentNode !== root) return;
    root.appendChild(meta.root);
  });
}

function applySectionOrder(order, options = {}) {
  const normalized = normalizeSectionOrder(order);
  const current = panelState.sectionOrder || DEFAULT_SECTION_ORDER;
  if (arraysEqual(normalized, current)) {
    if (options.syncDom) {
      updateSectionsDomOrder(normalized);
    }
    return;
  }
  panelState.sectionOrder = normalized.slice();
  if (!options.skipStateUpdate) {
    setSectionOrderOnState(panelState.sectionOrder);
    persistPanelState();
  }
  reorderMetas(panelState.sectionOrder);
  updateSectionsDomOrder(panelState.sectionOrder);
  if (options.silent !== true) {
    scheduleGlyphRefresh(true, { preserveFrontBuffer: true });
    scheduleGrainRefresh();
  }
}

function getSectionSubsectionOrder(sectionId) {
  const base = Array.isArray(panelState.subsectionOrder) && panelState.subsectionOrder.length
    ? panelState.subsectionOrder
    : normalizeSubsectionOrder(getSubsectionOrderFromState());
  return normalizeSubsectionOrder(base, sectionId);
}

function updateSubsectionDomOrder(sectionId, order) {
  const meta = findMetaById(sectionId);
  if (!meta || !meta.body || !meta.groupElements?.size) return;
  clearSubgroupDragIndicators(meta);
  const normalized = normalizeSubsectionOrder(order, sectionId, getSectionSubsectionOrder(sectionId));
  const desiredKeys = normalized.map(id => id.split('.')[1]).filter(Boolean);
  const remaining = Array.from(meta.groupElements.keys()).filter(key => !desiredKeys.includes(key));
  const finalKeys = [...desiredKeys, ...remaining];
  finalKeys.forEach(key => {
    const group = meta.groupElements.get(key);
    if (group && group.parentNode === meta.body) {
      meta.body.appendChild(group);
    }
  });
}

function applySubsectionOrderForSection(sectionId, order, options = {}) {
  if (!sectionId) return;
  const normalized = normalizeSubsectionOrder(order, sectionId, getSectionSubsectionOrder(sectionId));
  const currentGlobal = Array.isArray(panelState.subsectionOrder) ? panelState.subsectionOrder.slice() : normalizeSubsectionOrder(getSubsectionOrderFromState());
  const withoutSection = currentGlobal.filter(id => !id.startsWith(`${sectionId}.`));
  const next = normalizeSubsectionOrder([...withoutSection, ...normalized]);
  panelState.subsectionOrder = next;
  if (!options.skipStateUpdate) {
    setSubsectionOrderOnState(next);
    if (!options.silent) persistPanelState();
  }
  updateSubsectionDomOrder(sectionId, normalized);
  if (options.silent !== true) {
    scheduleGlyphRefresh(true, { preserveFrontBuffer: true });
  }
}

function applySubsectionOrder(order, options = {}) {
  const normalized = normalizeSubsectionOrder(order);
  panelState.subsectionOrder = normalized;
  if (!options.skipStateUpdate) {
    setSubsectionOrderOnState(normalized);
    if (!options.silent) persistPanelState();
  }
  if (options.syncDom !== false) {
    SECTION_DEFS.forEach(def => updateSubsectionDomOrder(def.id, getSectionSubsectionOrder(def.id)));
  }
  if (options.silent !== true) {
    scheduleGlyphRefresh(true, { preserveFrontBuffer: true });
  }
}



function clearDragIndicators() {
  const root = panelState.sectionsRoot;
  if (!root) return;
  root.querySelectorAll('.ink-section').forEach(section => {
    section.classList.remove('is-drop-before', 'is-drop-after');
  });
  root.classList.remove('is-drop-end');
}

function endSectionDrag() {
  if (panelState.dragState?.cleanup) {
    try {
      panelState.dragState.cleanup();
    } catch (err) {
      // noop
    }
  }
  if (panelState.dragState && panelState.dragState.element) {
    panelState.dragState.element.classList.remove('is-dragging');
  }
  // Safety: ensure no stray dragging classes remain on any section
  if (panelState.sectionsRoot) {
    const stray = panelState.sectionsRoot.querySelectorAll('.ink-section.is-dragging');
    for (const el of stray) {
      el.classList.remove('is-dragging');
    }
  }
  panelState.dragState = null;
  clearDragIndicators();
}

function commitPointerSectionDrop() {
  const dragState = panelState.dragState;
  if (!dragState || dragState.mode !== 'pointer') return;
  const draggingId = dragState.id;
  if (!draggingId || typeof dragState.dropIndex !== 'number') return;
  const order = Array.isArray(panelState.sectionOrder)
    ? panelState.sectionOrder.slice()
    : DEFAULT_SECTION_ORDER.slice();
  const fromIndex = order.indexOf(draggingId);
  if (fromIndex === -1) return;
  order.splice(fromIndex, 1);
  let insertIndex = dragState.dropIndex;
  if (!Number.isFinite(insertIndex)) {
    insertIndex = order.length;
  }
  insertIndex = Math.max(0, Math.min(order.length, Math.round(insertIndex)));
  order.splice(insertIndex, 0, draggingId);
  applySectionOrder(order);
}

function updatePointerDropTarget(clientX, clientY) {
  const dragState = panelState.dragState;
  if (!dragState || dragState.mode !== 'pointer') return;
  const root = panelState.sectionsRoot;
  if (!root) return;

  clearDragIndicators();

  const rootRect = root.getBoundingClientRect();
  const insideHorizontal = clientX >= rootRect.left && clientX <= rootRect.right;
  if (!insideHorizontal) {
    dragState.dropTargetId = null;
    dragState.dropPosition = null;
    dragState.dropToEnd = false;
    dragState.dropIndex = null;
    return;
  }

  const metas = Array.isArray(panelState.sectionOrder)
    ? panelState.sectionOrder
        .map(id => findMetaById(id))
        .filter(meta => meta && meta.root && meta.id !== dragState.id)
    : [];

  if (!metas.length) {
    root.classList.add('is-drop-end');
    dragState.dropTargetId = null;
    dragState.dropPosition = null;
    dragState.dropToEnd = true;
    dragState.dropIndex = 0;
    return;
  }

  let dropIndex = metas.length;
  if (clientY <= rootRect.top) {
    dropIndex = 0;
  } else if (clientY >= rootRect.bottom) {
    dropIndex = metas.length;
  } else {
    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i];
      const rect = meta.root.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (clientY < midpoint) {
        dropIndex = i;
        break;
      }
    }
  }

  if (dropIndex >= metas.length) {
    const lastMeta = metas[metas.length - 1];
    if (lastMeta?.root) {
      lastMeta.root.classList.add('is-drop-after');
    }
    root.classList.add('is-drop-end');
    dragState.dropTargetId = lastMeta?.id || null;
    dragState.dropPosition = lastMeta ? 'after' : null;
    dragState.dropToEnd = true;
    dragState.dropIndex = metas.length;
    return;
  }

  const targetMeta = metas[dropIndex];
  if (targetMeta?.root) {
    targetMeta.root.classList.add('is-drop-before');
  }
  dragState.dropTargetId = targetMeta?.id || null;
  dragState.dropPosition = targetMeta ? 'before' : null;
  dragState.dropToEnd = false;
  dragState.dropIndex = dropIndex;
}

function clearSubgroupDragIndicators(meta) {
  if (!meta?.body) return;
  meta.body.classList.remove('is-sub-drop-end');
  meta.body.querySelectorAll('.ink-subgroup').forEach(group => {
    group.classList.remove('is-drop-before', 'is-drop-after');
  });
}

function endSubgroupDrag() {
  const dragState = panelState.subgroupDragState;
  if (dragState?.cleanup) {
    try {
      dragState.cleanup();
    } catch (err) {
      // noop
    }
  }
  if (dragState?.element) {
    dragState.element.classList.remove('is-dragging');
  }
  if (dragState?.meta) {
    clearSubgroupDragIndicators(dragState.meta);
  }
  panelState.subgroupDragState = null;
}

function commitPointerSubgroupDrop() {
  const dragState = panelState.subgroupDragState;
  if (!dragState || dragState.mode !== 'pointer') return;
  const { sectionId, subgroupId, dropIndex } = dragState;
  if (!sectionId || !subgroupId || typeof dropIndex !== 'number') return;
  const currentOrder = getSectionSubsectionOrder(sectionId);
  const fullId = `${sectionId}.${subgroupId}`;
  const fromIndex = currentOrder.indexOf(fullId);
  if (fromIndex === -1) return;
  const order = currentOrder.slice();
  order.splice(fromIndex, 1);
  const insertIndex = Math.max(0, Math.min(order.length, Math.round(dropIndex)));
  order.splice(insertIndex, 0, fullId);
  applySubsectionOrderForSection(sectionId, order);
}

function updatePointerSubgroupDropTarget(meta, clientX, clientY) {
  if (!meta || !meta.body) return;
  const dragState = panelState.subgroupDragState;
  if (!dragState || dragState.mode !== 'pointer' || dragState.meta !== meta) return;
  clearSubgroupDragIndicators(meta);
  const bodyRect = meta.body.getBoundingClientRect();
  const insideHorizontal = clientX >= bodyRect.left && clientX <= bodyRect.right;
  if (!insideHorizontal) {
    dragState.dropTargetId = null;
    dragState.dropIndex = null;
    dragState.dropToEnd = false;
    return;
  }
  const groups = Array.from(meta.body.querySelectorAll('.ink-subgroup'))
    .filter(group => !group.classList.contains('is-dragging'));
  if (!groups.length) {
    meta.body.classList.add('is-sub-drop-end');
    dragState.dropTargetId = null;
    dragState.dropToEnd = true;
    dragState.dropIndex = 0;
    return;
  }
  let dropIndex = groups.length;
  if (clientY <= bodyRect.top) {
    dropIndex = 0;
  } else if (clientY >= bodyRect.bottom) {
    dropIndex = groups.length;
  } else {
    for (let i = 0; i < groups.length; i++) {
      const rect = groups[i].getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (clientY < midpoint) {
        dropIndex = i;
        break;
      }
    }
  }
  if (dropIndex >= groups.length) {
    const last = groups[groups.length - 1];
    if (last) last.classList.add('is-drop-after');
    meta.body.classList.add('is-sub-drop-end');
    dragState.dropTargetId = last?.dataset.groupPath || null;
    dragState.dropToEnd = true;
    dragState.dropIndex = groups.length;
    return;
  }
  const target = groups[dropIndex];
  if (target) {
    target.classList.add('is-drop-before');
    dragState.dropTargetId = target.dataset.groupPath || null;
    dragState.dropToEnd = false;
    dragState.dropIndex = dropIndex;
  }
}

function startPointerSubgroupDrag(event, meta, subgroupId) {
  if (!meta || !meta.body || !subgroupId) return;
  if (event?.button !== undefined && event.button !== 0) return;
  if (typeof event?.pointerId !== 'number') return;
  const handle = event.currentTarget;
  const group = meta.groupElements?.get(subgroupId);
  if (!handle || !group) return;
  event.preventDefault();
  if (panelState.subgroupDragState) {
    endSubgroupDrag();
  }
  clearSubgroupDragIndicators(meta);
  const moveHandler = moveEvent => {
    if (!panelState.subgroupDragState || panelState.subgroupDragState.pointerId !== moveEvent.pointerId) return;
    moveEvent.preventDefault();
    updatePointerSubgroupDropTarget(meta, moveEvent.clientX, moveEvent.clientY);
  };
  const upHandler = upEvent => {
    if (!panelState.subgroupDragState || panelState.subgroupDragState.pointerId !== upEvent.pointerId) return;
    upEvent.preventDefault();
    try {
      commitPointerSubgroupDrop();
    } finally {
      endSubgroupDrag();
    }
  };
  const cancelHandler = cancelEvent => {
    if (!panelState.subgroupDragState || panelState.subgroupDragState.pointerId !== cancelEvent.pointerId) return;
    cancelEvent.preventDefault();
    endSubgroupDrag();
  };
  panelState.subgroupDragState = {
    sectionId: meta.id,
    subgroupId,
    meta,
    element: group,
    mode: 'pointer',
    pointerId: event.pointerId,
    dropTargetId: null,
    dropIndex: null,
    dropToEnd: false,
    cleanup: () => {
      handle.removeEventListener('pointermove', moveHandler);
      handle.removeEventListener('pointerup', upHandler);
      handle.removeEventListener('pointercancel', cancelHandler);
      if (typeof handle.releasePointerCapture === 'function') {
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch (err) {
          // noop
        }
      }
    },
  };
  group.classList.add('is-dragging');
  if (typeof handle.setPointerCapture === 'function') {
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (err) {
      // noop
    }
  }
  handle.addEventListener('pointermove', moveHandler);
  handle.addEventListener('pointerup', upHandler);
  handle.addEventListener('pointercancel', cancelHandler);
  updatePointerSubgroupDropTarget(meta, event.clientX, event.clientY);
}

function startPointerSectionDrag(event, meta) {
  if (!meta || !meta.root) return;
  if (event?.button !== undefined && event.button !== 0) return;
  if (typeof event?.pointerId !== 'number') return;
  const handle = event.currentTarget;
  if (!handle) return;

  event.preventDefault();

  if (panelState.subgroupDragState) {
    endSubgroupDrag();
  }

  if (panelState.dragState) {
    endSectionDrag();
  }

  const moveHandler = moveEvent => {
    if (!panelState.dragState || panelState.dragState.pointerId !== moveEvent.pointerId) return;
    moveEvent.preventDefault();
    updatePointerDropTarget(moveEvent.clientX, moveEvent.clientY);
  };

  const upHandler = upEvent => {
    if (!panelState.dragState || panelState.dragState.pointerId !== upEvent.pointerId) return;
    upEvent.preventDefault();
    try {
      commitPointerSectionDrop();
    } finally {
      endSectionDrag();
    }
  };

  const cancelHandler = cancelEvent => {
    if (!panelState.dragState || panelState.dragState.pointerId !== cancelEvent.pointerId) return;
    cancelEvent.preventDefault();
    endSectionDrag();
  };

  panelState.dragState = {
    id: meta.id,
    element: meta.root,
    mode: 'pointer',
    pointerId: event.pointerId,
    dropTargetId: null,
    dropPosition: null,
    dropToEnd: false,
    dropIndex: null,
    cleanup: () => {
      handle.removeEventListener('pointermove', moveHandler);
      handle.removeEventListener('pointerup', upHandler);
      handle.removeEventListener('pointercancel', cancelHandler);
      if (typeof handle.releasePointerCapture === 'function') {
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch (err) {
          // noop
        }
      }
    },
  };

  meta.root.classList.add('is-dragging');

  if (typeof handle.setPointerCapture === 'function') {
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (err) {
      // noop
    }
  }

  handle.addEventListener('pointermove', moveHandler);
  handle.addEventListener('pointerup', upHandler);
  handle.addEventListener('pointercancel', cancelHandler);

  updatePointerDropTarget(event.clientX, event.clientY);
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

function clampQualityValue(value, fallback = EFFECT_QUALITY_DEFAULT) {
  const safeFallback = Number.isFinite(fallback) ? fallback : EFFECT_QUALITY_DEFAULT;
  const raw = Number.isFinite(Number(value)) ? Number(value) : safeFallback;
  const normalized = Number.isFinite(raw) ? raw : safeFallback;
  return clamp(Math.round(normalized), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX);
}

const SECTION_OFF_CHANCE_BUCKETS = Object.freeze({
  sparse: { min: 0.60, max: 0.90 },
  balanced: { min: 0.30, max: 0.65 },
  dense: { min: 0.10, max: 0.35 },
});

const TOGGLE_OFF_CHANCE_BUCKETS = Object.freeze({
  sparse: { min: 0.40, max: 0.70 },
  balanced: { min: 0.20, max: 0.50 },
  dense: { min: 0.05, max: 0.25 },
});

const SECTION_OFF_CHANCE_DEFAULT = SECTION_OFF_CHANCE_BUCKETS.dense.min;
const TOGGLE_OFF_CHANCE_DEFAULT = TOGGLE_OFF_CHANCE_BUCKETS.dense.min;

function randomBetween(lower, upper, step = null) {
  const min = Math.min(lower, upper);
  const max = Math.max(lower, upper);
  if (max === min) return min;
  const raw = min + Math.random() * (max - min);
  if (Number.isFinite(step) && step > 0) {
    const rounded = Math.round(raw / step) * step;
    return clamp(rounded, min, max);
  }
  return raw;
}

function shuffleArray(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandomizationProfile() {
  // Weight towards sparser runs to counter previous bias toward many-enabled outcomes.
  const roll = Math.random();
  const bucketKey = roll < 0.50 ? 'sparse' : roll < 0.80 ? 'balanced' : 'dense';
  const sectionBucket = SECTION_OFF_CHANCE_BUCKETS[bucketKey] || SECTION_OFF_CHANCE_BUCKETS.dense;
  const toggleBucket = TOGGLE_OFF_CHANCE_BUCKETS[bucketKey] || TOGGLE_OFF_CHANCE_BUCKETS.dense;
  return {
    sectionOffChance: clamp(randomBetween(sectionBucket.min, sectionBucket.max), 0, 1),
    toggleOffChance: clamp(randomBetween(toggleBucket.min, toggleBucket.max), 0, 1),
  };
}

function deriveNumericBounds(input) {
  const parsedMin = Number.parseFloat(input?.min);
  const parsedMax = Number.parseFloat(input?.max);
  const hasMin = Number.isFinite(parsedMin);
  const hasMax = Number.isFinite(parsedMax);
  const base = Number.parseFloat(input?.value);
  const magnitude = Number.isFinite(base) ? Math.max(Math.abs(base), 1) : 1;
  let min = hasMin ? parsedMin : (Number.isFinite(base) ? base - magnitude : 0);
  let max = hasMax ? parsedMax : (Number.isFinite(base) ? base + magnitude : 1);
  if (hasMin && !hasMax) {
    max = Math.max(parsedMin + magnitude, parsedMin + Math.max(1, Math.abs(parsedMin)));
  }
  if (hasMax && !hasMin) {
    min = Math.min(parsedMax - magnitude, parsedMax - Math.max(1, Math.abs(parsedMax)));
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = Math.max(min + magnitude, 1);
  if (max === min) max = min + 1;
  return { min, max };
}

function randomizeSingleInput(input, options = {}) {
  if (!input) return;
  if (input.dataset.enumOptions) {
    const optionsList = input.dataset.enumOptions.split('|');
    const idx = optionsList.length ? Math.floor(Math.random() * optionsList.length) : 0;
    input.value = String(idx);
    updateSliderDisplay(input);
    return;
  }
  if (input.type === 'checkbox') {
    const offChance = Number.isFinite(options.offChance) ? options.offChance : TOGGLE_OFF_CHANCE;
    input.checked = Math.random() >= offChance;
    return;
  }
  if (input.dataset.hex === '1') {
    const rand = (Math.random() * 0xFFFFFFFF) >>> 0; // 32-bit seed
    input.value = toHex(rand);
    return;
  }
  if (input.type === 'range' || input.type === 'number') {
    const step = Number.parseFloat(input.step);
    const { min, max } = deriveNumericBounds(input);
    const value = randomBetween(min, max, Number.isFinite(step) ? Math.abs(step) : null);
    input.value = String(value);
    if (input.dataset.slider === '1') updateSliderDisplay(input);
    return;
  }
  if (input.dataset.string === '1') {
    input.value = Math.random().toString(36).slice(2, 10);
    return;
  }
  input.value = String(randomBetween(0, 1));
}

function getSubsectionQualityPercent(subsectionId, fallback = EFFECT_QUALITY_DEFAULT) {
  const cfg = SUBSECTION_QUALITY_CONFIG[subsectionId];
  const defaultValue = Number.isFinite(cfg?.defaultValue) ? cfg.defaultValue : fallback;
  if (!cfg) return clampQualityValue(defaultValue, defaultValue);
  return getScalarFromState(
    cfg.stateKey,
    clampQualityValue(defaultValue, defaultValue),
    EFFECT_QUALITY_MIN,
    EFFECT_QUALITY_MAX,
  );
}

function setSubsectionQualityPercent(subsectionId, value) {
  const cfg = SUBSECTION_QUALITY_CONFIG[subsectionId];
  if (!cfg) return EFFECT_QUALITY_DEFAULT;
  const normalized = clampQualityValue(value);
  setScalarOnState(cfg.stateKey, normalized, EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX);
  return normalized;
}

function clampScaleValue(value, fallback = EFFECT_SCALE_DEFAULT) {
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, EFFECT_SCALE_MIN, EFFECT_SCALE_MAX);
}

function getSubsectionScalePercent(subsectionId, fallback = EFFECT_SCALE_DEFAULT) {
  const cfg = SUBSECTION_SCALE_CONFIG[subsectionId];
  const defaultValue = Number.isFinite(cfg?.defaultValue) ? cfg.defaultValue : fallback;
  if (!cfg) return clampScaleValue(defaultValue, defaultValue);
  return getScalarFromState(
    cfg.stateKey,
    clampScaleValue(defaultValue, defaultValue),
    EFFECT_SCALE_MIN,
    EFFECT_SCALE_MAX,
  );
}

function setSubsectionScalePercent(subsectionId, value) {
  const cfg = SUBSECTION_SCALE_CONFIG[subsectionId];
  if (!cfg) return EFFECT_SCALE_DEFAULT;
  const normalized = clampScaleValue(value);
  setScalarOnState(cfg.stateKey, normalized, EFFECT_SCALE_MIN, EFFECT_SCALE_MAX);
  return normalized;
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

function createLockToggle(labelText, onToggle) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ink-lock-toggle';
  const setState = locked => {
    btn.dataset.locked = locked ? '1' : '0';
    btn.textContent = locked ? '🔒' : '🔓';
    btn.setAttribute('aria-pressed', locked ? 'true' : 'false');
    btn.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${labelText}`);
    btn.title = `${locked ? 'Unlock' : 'Lock'} ${labelText}`;
  };
  btn.addEventListener('click', () => {
    const next = btn.dataset.locked !== '1';
    setState(next);
    if (typeof onToggle === 'function') onToggle(next, btn);
  });
  setState(false);
  return btn;
}

function tagRowWithGroup(row, groupPath) {
  if (!row || !groupPath) return;
  row.dataset.groupPath = groupPath;
  row.querySelectorAll('input, select, textarea').forEach(el => {
    if (!el.dataset.groupPath) el.dataset.groupPath = groupPath;
  });
}

function ensureSubgroupLocks(meta) {
  if (!meta?.body) return;
  const groups = Array.from(meta.body.querySelectorAll('.ink-subgroup'));
  groups.forEach(group => {
    const path = group.dataset.groupPath || group.getAttribute('data-group-path') || null;
    if (path && !meta.groupElements.has(path)) {
      meta.groupElements.set(path, group);
    }
    const heading = group.querySelector('.ink-subheading');
    if (!heading) return;
    const hasLock = heading.querySelector('.ink-lock-toggle');
    const labelText = heading.textContent?.trim() || 'Group';
    if (!hasLock) {
      const lock = createLockToggle(labelText, locked => setGroupLocked(meta, path || labelText, locked));
      heading.prepend(lock);
    }
    const effectivePath = path || labelText;
    if (effectivePath && !group.dataset.groupPath) {
      group.dataset.groupPath = effectivePath;
      meta.groupElements.set(effectivePath, group);
    }
    if (effectivePath) setGroupLocked(meta, effectivePath, isGroupLocked(meta, effectivePath));
  });
}

function updateSliderDisplay(input) {
  if (!input) return;
  const setDisplay = value => {
    if (!input._valueDisplay) return;
    if (typeof input._valueDisplay.value === 'string') {
      input._valueDisplay.value = value;
    } else {
      input._valueDisplay.textContent = value;
    }
  };
  if (input.dataset.enumOptions) {
    const options = input.dataset.enumOptions.split('|');
    const raw = Number.parseFloat(input.value);
    const idx = clamp(Number.isFinite(raw) ? Math.round(raw) : 0, 0, Math.max(0, options.length - 1));
    const label = options[idx] || '';
    input.dataset.enumValue = label;
    setDisplay(label);
    input.setAttribute('aria-valuetext', label);
    return;
  }
  const precision = Number.isFinite(Number.parseInt(input.dataset.precision, 10))
    ? Math.max(0, Number.parseInt(input.dataset.precision, 10))
    : 2;
  const num = Number.parseFloat(input.value);
  const text = Number.isFinite(num) ? formatSliderNumber(num, precision) : (input.value || '');
  setDisplay(text);
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
    const number = document.createElement('input');
    number.type = 'number';
    number.className = 'ink-control-number';
    number.min = input.min ?? '';
    number.max = input.max ?? '';
    number.step = input.step ?? '0.01';
    number.setAttribute('aria-label', `${labelText} value`);
    const precision = Number.isFinite(Number.parseInt(input.dataset.precision, 10))
      ? Math.max(0, Number.parseInt(input.dataset.precision, 10))
      : 2;
    input._valueDisplay = number;
    updateSliderDisplay(input);
    input.addEventListener('input', () => updateSliderDisplay(input));
    number.addEventListener('input', () => {
      const raw = Number.parseFloat(number.value);
      if (!Number.isFinite(raw)) return;
      const min = Number.parseFloat(number.min);
      const max = Number.parseFloat(number.max);
      const clamped = clamp(
        raw,
        Number.isFinite(min) ? min : -Infinity,
        Number.isFinite(max) ? max : Infinity,
      );
      input.value = formatSliderNumber(clamped, precision);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    row.appendChild(number);
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

function registerMetaInput(meta, path, input) {
  if (!meta || !path || !input) return;
  meta.inputs.set(path, input);

  const scheduleApply = (options = {}) => scheduleSectionApply(meta, options);

  if (input.type === 'range') {
    // Dragging a slider: update visuals with a cheap refresh, defer rebuild/persist.
    input.addEventListener('input', () => scheduleApply({ forceRebuild: false, persist: false }));
    // Finalize on release/change with full rebuild + persist.
    input.addEventListener('change', () => scheduleApply({ forceRebuild: true, persist: true }));
  } else {
    // Other controls: coalesce rapid input but still apply promptly.
    input.addEventListener('input', () => scheduleApply({ forceRebuild: false, persist: false }));
    input.addEventListener('change', () => scheduleApply({ forceRebuild: true, persist: true }));
  }
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
    group.dataset.groupPath = path;
    meta.groupElements?.set(path, group);
    if (label) {
      const heading = document.createElement('div');
      heading.className = 'ink-subheading';
      const lock = createLockToggle(label, locked => setGroupLocked(meta, path, locked));
      heading.prepend(lock);
      heading.appendChild(document.createTextNode(label));
      group.appendChild(heading);
    }
    arr.forEach((value, idx) => {
      const itemPath = `${path}[${idx}]`;
      const input = createInputForValue(value, itemPath, meta?.id);
      if (!input.dataset.enumOptions && typeof value === 'string') input.dataset.string = '1';
      const row = buildControlRow(`${label ? label : 'Item'} ${idx + 1}`, input);
      tagRowWithGroup(row, path);
      group.appendChild(row);
      registerMetaInput(meta, itemPath, input);
    });
    setGroupLocked(meta, path, isGroupLocked(meta, path));
    container.appendChild(group);
    return;
  }
  const group = document.createElement('div');
  group.className = 'ink-subgroup';
  group.dataset.groupPath = path;
  meta.groupElements?.set(path, group);
  if (label) {
    const heading = document.createElement('div');
    heading.className = 'ink-subheading';
    const lock = createLockToggle(label, locked => setGroupLocked(meta, path, locked));
    heading.prepend(lock);
    heading.appendChild(document.createTextNode(label));
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
      tagRowWithGroup(row, path);
      item.appendChild(row);
      registerMetaInput(meta, itemPath, input);
    });
    group.appendChild(item);
  });
  setGroupLocked(meta, path, isGroupLocked(meta, path));
  container.appendChild(group);
}

function buildObjectControls(meta, container, obj, path, label) {
  if (!obj || typeof obj !== 'object') return;
  const subgroupDefs = SUBGROUP_CONFIG[meta.id] || [];
  const foundDef = subgroupDefs.find(entry => entry.id === path || entry.paths.includes(path));
  const subgroupKey = foundDef?.id || path;
  const subgroupLabel = meta.labels?.[path] || foundDef?.label || label;
  const group = document.createElement('div');
  group.className = 'ink-subgroup';
  group.dataset.groupPath = subgroupKey;
  meta.groupElements?.set(subgroupKey, group);
  const subsectionId = `${meta.id}.${subgroupKey}`;
  if (subgroupLabel) {
    const headingRow = document.createElement('div');
    headingRow.className = 'ink-subheading-row';
    const headingWrap = document.createElement('div');
    headingWrap.className = 'ink-subheading-wrap';
    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'ink-subgroup-drag-handle';
    dragHandle.setAttribute('aria-label', `Reorder ${subgroupLabel}`);
    dragHandle.innerHTML = '<span aria-hidden="true">⋮</span>';
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'ink-subgroup-collapse';
    collapseBtn.setAttribute('aria-label', `Toggle ${subgroupLabel} details`);
    collapseBtn.textContent = '▸';
    collapseBtn.dataset.collapsed = '1';
    collapseBtn.setAttribute('aria-expanded', 'false');
    collapseBtn.addEventListener('click', () => {
      const next = !isSubgroupCollapsed(meta, subgroupKey);
      setSubgroupCollapsed(meta, subgroupKey, next);
    });
    const heading = document.createElement('div');
    heading.className = 'ink-subheading';
    const headingLabel = subgroupLabel;
    const lock = createLockToggle(headingLabel, locked => setGroupLocked(meta, subgroupKey, locked));
    heading.appendChild(lock);
    heading.appendChild(document.createTextNode(headingLabel));
    headingWrap.appendChild(dragHandle);
    headingWrap.appendChild(collapseBtn);
    headingWrap.appendChild(heading);
    headingRow.appendChild(headingWrap);
    if (path === 'fuzzExp') {
      const toggle = createInputForValue(obj.enable ?? false, `${path}.enable`, meta?.id);
      toggle.classList.add('ink-subheading-toggle');
      toggle.dataset.groupPath = subgroupKey;
      toggle.setAttribute('aria-label', `Toggle ${heading.textContent}`);
      toggle.title = `Toggle ${heading.textContent}`;
      headingRow.appendChild(toggle);
      registerMetaInput(meta, `${path}.enable`, toggle);
    }
    group.appendChild(headingRow);
    dragHandle.addEventListener('pointerdown', event => startPointerSubgroupDrag(event, meta, subgroupKey));
  }

  const body = document.createElement('div');
  body.className = 'ink-subgroup-body';
  group.appendChild(body);
  const footer = document.createElement('div');
  footer.className = 'ink-subgroup-footer';
  const divider = document.createElement('div');
  divider.className = 'ink-subgroup-divider';
  const attachFooter = () => {
    if (footer.parentElement) return;
    group.appendChild(footer);
    group.appendChild(divider);
  };

  // Attach per-subsection quality/scale controls for object-style subgroups (e.g., fuzzExp)
  const subsectionInfo = {
    subgroupId: path,
    subsectionId,
    qualityControl: null,
    scaleControl: null,
  };
  const qualityCfg = SUBSECTION_QUALITY_CONFIG[subsectionId];
  if (qualityCfg) {
    const qc = createQualityControl(meta, footer, qualityCfg, `${subsectionId}:quality`);
    if (qc) {
      const startQuality = getSubsectionQualityPercent(subsectionId, qualityCfg.defaultValue ?? EFFECT_QUALITY_DEFAULT);
      qc.slider.value = String(startQuality);
      qc.numberInput.value = String(startQuality);
      subsectionInfo.qualityControl = qc;
      attachFooter();
    }
  }
  const scaleCfg = SUBSECTION_SCALE_CONFIG[subsectionId];
  if (scaleCfg) {
    const sc = createScaleControl(meta, footer, scaleCfg, `${subsectionId}:scale`);
    if (sc) {
      const startScale = getSubsectionScalePercent(subsectionId, scaleCfg.defaultValue ?? EFFECT_SCALE_DEFAULT);
      sc.slider.value = String(startScale);
      sc.numberInput.value = String(startScale);
      subsectionInfo.scaleControl = sc;
      attachFooter();
    }
  }
  if (!meta.subsectionControls?.has(subgroupKey)) {
    meta.subsectionControls?.set(subgroupKey, subsectionInfo);
  }
  const initialCollapsed = isSubgroupCollapsed(meta, subgroupKey) || !meta.subgroupCollapsed.has(subgroupKey);
  setSubgroupCollapsed(meta, subgroupKey, initialCollapsed);

  const keys = getObjectKeys(path, obj);
  keys.forEach(key => {
    if (path === 'fuzzExp' && key === 'enable') return;
    const keyPath = path ? `${path}.${key}` : key;
    const value = obj[key];
    if (Array.isArray(value)) {
      buildArrayControls(meta, body, value, keyPath, key);
      return;
    }
    if (value && typeof value === 'object') {
      buildObjectControls(meta, body, value, keyPath, key);
      return;
    }
    const input = createInputForValue(value, keyPath, meta?.id);
    if (!input.dataset.enumOptions && typeof value === 'string') input.dataset.string = '1';
    const rowLabel = meta.labels?.[keyPath] || key;
    const row = buildControlRow(rowLabel, input);
    tagRowWithGroup(row, subgroupKey);
    body.appendChild(row);
    registerMetaInput(meta, keyPath, input);
  });
  setGroupLocked(meta, subgroupKey, isGroupLocked(meta, subgroupKey));
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

function createQualityControl(meta, container, cfg, lockScope = 'quality') {
  if (!meta || !container || !cfg) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'control-row control-row--quality control-row--with-lock';
  wrapper.dataset.lockLabel = cfg.label || 'Quality';
  const label = document.createElement('label');
  label.textContent = cfg.label || 'Quality';
  const lock = createLockToggle(cfg.label || 'Quality', locked => setQualityLocked(meta, locked, lockScope));
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(EFFECT_QUALITY_MIN);
  slider.max = String(EFFECT_QUALITY_MAX);
  slider.step = '5';
  slider.dataset.slider = '1';
  slider.dataset.precision = '0';
  const numberInput = document.createElement('input');
  numberInput.type = 'number';
  numberInput.min = slider.min;
  numberInput.max = slider.max;
  numberInput.step = slider.step;
  numberInput.setAttribute('aria-label', `${cfg.label || 'Quality'} value`);
  updateSliderDisplay(slider);
  slider.addEventListener('input', () => updateSliderDisplay(slider));
  wrapper.appendChild(lock);
  wrapper.appendChild(label);
  wrapper.appendChild(slider);
  wrapper.appendChild(numberInput);
  container.appendChild(wrapper);
  const control = {
    stateKey: cfg.stateKey,
    slider,
    numberInput,
    wrapper,
    lock,
    lockScope,
  };
  setQualityLocked(meta, isQualityLocked(meta, lockScope), lockScope);
  return control;
}

function createScaleControl(meta, container, cfg, lockScope = 'scale') {
  if (!meta || !container || !cfg) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'control-row control-row--quality control-row--with-lock';
  wrapper.dataset.lockLabel = cfg.label || 'Scale';
  const label = document.createElement('label');
  label.textContent = cfg.label || 'Scale';
  const lock = createLockToggle(cfg.label || 'Scale', locked => setScaleLocked(meta, locked, lockScope));
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(EFFECT_SCALE_MIN);
  slider.max = String(EFFECT_SCALE_MAX);
  slider.step = '5';
  slider.dataset.slider = '1';
  slider.dataset.precision = '0';
  const numberInput = document.createElement('input');
  numberInput.type = 'number';
  numberInput.min = slider.min;
  numberInput.max = slider.max;
  numberInput.step = slider.step;
  numberInput.setAttribute('aria-label', `${cfg.label || 'Scale'} value`);
  updateSliderDisplay(slider);
  slider.addEventListener('input', () => updateSliderDisplay(slider));
  wrapper.appendChild(lock);
  wrapper.appendChild(label);
  wrapper.appendChild(slider);
  wrapper.appendChild(numberInput);
  container.appendChild(wrapper);
  const control = {
    stateKey: cfg.stateKey,
    slider,
    numberInput,
    wrapper,
    lock,
    lockScope,
  };
  setScaleLocked(meta, isScaleLocked(meta, lockScope), lockScope);
  return control;
}

function buildSection(def, root) {
  if (def?.hidden) return null;
  const isCollapsible = def?.collapsible !== false;
  const sectionEl = document.createElement('section');
  sectionEl.className = 'ink-section';
  sectionEl.dataset.sectionId = def.id;

  const header = document.createElement('div');
  header.className = 'ink-section-header';
  const sectionHeadingEl = isCollapsible
    ? document.createElement('button')
    : document.createElement('div');
  if (isCollapsible) {
    sectionHeadingEl.type = 'button';
    sectionHeadingEl.className = 'ink-section-toggle';
    sectionHeadingEl.setAttribute('aria-expanded', 'false');
    const icon = document.createElement('span');
    icon.className = 'ink-section-toggle-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '▸';
    sectionHeadingEl.appendChild(icon);
  } else {
    sectionHeadingEl.className = 'ink-section-heading';
  }
  const title = document.createElement('span');
  title.className = 'ink-section-title';
  if (def.subheadingStyle === true) {
    title.classList.add('ink-section-title-subheading');
  }
  title.textContent = def.label;
  sectionHeadingEl.appendChild(title);

  const topLine = document.createElement('div');
  topLine.className = 'ink-section-topline';
  let dragHandle = null;
  if (def.dragHandle !== false) {
    dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'ink-section-drag-handle';
    dragHandle.setAttribute('aria-label', `Reorder ${def.label}`);
    dragHandle.innerHTML = '<span aria-hidden="true">⋮⋮</span>';
    topLine.appendChild(dragHandle);
  }
  topLine.appendChild(sectionHeadingEl);
  header.appendChild(topLine);

  const hasStrengthControl = typeof def.stateKey === 'string' && def.stateKey.length > 0;
  const shouldRenderCheckbox = hasStrengthControl && def.enableCheckbox !== false;
  let checkbox = null;
  let startPercent = def.defaultStrength ?? 0;
  if (hasStrengthControl) {
    startPercent = getPercentFromState(def.stateKey, def.defaultStrength ?? 0);
  }
  if (shouldRenderCheckbox) {
    const checkboxWrap = document.createElement('div');
    checkboxWrap.className = 'ink-section-enable';
    checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ink-section-enable-checkbox';
    checkbox.checked = startPercent > 0;
    checkbox.setAttribute('aria-label', `Toggle ${def.label}`);
    checkbox.title = `Toggle ${def.label}`;
    checkboxWrap.appendChild(checkbox);
    topLine.appendChild(checkboxWrap);
  }

  sectionEl.appendChild(header);

  const body = document.createElement('div');
  body.className = 'ink-section-body';
  const bodyId = `inkSection-${def.id}`;
  body.id = bodyId;
  if (isCollapsible) {
    sectionHeadingEl.setAttribute('aria-controls', bodyId);
  }
  const meta = {
    id: def.id,
    config: def.config,
    trigger: def.trigger,
    stateKey: def.stateKey,
    root: sectionEl,
    inputs: new Map(),
    groupElements: new Map(),
    checkbox,
    body,
    toggleButton: isCollapsible ? sectionHeadingEl : null,
    defaultStrength: def.defaultStrength ?? 0,
    hasStrengthControl,
    isCollapsible,
    qualityControl: null,
    scaleControl: null,
    subsectionControls: new Map(),
    subgroupCollapsed: new Map(),
  };

  const subgroupDefs = SUBGROUP_CONFIG[def.id] || [];
  const subgroupMap = new Map();

  const getSubgroup = path => {
    const found = subgroupDefs.find(entry => entry.paths.includes(path));
    if (!found) return null;
    if (subgroupMap.has(found.id)) return subgroupMap.get(found.id);
    const togglePath = found.paths.find(p => p.startsWith('enable.')) || null;
    const group = document.createElement('div');
    group.className = 'ink-subgroup';
    group.dataset.groupPath = found.id;
    const headingRow = document.createElement('div');
    headingRow.className = 'ink-subheading-row';
    const headingWrap = document.createElement('div');
    headingWrap.className = 'ink-subheading-wrap';
    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'ink-subgroup-drag-handle';
    dragHandle.setAttribute('aria-label', `Reorder ${found.label}`);
    dragHandle.innerHTML = '<span aria-hidden="true">⋮</span>';
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'ink-subgroup-collapse';
    collapseBtn.setAttribute('aria-label', `Toggle ${found.label} details`);
    collapseBtn.textContent = '▸';
    collapseBtn.dataset.collapsed = '1';
    collapseBtn.setAttribute('aria-expanded', 'false');
    collapseBtn.addEventListener('click', () => {
      const next = !isSubgroupCollapsed(meta, found.id);
      setSubgroupCollapsed(meta, found.id, next);
    });
    const heading = document.createElement('div');
    heading.className = 'ink-subheading';
    const lock = createLockToggle(found.label, locked => setGroupLocked(meta, found.id, locked));
    heading.appendChild(lock);
    heading.appendChild(document.createTextNode(found.label));
    headingWrap.appendChild(dragHandle);
    headingWrap.appendChild(collapseBtn);
    headingWrap.appendChild(heading);
    headingRow.appendChild(headingWrap);
    if (togglePath) {
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.classList.add('ink-subheading-toggle');
      toggle.dataset.groupPath = found.id;
      toggle.setAttribute('aria-label', `Toggle ${found.label}`);
      toggle.title = `Toggle ${found.label}`;
      headingRow.appendChild(toggle);
      registerMetaInput(meta, togglePath, toggle);
    }
    group.appendChild(headingRow);
    const body = document.createElement('div');
    body.className = 'ink-subgroup-body';
    group.appendChild(body);
    const footer = document.createElement('div');
    footer.className = 'ink-subgroup-footer';
    const divider = document.createElement('div');
    divider.className = 'ink-subgroup-divider';
    const attachFooter = () => {
      if (footer.parentElement) return;
      group.appendChild(footer);
      group.appendChild(divider);
    };
    meta.groupElements.set(found.id, group);
    meta.body.appendChild(group);
    setGroupLocked(meta, found.id, isGroupLocked(meta, found.id));
    const subsectionId = `${meta.id}.${found.id}`;
    const info = {
      group,
      body,
      footer,
      divider,
      togglePath,
      headingRow,
      subgroupId: found.id,
      subsectionId,
      qualityControl: null,
      scaleControl: null,
    };

    const qualityCfg = SUBSECTION_QUALITY_CONFIG[subsectionId];
    if (qualityCfg) {
      const qc = createQualityControl(meta, footer, qualityCfg, `${subsectionId}:quality`);
      if (qc) {
        const startQuality = getSubsectionQualityPercent(subsectionId, qualityCfg.defaultValue ?? EFFECT_QUALITY_DEFAULT);
        qc.slider.value = String(startQuality);
        qc.numberInput.value = String(startQuality);
        info.qualityControl = qc;
        attachFooter();
      }
    }

    const scaleCfg = SUBSECTION_SCALE_CONFIG[subsectionId];
    if (scaleCfg) {
      const sc = createScaleControl(meta, footer, scaleCfg, `${subsectionId}:scale`);
      if (sc) {
        const startScale = getSubsectionScalePercent(subsectionId, scaleCfg.defaultValue ?? EFFECT_SCALE_DEFAULT);
        sc.slider.value = String(startScale);
        sc.numberInput.value = String(startScale);
        info.scaleControl = sc;
        attachFooter();
      }
    }

    meta.subsectionControls.set(found.id, info);
    subgroupMap.set(found.id, info);
    dragHandle.addEventListener('pointerdown', event => startPointerSubgroupDrag(event, meta, found.id));
    const initialCollapsed = isSubgroupCollapsed(meta, found.id) || !meta.subgroupCollapsed.has(found.id);
    setSubgroupCollapsed(meta, found.id, initialCollapsed);
    return info;
  };

  if (dragHandle) {
    dragHandle.addEventListener('pointerdown', event => startPointerSectionDrag(event, meta));
  }

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
    const subgroup = getSubgroup(path);
    if (subgroup && subgroup.togglePath === path) {
      // Toggle lives in the heading row; no separate control row.
      const toggle = subgroup.headingRow.querySelector('.ink-subheading-toggle');
      if (toggle) {
        toggle.checked = !!value;
        toggle.disabled = isGroupLocked(meta, subgroup.group.dataset.groupPath);
      }
      return;
    }
    if (subgroup) {
      tagRowWithGroup(row, subgroup.group.dataset.groupPath);
      subgroup.body.appendChild(row);
    } else {
      body.appendChild(row);
    }
    registerMetaInput(meta, path, input);
  });

  ensureSubgroupLocks(meta);
  updateSubsectionDomOrder(def.id, getSectionSubsectionOrder(def.id));

  sectionEl.appendChild(body);
  root.appendChild(sectionEl);
  panelState.metas.push(meta);

  if (isCollapsible) {
    sectionHeadingEl.addEventListener('click', () => {
      setSectionCollapsed(meta, !meta.isCollapsed);
    });
  }
  if (checkbox) {
    checkbox.addEventListener('change', () => {
      const enabledStrength = meta.defaultStrength > 0 ? meta.defaultStrength : 100;
      const targetValue = checkbox.checked ? enabledStrength : 0;
      applySectionStrength(meta, targetValue);
    });
  }

  meta.subsectionControls.forEach(info => {
    const { qualityControl: qc, scaleControl: sc, subsectionId } = info || {};
    if (qc) {
      if (qc.slider) {
        qc.slider.addEventListener('input', () => {
          applySubsectionQuality(meta, subsectionId, Number.parseFloat(qc.slider.value));
        });
      }
      if (qc.numberInput) {
        qc.numberInput.addEventListener('input', () => {
          const raw = Number.parseFloat(qc.numberInput.value);
          if (!Number.isFinite(raw)) return;
          applySubsectionQuality(meta, subsectionId, raw);
        });
        qc.numberInput.addEventListener('blur', () => {
          if (qc.numberInput.value !== '') return;
          const fallback = getSubsectionQualityPercent(subsectionId, EFFECT_QUALITY_DEFAULT);
          applySubsectionQuality(meta, subsectionId, fallback, { silent: true });
        });
      }
    }

    if (sc) {
      if (sc.slider) {
        sc.slider.addEventListener('input', () => {
          applySubsectionScale(meta, subsectionId, Number.parseFloat(sc.slider.value));
        });
      }
      if (sc.numberInput) {
        sc.numberInput.addEventListener('input', () => {
          const raw = Number.parseFloat(sc.numberInput.value);
          if (!Number.isFinite(raw)) return;
          applySubsectionScale(meta, subsectionId, raw);
        });
        sc.numberInput.addEventListener('blur', () => {
          if (sc.numberInput.value !== '') return;
          const fallback = getSubsectionScalePercent(subsectionId, EFFECT_SCALE_DEFAULT);
          applySubsectionScale(meta, subsectionId, fallback, { silent: true });
        });
      }
    }
  });

  setSectionCollapsed(meta, isCollapsible);
  if (hasStrengthControl) {
    applySectionStrength(meta, startPercent, { silent: true, syncSlider: false, syncNumber: false });
  }
  return meta;
}

function snapshotCurrentStyleToState() {
  const appState = getAppState();
  if (!appState) return null;
  const existingId = typeof appState.currentInkStyle?.id === 'string'
    ? appState.currentInkStyle.id
    : CURRENT_STYLE_STATE_ID;
  const snapshot = createStyleSnapshot('Current style', existingId);
  if (snapshot) {
    appState.currentInkStyle = snapshot;
  }
  return snapshot;
}

function runWithPersistSuppressed(fn) {
  panelState.persistDepth = (panelState.persistDepth || 0) + 1;
  try {
    return typeof fn === 'function' ? fn() : undefined;
  } finally {
    panelState.persistDepth = Math.max(0, (panelState.persistDepth || 0) - 1);
  }
}

function persistPanelState() {
  if (panelState.persistDepth > 0) return;
  snapshotCurrentStyleToState();
  if (typeof panelState.saveState === 'function') {
    panelState.saveState();
  }
}

function scheduleGlyphRefresh(rebuildOrOptions = true, maybeOptions = undefined) {
  if (typeof panelState.callbacks.refreshGlyphs !== 'function') return;
  let rebuild = rebuildOrOptions;
  let options = maybeOptions;
  if (typeof rebuildOrOptions === 'object' && rebuildOrOptions !== null) {
    options = rebuildOrOptions;
    rebuild = options.rebuild;
  }
  const normalizedRebuild = rebuild !== false;
  const preserveFrontBuffer = options?.preserveFrontBuffer === true;
  if (panelState.pendingGlyphRAF) {
    if (normalizedRebuild && panelState.pendingGlyphOptions && panelState.pendingGlyphOptions.rebuild === false) {
      panelState.pendingGlyphOptions.rebuild = true;
    }
    if (panelState.pendingGlyphOptions && preserveFrontBuffer) {
      panelState.pendingGlyphOptions.preserveFrontBuffer = true;
    }
    return;
  }
  panelState.pendingGlyphOptions = {
    rebuild: normalizedRebuild,
    preserveFrontBuffer,
  };
  panelState.pendingGlyphRAF = requestAnimationFrame(() => {
    const opts = panelState.pendingGlyphOptions || { rebuild: normalizedRebuild, preserveFrontBuffer };
    panelState.pendingGlyphRAF = 0;
    panelState.pendingGlyphOptions = null;
    panelState.callbacks.refreshGlyphs({
      rebuild: opts.rebuild !== false,
      preserveFrontBuffer: opts.preserveFrontBuffer === true,
    });
  });
}

function scheduleRefreshForMeta(meta, options = {}) {
  if (!meta) return;
  if (meta.trigger === 'glyph') {
    const needsFullRebuild = options.forceRebuild === false ? false : true;
    const preserveFront = options.preserveFrontBuffer === false ? false : true;
    scheduleGlyphRefresh(needsFullRebuild, { preserveFrontBuffer: preserveFront });
  }
}

function scheduleSectionApply(meta, options = {}) {
  if (!meta) return;
  const target = meta;
  const pending = target._pendingApply || { forceRebuild: false, persist: false };
  pending.forceRebuild = pending.forceRebuild || options.forceRebuild === true;
  pending.persist = pending.persist || options.persist === true;
  target._pendingApply = pending;
  if (target._pendingApplyRaf) return;
  target._pendingApplyRaf = requestAnimationFrame(() => {
    const opts = target._pendingApply || {};
    target._pendingApply = null;
    target._pendingApplyRaf = 0;
    applySection(target, {
      forceRebuild: opts.forceRebuild !== false,
      persist: opts.persist !== false,
    });
  });
}

function applySectionStrength(meta, percent, options = {}) {
  if (!meta || !SECTION_STATE_KEY_MAP[meta.id]) return;
  const pct = clamp(Math.round(Number(percent) || 0), 0, 100);
  const shouldSyncCheckbox = options.syncCheckbox !== false && options.syncSlider !== false;
  if (shouldSyncCheckbox && meta.checkbox) {
    const shouldCheck = pct > 0;
    if (meta.checkbox.checked !== shouldCheck) {
      meta.checkbox.checked = shouldCheck;
    }
  }
  if (meta.root) {
    meta.root.classList.toggle('is-disabled', pct <= 0);
  }
  if (options.silent) return;
  if (meta.stateKey) {
    setPercentOnState(meta.stateKey, pct);
  }
  if (meta.hasStrengthControl && meta.config && typeof meta.config === 'object') {
    meta.config.enabled = pct > 0;
  }
  scheduleRefreshForMeta(meta);
  persistPanelState();
}

function applySubsectionQuality(meta, subsectionId, value, options = {}) {
  if (!meta || !subsectionId) return;
  const info = meta.subsectionControls?.get(subsectionId.split('.').pop()) || [...(meta.subsectionControls?.values() || [])].find(entry => entry?.subsectionId === subsectionId);
  const qc = info?.qualityControl;
  const targetId = info?.subsectionId || subsectionId;
  if (!qc) return;
  const normalized = clampQualityValue(value);
  if (options.syncInputs !== false) {
    if (qc.slider && qc.slider.value !== String(normalized)) {
      qc.slider.value = String(normalized);
      updateSliderDisplay(qc.slider);
    }
    if (qc.numberInput && qc.numberInput.value !== String(normalized)) {
      qc.numberInput.value = String(normalized);
    }
  }
  if (options.silent) return normalized;
  setSubsectionQualityPercent(targetId, normalized);
  scheduleGlyphRefresh(true, { preserveFrontBuffer: true });
  persistPanelState();
  return normalized;
}

function applySubsectionScale(meta, subsectionId, value, options = {}) {
  if (!meta || !subsectionId) return;
  const info = meta.subsectionControls?.get(subsectionId.split('.').pop()) || [...(meta.subsectionControls?.values() || [])].find(entry => entry?.subsectionId === subsectionId);
  const sc = info?.scaleControl;
  const targetId = info?.subsectionId || subsectionId;
  if (!sc) return;
  const normalized = clampScaleValue(value);
  if (options.syncInputs !== false) {
    if (sc.slider && sc.slider.value !== String(normalized)) {
      sc.slider.value = String(normalized);
      updateSliderDisplay(sc.slider);
    }
    if (sc.numberInput && sc.numberInput.value !== String(normalized)) {
      sc.numberInput.value = String(normalized);
    }
  }
  if (options.silent) return normalized;
  setSubsectionScalePercent(targetId, normalized);
  scheduleGlyphRefresh(true, { preserveFrontBuffer: true });
  persistPanelState();
  return normalized;
}

function syncQualityControl(meta) {
  if (!meta || !meta.subsectionControls) return;
  meta.subsectionControls.forEach(info => {
    const { qualityControl: qc, subsectionId } = info || {};
    if (!qc || !subsectionId) return;
    const value = getSubsectionQualityPercent(subsectionId, EFFECT_QUALITY_DEFAULT);
    if (qc.slider && qc.slider.value !== String(value)) {
      qc.slider.value = String(value);
    }
    if (qc.numberInput && qc.numberInput.value !== String(value)) {
      qc.numberInput.value = String(value);
    }
  });
}

function syncScaleControl(meta) {
  if (!meta || !meta.subsectionControls) return;
  meta.subsectionControls.forEach(info => {
    const { scaleControl: sc, subsectionId } = info || {};
    if (!sc || !subsectionId) return;
    const value = getSubsectionScalePercent(subsectionId, EFFECT_SCALE_DEFAULT);
    if (sc.slider && sc.slider.value !== String(value)) {
      sc.slider.value = String(value);
    }
    if (sc.numberInput && sc.numberInput.value !== String(value)) {
      sc.numberInput.value = String(value);
    }
  });
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

function applySection(meta, options = {}) {
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
  const forceRebuild = options.forceRebuild !== false;
  const persist = options.persist !== false;
  scheduleRefreshForMeta(meta, { forceRebuild });
  if (persist) {
    persistPanelState();
  }
  syncInputs(meta);
}

function applyConfigToTarget(target, source) {
  if (!target || typeof target !== 'object') return;
  if (!source || typeof source !== 'object') return;
  Object.keys(source).forEach(key => {
    target[key] = deepCloneValue(source[key]);
  });
}

function renderSavedStylesList(options = {}) {
  const { focusId } = options || {};
  let styles = [];
  try {
    styles = getSavedStyles();
  } catch (error) {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('Failed to read saved ink styles.', error);
    }
    styles = [];
  }
  if (!Array.isArray(styles)) styles = [];
  if (focusId) {
    panelState.selectedStyleId = focusId;
  }
  if (panelState.lastLoadedStyleId && !styles.some(style => style && style.id === panelState.lastLoadedStyleId)) {
    panelState.lastLoadedStyleId = null;
  }
  if (panelState.selectedStyleId && !styles.some(style => style && style.id === panelState.selectedStyleId)) {
    panelState.selectedStyleId = null;
  }
  const hasStyles = styles.length > 0;
  if (panelState.loadMenuButton) panelState.loadMenuButton.disabled = !hasStyles;
  if (panelState.deleteMenuButton) panelState.deleteMenuButton.disabled = !hasStyles;
  renderStyleActionMenu('load', styles);
  renderStyleActionMenu('delete', styles);
  if (!hasStyles) {
    closeStyleMenus();
  }
  updateStyleManagerStatus();
}

function isStyleDialogOpen() {
  return !!panelState.styleDialog?.classList.contains('open');
}

function openStyleDialog(mode = 'save', triggerTarget = null) {
  panelState.styleDialogMode = mode === 'file' ? 'file' : 'save';
  panelState.styleDialogFocusReturnTarget = triggerTarget || document.activeElement || null;

  const styles = getSavedStyles();
  const loadedStyle = findSavedStyleById(panelState.lastLoadedStyleId);
  const defaultBaseName = sanitizeStyleName(loadedStyle?.name)
    || sanitizeStyleName(panelState.transientStyleName)
    || 'Style';
  const suggestedName = panelState.styleDialogMode === 'save'
    ? ensureUniqueStyleName(defaultBaseName, styles)
    : defaultBaseName;

  if (loadedStyle) {
    syncIncludeInputsFromStyle(loadedStyle);
  } else {
    const current = getCurrentStyleFromState();
    syncIncludeInputsFromStyle(current || { includes: DEFAULT_STYLE_INCLUDES });
  }

  if (panelState.styleDialogTitle) {
    panelState.styleDialogTitle.textContent = panelState.styleDialogMode === 'save'
      ? 'Save style'
      : 'Save style to file';
  }
  if (panelState.styleDialogSubtitle) {
    panelState.styleDialogSubtitle.textContent = panelState.styleDialogMode === 'save'
      ? 'Create a reusable style from the current settings.'
      : 'Export the current settings to a local file.';
  }
  if (panelState.styleDialogConfirmButton) {
    panelState.styleDialogConfirmButton.textContent = panelState.styleDialogMode === 'save'
      ? 'Save style'
      : 'Save file';
  }
  if (panelState.styleDialogNameInput) {
    panelState.styleDialogNameInput.value = suggestedName;
    panelState.styleDialogNameInput.classList.remove('input-error');
  }
  closeStyleMenus();
  if (panelState.styleDialogScrim) {
    panelState.styleDialogScrim.classList.add('open');
    panelState.styleDialogScrim.setAttribute('aria-hidden', 'false');
  }
  if (panelState.styleDialog) {
    panelState.styleDialog.classList.add('open');
    panelState.styleDialog.setAttribute('aria-hidden', 'false');
  }
  if (panelState.styleDialogNameInput) {
    requestAnimationFrame(() => {
      panelState.styleDialogNameInput.focus();
      panelState.styleDialogNameInput.select();
    });
  }
}

function closeStyleDialog(options = {}) {
  const { restoreFocus = true } = options;
  if (panelState.styleDialogScrim) {
    panelState.styleDialogScrim.classList.remove('open');
    panelState.styleDialogScrim.setAttribute('aria-hidden', 'true');
  }
  if (panelState.styleDialog) {
    panelState.styleDialog.classList.remove('open');
    panelState.styleDialog.setAttribute('aria-hidden', 'true');
  }
  if (
    restoreFocus
    && panelState.styleDialogFocusReturnTarget
    && typeof panelState.styleDialogFocusReturnTarget.focus === 'function'
  ) {
    requestAnimationFrame(() => panelState.styleDialogFocusReturnTarget.focus());
  }
  panelState.styleDialogFocusReturnTarget = null;
}

function styleDialogDefaultSubtitle() {
  return panelState.styleDialogMode === 'save'
    ? 'Create a reusable style from the current settings.'
    : 'Export the current settings to a local file.';
}

function clearStyleDialogError() {
  if (!panelState.styleDialogSubtitle) return;
  panelState.styleDialogSubtitle.textContent = styleDialogDefaultSubtitle();
}

function showStyleDialogError(message) {
  if (!panelState.styleDialogSubtitle) return;
  panelState.styleDialogSubtitle.textContent = message;
}

function hasAnyIncludeSelected() {
  const includes = getIncludeSelectionFromInputs();
  return STYLE_INCLUDE_KEYS.some(key => includes[key]);
}

function saveStyleToLibrary(name) {
  try {
    const sanitized = sanitizeStyleName(name);
    if (!sanitized) {
      return { ok: false, error: 'Enter a style name before saving.' };
    }
    const styles = getSavedStyles();
    const existing = styles.find(style => (
      style
      && typeof style.name === 'string'
      && style.name.toLowerCase() === sanitized.toLowerCase()
    ));
    const existingId = existing?.id || null;
    if (existingId && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      const overwrite = window.confirm(`A style named "${existing.name}" already exists. Overwrite it?`);
      if (!overwrite) {
        return { ok: false, error: 'That name already exists. Use a different name or confirm overwrite.' };
      }
    }
    const snapshot = createStyleSnapshot(sanitized, existingId);
    if (!snapshot) {
      return { ok: false, error: 'Could not save this style. Please try again.' };
    }
    const updated = [
      snapshot,
      ...styles.filter(style => style && style.id !== snapshot.id),
    ];
    setSavedStyles(updated);
    persistPanelState();
    panelState.lastLoadedStyleId = snapshot.id;
    panelState.selectedStyleId = snapshot.id;
    panelState.transientStyleName = '';
    renderSavedStylesList({ focusId: snapshot.id });
    return { ok: true };
  } catch (error) {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('Failed to save style.', error);
    }
    return { ok: false, error: 'Could not save this style. Please try again.' };
  }
}

function saveStyleToFile(name) {
  try {
    const sanitized = sanitizeStyleName(name);
    if (!sanitized) {
      return { ok: false, error: 'Enter a style name before exporting.' };
    }
    const snapshot = createStyleSnapshot(sanitized);
    if (!snapshot) {
      return { ok: false, error: 'Could not export this style. Please try again.' };
    }
    exportStyleToFile(snapshot);
    return { ok: true };
  } catch (error) {
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('Failed to export style.', error);
    }
    return { ok: false, error: 'Could not export this style. Please try again.' };
  }
}

function handleStyleDialogConfirm(event) {
  if (event) event.preventDefault();
  const input = panelState.styleDialogNameInput;
  if (!input) return;
  const sanitized = sanitizeStyleName(input.value);
  input.classList.remove('input-error');
  clearStyleDialogError();
  if (!sanitized) {
    input.classList.add('input-error');
    showStyleDialogError('Enter a style name before saving.');
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return;
  }
  if (!hasAnyIncludeSelected()) {
    showStyleDialogError('Select at least one setting to include.');
    return;
  }
  const result = panelState.styleDialogMode === 'file'
    ? saveStyleToFile(sanitized)
    : saveStyleToLibrary(sanitized);
  if (result?.ok) {
    closeStyleDialog({ restoreFocus: false });
    return;
  }
  if (result?.error) {
    showStyleDialogError(result.error);
  }
}

function handleSaveStyle(event) {
  if (event) event.preventDefault();
  openStyleDialog('save', event?.currentTarget || null);
}

function handleSaveToFile(event) {
  if (event) event.preventDefault();
  openStyleDialog('file', event?.currentTarget || null);
}

function styleMenusContainTarget(target) {
  return (
    panelState.loadMenuButton?.contains(target)
    || panelState.deleteMenuButton?.contains(target)
    || panelState.loadMenu?.contains(target)
    || panelState.deleteMenu?.contains(target)
  );
}

function handleStyleManagerPointerDown(event) {
  if (!panelState.openMenuKind) return;
  if (styleMenusContainTarget(event.target)) return;
  closeStyleMenus();
}

function handleStyleManagerKeydown(event) {
  if (event.key !== 'Escape') return;
  if (isStyleDialogOpen()) {
    event.preventDefault();
    closeStyleDialog();
    return;
  }
  if (panelState.openMenuKind) {
    event.preventDefault();
    closeStyleMenus();
  }
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
  if (panelState.selectedStyleId === styleId) {
    panelState.selectedStyleId = null;
  }
  persistPanelState();
  renderSavedStylesList();
}

function resetInkSettingsToDefaults() {
  const snapshot = cloneDefaultStyleSnapshot();
  applyStyleSnapshot(snapshot, { persist: true, rememberLoaded: false, clearTransientStyle: true, refreshList: true });
}

function handleResetInkSettings() {
  resetInkSettingsToDefaults();
}

function randomizeInkSection(meta, options = {}) {
  if (!meta) return;
  const sectionOffChance = Number.isFinite(options.sectionOffChance)
    ? clamp(options.sectionOffChance, 0, 1)
    : SECTION_OFF_CHANCE_DEFAULT;
  const toggleOffChance = Number.isFinite(options.toggleOffChance)
    ? clamp(options.toggleOffChance, 0, 1)
    : TOGGLE_OFF_CHANCE_DEFAULT;
  const enabled = meta.id === 'filters' ? true : Math.random() >= sectionOffChance;
  const defaultOn = Number.isFinite(meta.defaultStrength) && meta.defaultStrength > 0 ? meta.defaultStrength : 100;
  const targetStrength = enabled
    ? Math.round(randomBetween(meta.id === 'filters' ? defaultOn : 20, 100, 1))
    : 0;
  applySectionStrength(meta, targetStrength, { syncSlider: true, syncNumber: true });

  meta.inputs.forEach(input => {
    const groupPath = input.dataset.groupPath;
    if (groupPath && isGroupLocked(meta, groupPath)) return;
    randomizeSingleInput(input, { offChance: toggleOffChance });
  });
  meta.subsectionControls?.forEach(info => {
    const subgroupId = info?.subgroupId || info?.subsectionId?.split('.')?.pop();
    if (subgroupId && isGroupLocked(meta, subgroupId)) return;
    if (info?.qualityControl && !isQualityLocked(meta, `${info.subsectionId}:quality`)) {
      applySubsectionQuality(meta, info.subsectionId, EFFECT_QUALITY_DEFAULT, { syncInputs: true });
    }
    if (info?.scaleControl && !isScaleLocked(meta, `${info.subsectionId}:scale`)) {
      const randScale = randomBetween(EFFECT_SCALE_MIN, EFFECT_SCALE_MAX, 5);
      applySubsectionScale(meta, info.subsectionId, randScale, { syncInputs: true });
    }
  });

  applySection(meta);
}

function randomizeInkSettings() {
  if (!panelState.initialized) return;
  const keepOrder = getKeepOrderFlagFromState();
  const { sectionOffChance, toggleOffChance } = pickRandomizationProfile();
  runWithPersistSuppressed(() => {
    // Randomize should keep overall strength at the default maximum.
    setOverallStrength(100);

    // Randomize section order unless keep-order toggle is enabled
    if (!keepOrder && Array.isArray(panelState.sectionOrder) && panelState.sectionOrder.length > 0) {
      const newOrder = shuffleArray(panelState.sectionOrder);
      // Apply order silently to avoid redundant refreshes; the subsequent section randomization will trigger the rebuild.
      applySectionOrder(newOrder, { syncDom: true, silent: true });
    }

    // Randomize subsection order for filters so filter order changes alongside settings unless order is locked
    if (!keepOrder) {
      const filterOrder = getSectionSubsectionOrder('filters');
      if (filterOrder.length) {
        const shuffledFilters = shuffleArray(filterOrder);
        applySubsectionOrderForSection('filters', shuffledFilters, { syncDom: true, silent: true });
      }
    }

    panelState.metas.forEach(meta => randomizeInkSection(meta, { sectionOffChance, toggleOffChance }));
  });
  persistPanelState();
  syncInkStrengthDisplays();
}

function handleRandomizeInkSettings() {
  randomizeInkSettings();
}

function applyStyleSnapshot(style, options = {}) {
  if (!style) return;
  const workingStyle = deepCloneValue(style);
  if (!workingStyle) return;
  const {
    persist = true,
    rememberLoaded = false,
    clearTransientStyle = true,
    refreshList = persist,
    focusLoadedStyle = rememberLoaded && workingStyle.id ? workingStyle.id : null,
  } = options;

  const applyCore = () => {
    if (Array.isArray(workingStyle.sectionOrder) && workingStyle.sectionOrder.length) {
      applySectionOrder(style.sectionOrder, {
        syncDom: true,
        silent: persist ? false : true,
      });
    }
    if (Array.isArray(workingStyle.subsectionOrder) && workingStyle.subsectionOrder.length) {
      applySubsectionOrder(workingStyle.subsectionOrder, {
        syncDom: true,
        silent: persist ? false : true,
      });
    }
    if (normalizeStyleIncludes(workingStyle.includes).effects && Number.isFinite(workingStyle.overall)) {
      setOverallStrength(workingStyle.overall);
    }
    const includeEffects = normalizeStyleIncludes(workingStyle.includes).effects;
    if (includeEffects) {
      SECTION_DEFS.forEach((def) => {
        const meta = findMetaById(def.id);
        if (!meta) return;
        const section = workingStyle.sections && workingStyle.sections[def.id];
        if (section && (Array.isArray(section.order) || Array.isArray(section.subsectionOrder))) {
          applySubsectionOrderForSection(def.id, section.order || section.subsectionOrder, {
            syncDom: true,
            silent: persist ? false : true,
          });
        }
        if (section && section.config) {
          applyConfigToTarget(meta.config, section.config);
          syncInputs(meta);
          scheduleRefreshForMeta(meta, { forceRebuild: true });
        } else {
          syncInputs(meta);
        }
        const strength = Number(section?.strength);
        if (meta.hasStrengthControl && Number.isFinite(strength)) {
          applySectionStrength(meta, strength);
        }
        if (meta.subsectionControls?.size) {
          meta.subsectionControls.forEach(info => {
            if (!info?.subsectionId) return;
            const subKey = info.subsectionId.split('.')[1];
            const qualityValue = section?.qualities && Object.prototype.hasOwnProperty.call(section.qualities, subKey)
              ? section.qualities[subKey]
              : Number(section?.quality);
            const scaleValue = section?.scales && Object.prototype.hasOwnProperty.call(section.scales, subKey)
              ? section.scales[subKey]
              : Number(section?.scale);
            if (info.qualityControl && Number.isFinite(qualityValue)) {
              applySubsectionQuality(meta, info.subsectionId, qualityValue);
            }
            if (info.scaleControl && Number.isFinite(scaleValue)) {
              applySubsectionScale(meta, info.subsectionId, scaleValue);
            }
          });
        }
      });
    }
    if (rememberLoaded && workingStyle.id) {
      panelState.lastLoadedStyleId = workingStyle.id;
      panelState.selectedStyleId = workingStyle.id;
      panelState.transientStyleName = '';
    } else if (!rememberLoaded) {
      panelState.lastLoadedStyleId = null;
      panelState.selectedStyleId = null;
    }
    if (clearTransientStyle) {
      panelState.transientStyleName = '';
    }
    syncIncludeInputsFromStyle(workingStyle);
  };

  const runAndMaybeRefresh = () => {
    applyCore();
    applyFontFromStyle(workingStyle);
    applySlantFromStyle(workingStyle);
    applyJitterFromStyle(workingStyle);
    if (refreshList) {
      renderSavedStylesList({ focusId: focusLoadedStyle });
    }
  };

  if (persist) {
    runAndMaybeRefresh();
  } else {
    runWithPersistSuppressed(runAndMaybeRefresh);
  }
}

function applySavedStyle(styleId) {
  const styles = getSavedStyles();
  const style = styles.find(s => s && s.id === styleId);
  if (!style) return;
  applyStyleSnapshot(style, { persist: true, rememberLoaded: true, refreshList: true, focusLoadedStyle: style.id });
}

export function hydrateInkSettingsFromState(options = {}) {
  if (!panelState.initialized) return;
  const fromState = getCurrentStyleFromState();
  const usedFallback = !fromState;
  const snapshot = usedFallback ? cloneDefaultStyleSnapshot() : deepCloneValue(fromState);
  if (!snapshot) return;
  applyStyleSnapshot(snapshot, {
    persist: false,
    rememberLoaded: false,
    clearTransientStyle: options.clearTransientStyle !== false,
    refreshList: options.refreshList === true,
  });
  if (usedFallback) {
    snapshotCurrentStyleToState();
  }
}

export function getInkEffectFactor() {
  const pct = getPercentFromState('effectsOverallStrength', 100);
  return normalizedPercent(pct);
}


export function getInkSectionStrength(sectionId) {
  const stateKey = SECTION_STATE_KEY_MAP[sectionId];
  if (!stateKey) return 1;
  const fallback = Number.isFinite(SECTION_DEF_MAP[sectionId]?.defaultStrength)
    ? SECTION_DEF_MAP[sectionId].defaultStrength
    : 100;
  return normalizedPercent(getPercentFromState(stateKey, fallback));
}

export function isInkSectionEnabled(sectionId) {
  if (!SECTION_STATE_KEY_MAP[sectionId]) {
    return true;
  }
  return getInkSectionStrength(sectionId) > 0;
}

export function getInkSectionOrder() {
  if (Array.isArray(panelState.sectionOrder) && panelState.sectionOrder.length) {
    return panelState.sectionOrder.slice();
  }
  return normalizeSectionOrder(getSectionOrderFromState());
}

export function getInkSubsectionOrder() {
  if (Array.isArray(panelState.subsectionOrder) && panelState.subsectionOrder.length) {
    return panelState.subsectionOrder.slice();
  }
  return normalizeSubsectionOrder(getSubsectionOrderFromState());
}

export function getExperimentalEffectsConfig() {
  return EXPERIMENTAL_EFFECTS_CONFIG;
}

export function getExperimentalQualitySettings() {
  const settings = {};
  Object.keys(SUBSECTION_QUALITY_CONFIG).forEach(subId => {
    settings[subId] = getSubsectionQualityPercent(subId, EFFECT_QUALITY_DEFAULT);
  });
  return settings;
}

export function getExperimentalScaleSettings() {
  const settings = {};
  Object.keys(SUBSECTION_SCALE_CONFIG).forEach(subId => {
    settings[subId] = getSubsectionScalePercent(subId, EFFECT_SCALE_DEFAULT);
  });
  return settings;
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
  scheduleGlyphRefresh(true, { preserveFrontBuffer: true });
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
      syncQualityControl(meta);
      syncScaleControl(meta);
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
  syncQualityControl(meta);
  syncScaleControl(meta);
}

export function setupInkSettingsPanel(options = {}) {
  if (panelState.initialized) return;
  const {
    state,
    app,
    metricsStore,
    refreshGlyphs,
    saveState,
  } = options || {};

  if (state && typeof state === 'object') {
    panelState.appState = state;
  }
  if (app && typeof app === 'object') {
    panelState.app = app;
  }
  if (metricsStore && typeof metricsStore === 'object') {
    panelState.metricsStore = metricsStore;
  }
  panelState.callbacks.refreshGlyphs = typeof refreshGlyphs === 'function' ? refreshGlyphs : null;
  panelState.saveState = typeof saveState === 'function' ? saveState : null;

  const sectionsRoot = document.getElementById('inkSettingsSections');
  panelState.overallSlider = document.getElementById('inkEffectsOverallSlider');
  panelState.overallNumberInput = document.getElementById('inkEffectsOverallNumber');
  panelState.saveStyleButton = document.getElementById('inkStyleSaveBtn');
  panelState.saveToFileButton = document.getElementById('inkStyleSaveToFileBtn');
  panelState.loadFromFileButton = document.getElementById('inkStyleLoadFromFileBtn');
  panelState.loadMenuButton = document.getElementById('inkStyleLoadMenuBtn');
  panelState.deleteMenuButton = document.getElementById('inkStyleDeleteMenuBtn');
  panelState.loadMenu = document.getElementById('inkStyleLoadMenu');
  panelState.deleteMenu = document.getElementById('inkStyleDeleteMenu');
  panelState.loadMenuList = document.getElementById('inkStyleLoadMenuList');
  panelState.deleteMenuList = document.getElementById('inkStyleDeleteMenuList');
  panelState.styleManagerStatus = document.getElementById('inkStyleManagerStatus');
  panelState.importInput = document.getElementById('inkStyleImportInput');
  panelState.styleDialogScrim = document.getElementById('inkStyleDialogScrim');
  panelState.styleDialog = document.getElementById('inkStyleDialog');
  panelState.styleDialogTitle = document.getElementById('inkStyleDialogTitle');
  panelState.styleDialogSubtitle = document.getElementById('inkStyleDialogSubtitle');
  panelState.styleDialogNameInput = document.getElementById('inkStyleDialogNameInput');
  panelState.styleDialogConfirmButton = document.getElementById('inkStyleDialogConfirmBtn');
  panelState.styleDialogCancelButton = document.getElementById('inkStyleDialogCancelBtn');
  panelState.resetButton = document.getElementById('inkStyleResetBtn');
  panelState.randomizeButton = document.getElementById('inkStyleRandomizeBtn');
  panelState.keepOrderCheckbox = document.getElementById('inkStyleKeepOrderCb');
  panelState.includeInputs = {
    font: document.getElementById('inkStyleIncludeFont'),
    slant: document.getElementById('inkStyleIncludeSlant'),
    jitter: document.getElementById('inkStyleIncludeJitter'),
    effects: document.getElementById('inkStyleIncludeEffects'),
  };
  panelState.sectionsRoot = sectionsRoot;

  panelState.sectionOrder = normalizeSectionOrder(getSectionOrderFromState());
  setSectionOrderOnState(panelState.sectionOrder);
  panelState.subsectionOrder = normalizeSubsectionOrder(getSubsectionOrderFromState());
  setSubsectionOrderOnState(panelState.subsectionOrder);
  if (panelState.keepOrderCheckbox) {
    panelState.keepOrderCheckbox.checked = getKeepOrderFlagFromState();
    panelState.keepOrderCheckbox.addEventListener('change', () => {
      setKeepOrderFlagOnState(panelState.keepOrderCheckbox.checked);
      persistPanelState();
    });
  }

  if (panelState.saveStyleButton) {
    panelState.saveStyleButton.addEventListener('click', handleSaveStyle);
  }
  if (panelState.saveToFileButton) {
    panelState.saveToFileButton.addEventListener('click', handleSaveToFile);
  }
  if (panelState.loadFromFileButton && panelState.importInput) {
    panelState.loadFromFileButton.addEventListener('click', () => {
      closeStyleMenus();
      panelState.importInput.click();
    });
  }
  if (panelState.importInput) {
    panelState.importInput.addEventListener('change', handleImportInputChange);
  }
  if (panelState.loadMenuButton) {
    panelState.loadMenuButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleStyleMenu('load');
    });
  }
  if (panelState.deleteMenuButton) {
    panelState.deleteMenuButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleStyleMenu('delete');
    });
  }
  if (panelState.loadMenu) {
    panelState.loadMenu.addEventListener('pointerdown', (event) => event.stopPropagation());
  }
  if (panelState.deleteMenu) {
    panelState.deleteMenu.addEventListener('pointerdown', (event) => event.stopPropagation());
  }
  if (panelState.styleDialogNameInput) {
    panelState.styleDialogNameInput.addEventListener('input', () => {
      panelState.styleDialogNameInput.classList.remove('input-error');
      clearStyleDialogError();
    });
    panelState.styleDialogNameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleStyleDialogConfirm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeStyleDialog();
      }
    });
  }
  if (panelState.styleDialogConfirmButton) {
    panelState.styleDialogConfirmButton.addEventListener('click', handleStyleDialogConfirm);
  }
  if (panelState.styleDialogCancelButton) {
    panelState.styleDialogCancelButton.addEventListener('click', () => closeStyleDialog());
  }
  if (panelState.styleDialogScrim) {
    panelState.styleDialogScrim.addEventListener('click', () => closeStyleDialog());
  }
  document.addEventListener('pointerdown', handleStyleManagerPointerDown);
  document.addEventListener('keydown', handleStyleManagerKeydown);
  if (panelState.resetButton) {
    panelState.resetButton.addEventListener('click', handleResetInkSettings);
  }
  if (panelState.randomizeButton) {
    panelState.randomizeButton.addEventListener('click', handleRandomizeInkSettings);
  }

  syncIncludeInputsFromStyle(getCurrentStyleFromState());
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
    const seen = new Set();
    panelState.sectionOrder.forEach(id => {
      const def = SECTION_DEF_MAP[id];
      if (!def) return;
      const meta = buildSection(def, sectionsRoot);
      if (meta) {
        seen.add(def.id);
        syncInputs(meta);
      }
    });
    SECTION_DEFS.forEach(def => {
      if (seen.has(def.id)) return;
      const meta = buildSection(def, sectionsRoot);
      if (meta) {
        panelState.sectionOrder.push(def.id);
        syncInputs(meta);
      }
    });
    applySectionOrder(panelState.sectionOrder, { skipStateUpdate: true, syncDom: true, silent: true });
  }

  panelState.initialized = true;
  syncInkStrengthDisplays();
}

export function refreshSavedInkStylesUI() {
  renderSavedStylesList();
}
