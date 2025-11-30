import {
  DEFAULT_INK_SUBSECTION_ORDER,
  cloneDefaultExperimentalConfig,
  getDefaultInkSectionStrength,
  getDefaultInkSectionQuality,
  getDefaultInkSubsectionQuality,
  getDefaultInkSubsectionScale,
} from './inkEffectDefaultStyle.js';

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const INPUT_OVERRIDES = {
  'filters.ink.pressureMid': { type: 'range', min: 0, max: 1.6, step: 0.01, precision: 2 },
  'filters.ink.pressureVar': { type: 'range', min: 0, max: 0.8, step: 0.01, precision: 2 },
  'filters.ink.inkGamma': { type: 'range', min: 0.4, max: 2.5, step: 0.01, precision: 2 },
  'filters.ink.toneJitter': { type: 'range', min: 0, max: 0.6, step: 0.01, precision: 2 },
  'filters.ribbon.height': { type: 'range', min: 0.05, max: 1, step: 0.01, precision: 2 },
  'filters.ribbon.position': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.ribbon.delta': { type: 'range', min: -0.5, max: 0.5, step: 0.01, precision: 2 },
  'filters.ribbon.fade': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.ribbon.wobble': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.noise.lfScale': { type: 'range', min: 8, max: 40, step: 0.5, precision: 2 },
  'filters.centerEdge.center': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.centerEdge.edge': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.ink.rim': { type: 'range', min: 0, max: 0.8, step: 0.01, precision: 2 },
  'filters.ink.rimCurve': { type: 'range', min: 0.4, max: 3, step: 0.01, precision: 2 },
  'filters.edgeFuzz.opacity': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.edgeFuzz.inBand': { type: 'range', min: 0, max: 4, step: 0.01, precision: 2 },
  'filters.edgeFuzz.outBand': { type: 'range', min: 0, max: 1.5, step: 0.01, precision: 2 },
  'filters.edgeFuzz.rough': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.edgeFuzz.scale': { type: 'range', min: 2, max: 64, step: 1, precision: 0 },
  'filters.edgeFuzz.mix': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.counterFill.transparency': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.counterFill.fill': { type: 'range', min: 0, max: 2, step: 0.01, precision: 2 },
  'filters.counterFill.coverage': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.counterFill.noise': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.fuzzExp.thicken': { type: 'range', min: 0, max: 3, step: 0.01, precision: 2 },
  'filters.fuzzExp.patchFill': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.centerEdge.thicken': { type: 'range', min: 0, max: 1.5, step: 0.01, precision: 2 },
  'filters.centerEdge.patchFill': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.centerEdge.patchSize': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.ink.mottling': { type: 'range', min: 0, max: 3, step: 0.01, precision: 2 },
  'filters.ink.speckDark': { type: 'range', min: 0, max: 3, step: 0.01, precision: 2 },
  'filters.ink.speckLight': { type: 'range', min: 0, max: 3, step: 0.01, precision: 2 },
  'filters.ink.speckGrayBias': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.dropouts.amount': { type: 'range', min: 0, max: 2, step: 0.01, precision: 2 },
  'filters.dropouts.width': { type: 'range', min: 0, max: 5, step: 0.01, precision: 2 },
  'filters.dropouts.scale': { type: 'range', min: 2, max: 64, step: 1, precision: 0 },
  'filters.dropouts.pinhole': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.dropouts.streakDensity': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.dropouts.pinholeWeight': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.smudge.strength': { type: 'range', min: 0, max: 2, step: 0.01, precision: 2 },
  'filters.smudge.radius': { type: 'range', min: 0, max: 15, step: 0.25, precision: 2 },
  'filters.smudge.falloff': { type: 'range', min: 0, max: 4, step: 0.01, precision: 2 },
  'filters.smudge.scale': { type: 'range', min: 2, max: 64, step: 1, precision: 0 },
  'filters.smudge.density': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.smudge.dirDeg': { type: 'range', min: 0, max: 360, step: 1, precision: 0 },
  'filters.smudge.spread': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.punch.chance': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'filters.punch.count': { type: 'range', min: 0, max: 10, step: 1, precision: 0 },
  'filters.punch.rMin': { type: 'range', min: 0.002, max: 0.08, step: 0.001, precision: 3 },
  'filters.punch.rMax': { type: 'range', min: 0.004, max: 0.12, step: 0.001, precision: 3 },
  'filters.punch.edgeBias': { type: 'range', min: -1, max: 1, step: 0.01, precision: 2 },
  'filters.punch.soft': { type: 'range', min: 0, max: 0.4, step: 0.005, precision: 3 },
  'filters.punch.intensity': { type: 'range', min: 0, max: 1.5, step: 0.01, precision: 2 },
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

// Classic fill helpers have been removed; experimental sections manage their own config.

const EXPERIMENTAL_EFFECTS_CONFIG = cloneDefaultExperimentalConfig();

const EXP_TONE_KEYS = [
  { path: 'enable.toneDynamics', label: 'Variations' },
  { path: 'ink.pressureMid', label: 'Pressure' },
  { path: 'ink.pressureVar', label: 'Variance' },
  { path: 'ink.inkGamma', label: 'Gamma' },
  { path: 'ink.toneJitter', label: 'Jitter' },
  { path: 'noise.lfScale', label: 'Scale' },
  { path: 'enable.ribbonBands', label: 'Ribbon' },
  { path: 'ribbon.height', label: 'Height' },
  { path: 'ribbon.position', label: 'Position' },
  { path: 'ribbon.delta', label: 'Shift' },
  { path: 'ribbon.fade', label: 'Fade' },
  { path: 'ribbon.wobble', label: 'Wobble' },
];

const EXP_EDGE_KEYS = [
  { path: 'enable.rim', label: 'Rim' },
  { path: 'ink.rim', label: 'Strength' },
  { path: 'ink.rimCurve', label: 'Curve' },
  { path: 'enable.edgeFuzz', label: 'Fuzz' },
  { path: 'edgeFuzz.opacity', label: 'Opacity' },
  { path: 'edgeFuzz.inBand', label: 'Inner' },
  { path: 'edgeFuzz.outBand', label: 'Outer' },
  { path: 'edgeFuzz.rough', label: 'Roughness' },
  { path: 'edgeFuzz.scale', label: 'Scale' },
  { path: 'edgeFuzz.mix', label: 'Mix' },
  { path: 'enable.counterFill', label: 'Enable' },
  { path: 'counterFill.transparency', label: 'Opacity' },
  { path: 'counterFill.fill', label: 'Fill' },
  { path: 'counterFill.coverage', label: 'Coverage' },
  { path: 'counterFill.noise', label: 'Noise' },
  { path: 'fuzzExp', label: 'Grain' },
  { path: 'enable.centerEdge', label: 'Weight' },
  { path: 'centerEdge.center', label: 'Center' },
  { path: 'centerEdge.edge', label: 'Thinning' },
  { path: 'centerEdge.thicken', label: 'Thickening' },
  { path: 'centerEdge.patchFill', label: 'Coverage' },
  { path: 'centerEdge.patchSize', label: 'Scale' },
];

const EXP_EDGE_LABELS = {
  fuzzExp: 'Grain',
  'fuzzExp.thicken': 'Thicken',
  'fuzzExp.patchFill': 'Fill',
};

const EXP_GRAIN_KEYS = [
  { path: 'enable.grainSpeck', label: 'Speckle' },
  { path: 'ink.mottling', label: 'Mottling' },
  { path: 'ink.speckDark', label: 'Dark' },
  { path: 'ink.speckLight', label: 'Light' },
  { path: 'ink.speckGrayBias', label: 'Gray bias' },
  { path: 'enable.dropouts', label: 'Dropouts' },
  { path: 'dropouts.amount', label: 'Amount' },
  { path: 'dropouts.width', label: 'Width' },
  { path: 'dropouts.scale', label: 'Scale' },
  { path: 'dropouts.pinhole', label: 'Pinholes' },
  { path: 'dropouts.streakDensity', label: 'Streaks' },
  { path: 'dropouts.pinholeWeight', label: 'Mix' },
];

const EXP_DEFECT_KEYS = [
  { path: 'enable.smudge', label: 'Smudge halo' },
  { path: 'smudge.strength', label: 'Strength' },
  { path: 'smudge.radius', label: 'Radius' },
  { path: 'smudge.falloff', label: 'Falloff' },
  { path: 'smudge.scale', label: 'Scale' },
  { path: 'smudge.density', label: 'Density' },
  { path: 'smudge.dirDeg', label: 'Direction' },
  { path: 'smudge.spread', label: 'Spread' },
  { path: 'enable.punch', label: 'Punch defects' },
  { path: 'punch.chance', label: 'Chance' },
  { path: 'punch.count', label: 'Count' },
  { path: 'punch.rMin', label: 'Size min' },
  { path: 'punch.rMax', label: 'Size max' },
  { path: 'punch.edgeBias', label: 'Edge bias' },
  { path: 'punch.soft', label: 'Softness' },
  { path: 'punch.intensity', label: 'Brightness' },
];

const FILTER_KEYS = [
  ...EXP_TONE_KEYS,
  ...EXP_EDGE_KEYS,
  ...EXP_GRAIN_KEYS,
  ...EXP_DEFECT_KEYS,
];

const FILTER_LABELS = {
  ...EXP_EDGE_LABELS,
};

const SECTION_DEFS = [
  {
    id: 'filters',
    label: 'Filters',
    mode: 'experimental',
    config: EXPERIMENTAL_EFFECTS_CONFIG,
    keyOrder: FILTER_KEYS,
    labels: FILTER_LABELS,
    trigger: 'glyph',
    stateKey: 'filtersStrength',
    defaultStrength: getDefaultInkSectionStrength('filters'),
  },
];

const EFFECT_QUALITY_DEFAULT = 100;
const EFFECT_QUALITY_MIN = 0;
const EFFECT_QUALITY_MAX = 200;

const EFFECT_SCALE_DEFAULT = 100;
const EFFECT_SCALE_MIN = 0;
const EFFECT_SCALE_MAX = 200;

const SUBGROUP_CONFIG = {
  filters: [
    { id: 'variations', label: 'Variations', paths: ['enable.toneDynamics', 'ink.pressureMid', 'ink.pressureVar', 'ink.inkGamma', 'ink.toneJitter', 'noise.lfScale'] },
    { id: 'ribbon', label: 'Ribbon', paths: ['enable.ribbonBands', 'ribbon.height', 'ribbon.position', 'ribbon.delta', 'ribbon.fade', 'ribbon.wobble'] },
    { id: 'rim', label: 'Rim', paths: ['enable.rim', 'ink.rim', 'ink.rimCurve'] },
    { id: 'fuzz', label: 'Fuzz', paths: ['enable.edgeFuzz', 'edgeFuzz.opacity', 'edgeFuzz.inBand', 'edgeFuzz.outBand', 'edgeFuzz.rough', 'edgeFuzz.scale', 'edgeFuzz.mix'] },
    { id: 'counterFill', label: 'Counter fill', paths: ['enable.counterFill', 'counterFill.transparency', 'counterFill.fill', 'counterFill.coverage', 'counterFill.noise'] },
    { id: 'grain', label: 'Grain', paths: ['fuzzExp', 'fuzzExp.enable', 'fuzzExp.thicken', 'fuzzExp.patchFill'] },
    { id: 'weight', label: 'Weight', paths: ['enable.centerEdge', 'centerEdge.center', 'centerEdge.edge', 'centerEdge.thicken', 'centerEdge.patchFill', 'centerEdge.patchSize'] },
    { id: 'speckle', label: 'Speckle', paths: ['enable.grainSpeck', 'ink.mottling', 'ink.speckDark', 'ink.speckLight', 'ink.speckGrayBias'] },
    { id: 'dropouts', label: 'Dropouts', paths: ['enable.dropouts', 'dropouts.amount', 'dropouts.width', 'dropouts.scale', 'dropouts.pinhole', 'dropouts.streakDensity', 'dropouts.pinholeWeight'] },
    { id: 'smudge', label: 'Smudge halo', paths: ['enable.smudge', 'smudge.strength', 'smudge.radius', 'smudge.falloff', 'smudge.scale', 'smudge.density', 'smudge.dirDeg', 'smudge.spread'] },
    { id: 'punch', label: 'Punch defects', paths: ['enable.punch', 'punch.chance', 'punch.count', 'punch.rMin', 'punch.rMax', 'punch.edgeBias', 'punch.soft', 'punch.intensity'] },
  ],
};

const SUBSECTION_STAGE_MAP = Object.freeze({
  'filters.variations': ['tone'],
  'filters.ribbon': ['tone'],
  'filters.rim': ['tone'],
  'filters.fuzz': ['fuzz'],
  'filters.counterFill': ['counterFill'],
  'filters.grain': ['fuzzExp'],
  'filters.weight': ['centerEdge'],
  'filters.speckle': ['texture'],
  'filters.dropouts': ['dropouts'],
  'filters.smudge': ['smudge'],
  'filters.punch': ['punch'],
});

function makeSubsectionStateKey(sectionId, subgroupId, suffix) {
  if (!sectionId || !subgroupId || !suffix) return null;
  const cap = subgroupId.charAt(0).toUpperCase() + subgroupId.slice(1);
  return `${sectionId}${cap}${suffix}`;
}

const SUBSECTION_DEFS = [];
Object.entries(SUBGROUP_CONFIG).forEach(([sectionId, subgroups]) => {
  subgroups.forEach(sub => {
    const id = `${sectionId}.${sub.id}`;
    SUBSECTION_DEFS.push({
      id,
      sectionId,
      subgroupId: sub.id,
      label: sub.label,
      qualityStateKey: makeSubsectionStateKey(sectionId, sub.id, 'Quality'),
      scaleStateKey: makeSubsectionStateKey(sectionId, sub.id, 'Scale'),
      defaultQuality: getDefaultInkSubsectionQuality(id),
      defaultScale: getDefaultInkSubsectionScale(id),
      stageIds: SUBSECTION_STAGE_MAP[id] || [],
    });
  });
});

const SUBSECTION_DEF_MAP = SUBSECTION_DEFS.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {});

const DEFAULT_SUBSECTION_ORDER = DEFAULT_INK_SUBSECTION_ORDER.slice();

const SUBSECTION_IDS_BY_SECTION = SUBSECTION_DEFS.reduce((acc, def) => {
  if (!acc[def.sectionId]) acc[def.sectionId] = [];
  acc[def.sectionId].push(def.id);
  return acc;
}, {});

const SUBSECTION_QUALITY_CONFIG = Object.freeze(
  SUBSECTION_DEFS.reduce((acc, def) => {
    acc[def.id] = {
      stateKey: def.qualityStateKey,
      label: 'Quality',
      defaultValue: def.defaultQuality,
      sectionId: def.sectionId,
    };
    return acc;
  }, {})
);

const SUBSECTION_SCALE_CONFIG = Object.freeze(
  SUBSECTION_DEFS.reduce((acc, def) => {
    acc[def.id] = {
      stateKey: def.scaleStateKey,
      label: 'Scale',
      defaultValue: def.defaultScale,
      sectionId: def.sectionId,
    };
    return acc;
  }, {})
);

const VISIBLE_SECTION_DEFS = SECTION_DEFS.filter(def => !def.hidden);
const DEFAULT_SECTION_ORDER = VISIBLE_SECTION_DEFS.map(def => def.id);
const SECTION_DEF_MAP = SECTION_DEFS.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {});
const SECTION_STATE_KEY_MAP = SECTION_DEFS.reduce((acc, def) => {
  if (def.stateKey) {
    acc[def.id] = def.stateKey;
  }
  return acc;
}, {});

const CURRENT_STYLE_STATE_ID = 'current-style';

function normalizeSectionOrder(order, fallback = DEFAULT_SECTION_ORDER) {
  const base = Array.isArray(order) ? order : [];
  const seen = new Set();
  const normalized = [];
  base.forEach(id => {
    if (typeof id !== 'string') return;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return;
    const def = SECTION_DEF_MAP[trimmed];
    if (!def || def.hidden) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  (Array.isArray(fallback) ? fallback : DEFAULT_SECTION_ORDER).forEach(id => {
    const def = SECTION_DEF_MAP[id];
    if (!def || def.hidden) return;
    if (seen.has(id)) return;
    seen.add(id);
    normalized.push(id);
  });
  return normalized;
}

function normalizeSubsectionOrder(order, sectionId = null, fallback = DEFAULT_SUBSECTION_ORDER) {
  const base = Array.isArray(order) ? order : [];
  const allowed = sectionId
    ? SUBSECTION_IDS_BY_SECTION[sectionId] || []
    : DEFAULT_SUBSECTION_ORDER;
  const seen = new Set();
  const normalized = [];
  base.forEach(id => {
    if (typeof id !== 'string') return;
    const trimmed = id.trim();
    if (!trimmed) return;
    const fullId = sectionId && !trimmed.includes('.') ? `${sectionId}.${trimmed}` : trimmed;
    if (seen.has(fullId)) return;
    if (!SUBSECTION_DEF_MAP[fullId]) return;
    if (sectionId && !fullId.startsWith(`${sectionId}.`)) return;
    seen.add(fullId);
    normalized.push(fullId);
  });
  (Array.isArray(fallback) ? fallback : DEFAULT_SUBSECTION_ORDER).forEach(id => {
    if (sectionId && !id.startsWith(`${sectionId}.`)) return;
    if (!SUBSECTION_DEF_MAP[id]) return;
    if (seen.has(id)) return;
    seen.add(id);
    normalized.push(id);
  });
  return normalized;
}

const panelState = {
  appState: null,
  app: null,
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
  styleNameInput: null,
  saveStyleButton: null,
  stylesList: null,
  lastLoadedStyleId: null,
  exportButton: null,
  importButton: null,
  importInput: null,
  resetButton: null,
  randomizeButton: null,
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

function extractDropoutsConfig(source) {
  if (!source || typeof source !== 'object') return null;
  const config = source.config != null
    ? source.config
    : source.settings != null
      ? source.settings
      : source;
  const dropouts = config && typeof config === 'object' && config.dropouts && typeof config.dropouts === 'object'
    ? deepCloneValue(config.dropouts)
    : null;
  const enabled = config && typeof config.enable === 'object' && typeof config.enable.dropouts === 'boolean'
    ? config.enable.dropouts
    : null;
  if (dropouts || enabled !== null) {
    return { dropouts, enabled };
  }
  return null;
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
    let subsectionOrder = normalizeSubsectionOrder(
      style?.subsectionOrder
      || style?.inkSubsectionOrder
      || style?.sections?.subsectionOrder
      || style?.subsectionsOrder
      || DEFAULT_SUBSECTION_ORDER
    );
    const record = {
      id: typeof style?.id === 'string' && style.id.trim() ? style.id.trim() : generateStyleId(),
      name: sanitizeStyleName(style?.name) || `Style ${index + 1}`,
      overall: clamp(Math.round(Number(style?.overall ?? style?.strength ?? 100)), 0, 100),
      sections: {},
      sectionOrder: normalizeSectionOrder(style?.sectionOrder || style?.sections?.order || style?.inkSectionOrder || style?.inkSectionsOrder || style?.sectionOrder),
      subsectionOrder: normalizeSubsectionOrder(subsectionOrder),
    };
    const legacySectionStrengths = ['expTone', 'expEdge', 'expGrain', 'expDefects']
      .map(id => style?.sections?.[id]?.strength ?? style?.[id]?.strength)
      .filter(val => Number.isFinite(val));
    const legacyStrengthFallback = legacySectionStrengths.length
      ? Math.max(...legacySectionStrengths)
      : null;
    SECTION_DEFS.forEach(def => {
      const rawSection = style?.sections && typeof style.sections === 'object'
        ? style.sections[def.id]
        : (style && typeof style === 'object' && typeof style[def.id] === 'object' ? style[def.id] : null);
      let section = rawSection && typeof rawSection === 'object' ? rawSection : {};
      if (!rawSection) {
        const mergedConfig = deepCloneValue(def.config);
        ['expTone', 'expEdge', 'expGrain', 'expDefects'].forEach(legacyId => {
          const legacy = style?.sections?.[legacyId] || style?.[legacyId];
          if (!legacy || typeof legacy !== 'object') return;
          applyConfigToTarget(mergedConfig, legacy.config ?? legacy.settings ?? legacy);
        });
        section = { ...section, config: mergedConfig };
      }
      const strength = clamp(Math.round(Number(section?.strength ?? legacyStrengthFallback ?? def.defaultStrength ?? 0)), 0, 100);
      let configSource = section.config != null
        ? section.config
        : section.settings != null
          ? section.settings
          : ('strength' in section ? def.config : section);
      record.sections[def.id] = {
        strength,
        config: deepCloneValue(configSource == null ? def.config : configSource),
        qualities: {},
        scales: {},
        order: [],
      };
      const subsectionIds = SUBSECTION_IDS_BY_SECTION[def.id] || [];
      subsectionIds.forEach(subId => {
        const subKey = subId.split('.')[1];
        const legacySectionId = {
          variations: 'expTone',
          ribbon: 'expTone',
          rim: 'expEdge',
          fuzz: 'expEdge',
          counterFill: 'expEdge',
          grain: 'expEdge',
          weight: 'expEdge',
          speckle: 'expGrain',
          dropouts: 'expGrain',
          smudge: 'expDefects',
          punch: 'expDefects',
        }[subKey];
        const defaultQuality = getDefaultInkSubsectionQuality(subId);
        const qualitySource = section?.qualities?.[subKey]
          ?? section?.qualities?.[subId]
          ?? section?.quality
          ?? (legacySectionId ? style?.sections?.[legacySectionId]?.qualities?.[subKey] : null)
          ?? (legacySectionId ? style?.sections?.[legacySectionId]?.qualities?.[`${legacySectionId}.${subKey}`] : null)
          ?? (legacySectionId ? style?.[legacySectionId]?.qualities?.[subKey] : null)
          ?? (legacySectionId ? style?.[legacySectionId]?.qualities?.[`${legacySectionId}.${subKey}`] : null)
          ?? getDefaultInkSectionQuality(def.id);
        record.sections[def.id].qualities[subKey] = clampQualityValue(
          qualitySource,
          defaultQuality,
        );
        const defaultScale = getDefaultInkSubsectionScale(subId);
        const scaleSource = section?.scales?.[subKey]
          ?? section?.scales?.[subId]
          ?? section?.scale
          ?? (legacySectionId ? style?.sections?.[legacySectionId]?.scales?.[subKey] : null)
          ?? (legacySectionId ? style?.sections?.[legacySectionId]?.scales?.[`${legacySectionId}.${subKey}`] : null)
          ?? (legacySectionId ? style?.[legacySectionId]?.scales?.[subKey] : null)
          ?? (legacySectionId ? style?.[legacySectionId]?.scales?.[`${legacySectionId}.${subKey}`] : null)
          ?? EFFECT_SCALE_DEFAULT;
        record.sections[def.id].scales[subKey] = clampScaleValue(
          scaleSource,
          defaultScale,
        );
      });
      const sectionOrder = normalizeSubsectionOrder(
        section?.order || section?.subsectionOrder,
        def.id,
        subsectionOrder,
      );
      const fallbackOrder = normalizeSubsectionOrder(subsectionOrder, def.id, SUBSECTION_IDS_BY_SECTION[def.id]);
      record.sections[def.id].order = sectionOrder.length ? sectionOrder : fallbackOrder;
      if (sectionOrder.length) {
        const withoutSection = subsectionOrder.filter(id => !id.startsWith(`${def.id}.`));
        subsectionOrder = normalizeSubsectionOrder([...withoutSection, ...sectionOrder]);
      }
    });
    const legacyDropouts = extractDropoutsConfig(style?.sections?.filters || style?.filters || style?.sections?.expDefects || style?.expDefects);
    if (legacyDropouts && record.sections.filters) {
      const filtersSection = record.sections.filters;
      if (legacyDropouts.dropouts) {
        filtersSection.config.dropouts = legacyDropouts.dropouts;
      }
      if (legacyDropouts.enabled !== null) {
        filtersSection.config.enable = {
          ...(filtersSection.config.enable || {}),
          dropouts: legacyDropouts.enabled,
        };
      }
    }
    record.subsectionOrder = normalizeSubsectionOrder(subsectionOrder);
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
    sections: {},
    sectionOrder: DEFAULT_SECTION_ORDER.slice(),
    subsectionOrder: DEFAULT_SUBSECTION_ORDER.slice(),
  };
  SECTION_DEFS.forEach(def => {
    record.sections[def.id] = {
      strength: def.defaultStrength ?? 0,
      config: deepCloneValue(def.config),
      qualities: {},
      scales: {},
      order: (SUBSECTION_IDS_BY_SECTION[def.id] || []).slice(),
    };
    const subsectionIds = SUBSECTION_IDS_BY_SECTION[def.id] || [];
    subsectionIds.forEach(subId => {
      const subKey = subId.split('.')[1];
      record.sections[def.id].qualities[subKey] = getDefaultInkSubsectionQuality(subId);
      record.sections[def.id].scales[subKey] = getDefaultInkSubsectionScale(subId);
    });
  });
  return record;
}

const DEFAULT_STYLE_SNAPSHOT = createDefaultStyleRecord(0);

function cloneDefaultStyleSnapshot() {
  return deepCloneValue(DEFAULT_STYLE_SNAPSHOT);
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
    sections: {},
    sectionOrder: Array.isArray(panelState.sectionOrder)
      ? panelState.sectionOrder.slice()
      : DEFAULT_SECTION_ORDER.slice(),
    subsectionOrder: Array.isArray(panelState.subsectionOrder)
      ? panelState.subsectionOrder.slice()
      : DEFAULT_SUBSECTION_ORDER.slice(),
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

const SECTION_OFF_CHANCE = 0.10;
const TOGGLE_OFF_CHANCE = 0.20;

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
  const dragHandle = document.createElement('button');
  dragHandle.type = 'button';
  dragHandle.className = 'ink-section-drag-handle';
  dragHandle.setAttribute('aria-label', `Reorder ${def.label}`);
  dragHandle.innerHTML = '<span aria-hidden="true">⋮⋮</span>';
  topLine.appendChild(dragHandle);
  topLine.appendChild(toggleBtn);
  header.appendChild(topLine);

  const hasStrengthControl = typeof def.stateKey === 'string' && def.stateKey.length > 0;
  let checkbox = null;
  let startPercent = def.defaultStrength ?? 0;
  if (hasStrengthControl) {
    startPercent = getPercentFromState(def.stateKey, def.defaultStrength ?? 0);
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
  toggleBtn.setAttribute('aria-controls', bodyId);
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
    toggleButton: toggleBtn,
    defaultStrength: def.defaultStrength ?? 0,
    hasStrengthControl,
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

  dragHandle.addEventListener('pointerdown', event => startPointerSectionDrag(event, meta));

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

  toggleBtn.addEventListener('click', () => {
    setSectionCollapsed(meta, !meta.isCollapsed);
  });
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

  setSectionCollapsed(meta, true);
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

function resetInkSettingsToDefaults() {
  const snapshot = cloneDefaultStyleSnapshot();
  applyStyleSnapshot(snapshot, { persist: true, rememberLoaded: false, updateStyleName: true, refreshList: true });
}

function handleResetInkSettings() {
  let confirmed = true;
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    confirmed = window.confirm('Reset all ink settings to their default values?');
  }
  if (!confirmed) return;
  resetInkSettingsToDefaults();
}

function randomizeInkSection(meta) {
  if (!meta) return;
  const enabled = meta.id === 'filters' ? true : Math.random() >= SECTION_OFF_CHANCE;
  const defaultOn = Number.isFinite(meta.defaultStrength) && meta.defaultStrength > 0 ? meta.defaultStrength : 100;
  const targetStrength = enabled
    ? Math.round(randomBetween(meta.id === 'filters' ? defaultOn : 20, 100, 1))
    : 0;
  applySectionStrength(meta, targetStrength, { syncSlider: true, syncNumber: true });

  meta.inputs.forEach(input => {
    const groupPath = input.dataset.groupPath;
    if (groupPath && isGroupLocked(meta, groupPath)) return;
    randomizeSingleInput(input, { offChance: TOGGLE_OFF_CHANCE });
  });
  meta.subsectionControls?.forEach(info => {
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
  runWithPersistSuppressed(() => {
    // Randomize should keep overall strength at the default maximum.
    setOverallStrength(100);

    // Randomize section order
    if (Array.isArray(panelState.sectionOrder) && panelState.sectionOrder.length > 0) {
      const newOrder = shuffleArray(panelState.sectionOrder);
      // Apply order silently to avoid redundant refreshes; the subsequent section randomization will trigger the rebuild.
      applySectionOrder(newOrder, { syncDom: true, silent: true });
    }

    // Randomize subsection order for filters so filter order changes alongside settings
    const filterOrder = getSectionSubsectionOrder('filters');
    if (filterOrder.length) {
      const shuffledFilters = shuffleArray(filterOrder);
      applySubsectionOrderForSection('filters', shuffledFilters, { syncDom: true, silent: true });
    }

    panelState.metas.forEach(meta => randomizeInkSection(meta));
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
    updateStyleName = true,
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
    if (Number.isFinite(workingStyle.overall)) {
      setOverallStrength(workingStyle.overall);
    }
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
    if (rememberLoaded && workingStyle.id) {
      panelState.lastLoadedStyleId = workingStyle.id;
    } else if (!rememberLoaded) {
      panelState.lastLoadedStyleId = null;
    }
    if (updateStyleName && panelState.styleNameInput) {
      panelState.styleNameInput.value = workingStyle.name || 'Current style';
      panelState.styleNameInput.classList.remove('input-error');
    }
  };

  const runAndMaybeRefresh = () => {
    applyCore();
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
    updateStyleName: options.updateStyleName !== false,
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
    refreshGlyphs,
    saveState,
  } = options || {};

  if (state && typeof state === 'object') {
    panelState.appState = state;
  }
  if (app && typeof app === 'object') {
    panelState.app = app;
  }
  panelState.callbacks.refreshGlyphs = typeof refreshGlyphs === 'function' ? refreshGlyphs : null;
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
  panelState.resetButton = document.getElementById('inkStyleResetBtn');
  panelState.randomizeButton = document.getElementById('inkStyleRandomizeBtn');
  panelState.sectionsRoot = sectionsRoot;

  panelState.sectionOrder = normalizeSectionOrder(getSectionOrderFromState());
  setSectionOrderOnState(panelState.sectionOrder);
  panelState.subsectionOrder = normalizeSubsectionOrder(getSubsectionOrderFromState());
  setSubsectionOrderOnState(panelState.subsectionOrder);

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
  if (panelState.resetButton) {
    panelState.resetButton.addEventListener('click', handleResetInkSettings);
  }
  if (panelState.randomizeButton) {
    panelState.randomizeButton.addEventListener('click', handleRandomizeInkSettings);
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
