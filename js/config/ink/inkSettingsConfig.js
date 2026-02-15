import {
  DEFAULT_INK_SUBSECTION_ORDER,
  cloneDefaultExperimentalConfig,
  getDefaultInkSectionStrength,
  getDefaultInkSectionQuality,
  getDefaultInkSubsectionQuality,
  getDefaultInkSubsectionScale,
} from '../inkEffectDefaultStyle.js';

// Local clamp to avoid pulling in broader utils inside config-only module.
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

export const INPUT_OVERRIDES = {
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

export function getInputOverride(sectionId, path) {
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

export const EXPERIMENTAL_EFFECTS_CONFIG = cloneDefaultExperimentalConfig();

export const EXP_TONE_KEYS = [
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

export const EXP_EDGE_KEYS = [
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

export const EXP_EDGE_LABELS = {
  fuzzExp: 'Grain',
  'fuzzExp.thicken': 'Thicken',
  'fuzzExp.patchFill': 'Fill',
};

export const EXP_GRAIN_KEYS = [
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

export const EXP_DEFECT_KEYS = [
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

export const FILTER_KEYS = [
  ...EXP_TONE_KEYS,
  ...EXP_EDGE_KEYS,
  ...EXP_GRAIN_KEYS,
  ...EXP_DEFECT_KEYS,
];

export const FILTER_LABELS = {
  ...EXP_EDGE_LABELS,
};

export const SECTION_DEFS = [
  {
    id: 'filters',
    label: 'Filters',
    subheadingStyle: true,
    mode: 'experimental',
    config: EXPERIMENTAL_EFFECTS_CONFIG,
    keyOrder: FILTER_KEYS,
    labels: FILTER_LABELS,
    trigger: 'glyph',
    stateKey: 'filtersStrength',
    defaultStrength: getDefaultInkSectionStrength('filters'),
    enableCheckbox: false,
    dragHandle: false,
    collapsible: false,
  },
];

export const EFFECT_QUALITY_DEFAULT = 100;
export const EFFECT_QUALITY_MIN = 0;
export const EFFECT_QUALITY_MAX = 200;

export const EFFECT_SCALE_DEFAULT = 100;
export const EFFECT_SCALE_MIN = 0;
export const EFFECT_SCALE_MAX = 200;

export const SUBGROUP_CONFIG = {
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

export const SUBSECTION_STAGE_MAP = Object.freeze({
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

export const SUBSECTION_DEFS = [];
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

export const SUBSECTION_DEF_MAP = SUBSECTION_DEFS.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {});

export const DEFAULT_SUBSECTION_ORDER = DEFAULT_INK_SUBSECTION_ORDER.slice();

export const SUBSECTION_IDS_BY_SECTION = SUBSECTION_DEFS.reduce((acc, def) => {
  if (!acc[def.sectionId]) acc[def.sectionId] = [];
  acc[def.sectionId].push(def.id);
  return acc;
}, {});

export const SUBSECTION_QUALITY_CONFIG = Object.freeze(
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

export const SUBSECTION_SCALE_CONFIG = Object.freeze(
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

export const VISIBLE_SECTION_DEFS = SECTION_DEFS.filter(def => !def.hidden);
export const DEFAULT_SECTION_ORDER = VISIBLE_SECTION_DEFS.map(def => def.id);
export const SECTION_DEF_MAP = SECTION_DEFS.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {});
export const SECTION_STATE_KEY_MAP = SECTION_DEFS.reduce((acc, def) => {
  if (def.stateKey) {
    acc[def.id] = def.stateKey;
  }
  return acc;
}, {});

export function normalizeSectionOrder(order, fallback = DEFAULT_SECTION_ORDER) {
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

export function normalizeSubsectionOrder(order, sectionId = null, fallback = DEFAULT_SUBSECTION_ORDER) {
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
