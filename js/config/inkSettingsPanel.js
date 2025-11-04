import { EDGE_BLEED, EDGE_FUZZ, GRAIN_CFG, INK_INTENSITY, INK_TEXTURE, normalizeEdgeBleedConfig, normalizeInkTextureConfig } from './inkConfig.js';

const sanitizedInkTextureDefaults = normalizeInkTextureConfig(INK_TEXTURE);
Object.assign(INK_TEXTURE, sanitizedInkTextureDefaults);

const sanitizedEdgeBleedDefaults = normalizeEdgeBleedConfig(EDGE_BLEED);
Object.assign(EDGE_BLEED, sanitizedEdgeBleedDefaults);

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const DEFAULT_INK_EFFECT_MODE = 'classic';
const INK_EFFECT_MODE_LABELS = {
  classic: 'Legacy effects',
  experimental: 'Experimental effects',
};

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
  'expTone.ink.pressureMid': { type: 'range', min: 0, max: 1.6, step: 0.01, precision: 2 },
  'expTone.ink.pressureVar': { type: 'range', min: 0, max: 0.8, step: 0.01, precision: 2 },
  'expTone.ink.inkGamma': { type: 'range', min: 0.4, max: 2.5, step: 0.01, precision: 2 },
  'expTone.ink.toneJitter': { type: 'range', min: 0, max: 0.6, step: 0.01, precision: 2 },
  'expTone.ribbon.amp': { type: 'range', min: 0, max: 0.5, step: 0.01, precision: 2 },
  'expTone.ribbon.period': { type: 'range', min: 3, max: 30, step: 0.5, precision: 2 },
  'expTone.ribbon.sharp': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expTone.bias.vertical': { type: 'range', min: -1, max: 1, step: 0.01, precision: 2 },
  'expTone.bias.amount': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expTone.centerEdge.center': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expTone.centerEdge.edge': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expEdge.ink.rim': { type: 'range', min: 0, max: 0.8, step: 0.01, precision: 2 },
  'expEdge.ink.rimCurve': { type: 'range', min: 0.4, max: 3, step: 0.01, precision: 2 },
  'expEdge.edgeFuzz.opacity': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expEdge.edgeFuzz.inBand': { type: 'range', min: 0, max: 24, step: 0.25, precision: 2 },
  'expEdge.edgeFuzz.outBand': { type: 'range', min: 0, max: 24, step: 0.25, precision: 2 },
  'expEdge.edgeFuzz.rough': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expEdge.edgeFuzz.scale': { type: 'range', min: 2, max: 64, step: 1, precision: 0 },
  'expEdge.edgeFuzz.mix': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expGrain.ink.mottling': { type: 'range', min: 0, max: 0.8, step: 0.01, precision: 2 },
  'expGrain.ink.speckDark': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expGrain.ink.speckLight': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expGrain.ink.speckGrayBias': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expDefects.dropouts.amount': { type: 'range', min: 0, max: 2, step: 0.01, precision: 2 },
  'expDefects.dropouts.width': { type: 'range', min: 0, max: 12, step: 0.25, precision: 2 },
  'expDefects.dropouts.scale': { type: 'range', min: 2, max: 64, step: 1, precision: 0 },
  'expDefects.dropouts.pinhole': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expDefects.dropouts.streakDensity': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expDefects.dropouts.pinholeWeight': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expDefects.smudge.strength': { type: 'range', min: 0, max: 2, step: 0.01, precision: 2 },
  'expDefects.smudge.radius': { type: 'range', min: 0, max: 32, step: 0.25, precision: 2 },
  'expDefects.smudge.falloff': { type: 'range', min: 0, max: 4, step: 0.01, precision: 2 },
  'expDefects.smudge.scale': { type: 'range', min: 2, max: 64, step: 1, precision: 0 },
  'expDefects.smudge.density': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expDefects.smudge.dirDeg': { type: 'range', min: 0, max: 360, step: 1, precision: 0 },
  'expDefects.smudge.spread': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expDefects.punch.chance': { type: 'range', min: 0, max: 1, step: 0.01, precision: 2 },
  'expDefects.punch.count': { type: 'range', min: 0, max: 10, step: 1, precision: 0 },
  'expDefects.punch.rMin': { type: 'range', min: 0.002, max: 0.08, step: 0.001, precision: 3 },
  'expDefects.punch.rMax': { type: 'range', min: 0.004, max: 0.12, step: 0.001, precision: 3 },
  'expDefects.punch.edgeBias': { type: 'range', min: -1, max: 1, step: 0.01, precision: 2 },
  'expDefects.punch.soft': { type: 'range', min: 0, max: 0.4, step: 0.005, precision: 3 },
  'expDefects.punch.intensity': { type: 'range', min: 0, max: 1.5, step: 0.01, precision: 2 },
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

const EXPERIMENTAL_EFFECTS_CONFIG = {
  enable: {
    toneCore: true,
    vBias: true,
    rim: false,
    centerEdge: false,
    grainSpeck: true,
    dropouts: true,
    edgeFuzz: true,
    smudge: true,
    punch: true,
  },
  ink: {
    pressureMid: 0.83,
    pressureVar: 0.32,
    inkGamma: 1.34,
    toneJitter: 0.42,
    rim: 0.27,
    rimCurve: 2.21,
    mottling: 0.11,
    speckDark: 0.21,
    speckLight: 0.53,
    speckGrayBias: 0.51,
  },
  ribbon: {
    amp: 0.1,
    period: 8.5,
    sharp: 0.15,
    phase: 0,
  },
  bias: {
    vertical: -0.84,
    amount: 0.36,
  },
  noise: {
    lfScale: 22,
    hfScale: 1,
  },
  centerEdge: {
    center: 0.28,
    edge: 0,
  },
  dropouts: {
    amount: 0.57,
    width: 10,
    scale: 25,
    pinhole: 0.36,
    streakDensity: 0.2,
    pinholeWeight: 0.28,
  },
  edgeFuzz: {
    opacity: 0.23,
    inBand: 2,
    outBand: 2,
    rough: 0.63,
    scale: 6,
    mix: 0.38,
  },
  smudge: {
    strength: 0.57,
    radius: 15,
    falloff: 1.39,
    scale: 24,
    density: 0.33,
    dirDeg: 300,
    spread: 0.5,
  },
  punch: {
    chance: 0.51,
    count: 2,
    rMin: 0.004,
    rMax: 0.082,
    edgeBias: 0.8,
    soft: 0.295,
    intensity: 0.96,
  },
};

const EXP_TONE_KEYS = [
  { path: 'enable.toneCore', label: 'Enable tone core' },
  { path: 'ink.pressureMid', label: 'Pressure mid' },
  { path: 'ink.pressureVar', label: 'Pressure variance' },
  { path: 'ink.inkGamma', label: 'Ink gamma' },
  { path: 'ink.toneJitter', label: 'Tone jitter' },
  { path: 'ribbon.amp', label: 'Ribbon amplitude' },
  { path: 'ribbon.period', label: 'Ribbon period' },
  { path: 'ribbon.sharp', label: 'Ribbon sharpness' },
  { path: 'enable.vBias', label: 'Enable vertical bias' },
  { path: 'bias.vertical', label: 'Vertical bias' },
  { path: 'bias.amount', label: 'Bias amount' },
  { path: 'enable.centerEdge', label: 'Enable center/edge shaping' },
  { path: 'centerEdge.center', label: 'Center boost' },
  { path: 'centerEdge.edge', label: 'Edge boost' },
];

const EXP_EDGE_KEYS = [
  { path: 'enable.rim', label: 'Enable rim lighting' },
  { path: 'ink.rim', label: 'Rim strength' },
  { path: 'ink.rimCurve', label: 'Rim curve' },
  { path: 'enable.edgeFuzz', label: 'Enable edge fuzz' },
  { path: 'edgeFuzz.opacity', label: 'Edge fuzz opacity' },
  { path: 'edgeFuzz.inBand', label: 'Inner fuzz band (px)' },
  { path: 'edgeFuzz.outBand', label: 'Outer fuzz band (px)' },
  { path: 'edgeFuzz.rough', label: 'Fuzz roughness' },
  { path: 'edgeFuzz.scale', label: 'Fuzz scale (px)' },
  { path: 'edgeFuzz.mix', label: 'Fuzz mix' },
];

const EXP_GRAIN_KEYS = [
  { path: 'enable.grainSpeck', label: 'Enable grain speckle' },
  { path: 'ink.mottling', label: 'Mottling' },
  { path: 'ink.speckDark', label: 'Dark specks' },
  { path: 'ink.speckLight', label: 'Light specks' },
  { path: 'ink.speckGrayBias', label: 'Speck gray bias' },
];

const EXP_DEFECT_KEYS = [
  { path: 'enable.dropouts', label: 'Enable dropouts' },
  { path: 'dropouts.amount', label: 'Dropout amount' },
  { path: 'dropouts.width', label: 'Dropout width (px)' },
  { path: 'dropouts.scale', label: 'Dropout scale (px)' },
  { path: 'dropouts.pinhole', label: 'Pinhole density' },
  { path: 'dropouts.streakDensity', label: 'Streak density' },
  { path: 'dropouts.pinholeWeight', label: 'Pinhole weight' },
  { path: 'enable.smudge', label: 'Enable smudge halo' },
  { path: 'smudge.strength', label: 'Smudge strength' },
  { path: 'smudge.radius', label: 'Smudge radius (px)' },
  { path: 'smudge.falloff', label: 'Smudge falloff' },
  { path: 'smudge.scale', label: 'Smudge scale (px)' },
  { path: 'smudge.density', label: 'Smudge density' },
  { path: 'smudge.dirDeg', label: 'Smudge direction (deg)' },
  { path: 'smudge.spread', label: 'Smudge spread' },
  { path: 'enable.punch', label: 'Enable punch defects' },
  { path: 'punch.chance', label: 'Punch chance' },
  { path: 'punch.count', label: 'Punch count' },
  { path: 'punch.rMin', label: 'Punch size min' },
  { path: 'punch.rMax', label: 'Punch size max' },
  { path: 'punch.edgeBias', label: 'Edge bias' },
  { path: 'punch.soft', label: 'Punch softness' },
  { path: 'punch.intensity', label: 'Punch intensity' },
];

const SECTION_DEFS = [
  {
    id: 'fill',
    label: 'Fill',
    mode: 'classic',
    config: FILL_CFG,
    keyOrder: [
      { path: 'centerThickenPct', label: 'Center thickening' },
      { path: 'edgeThinPct', label: 'Edge thinning' },
    ],
    trigger: 'glyph',
    stateKey: 'inkFillStrength',
    defaultStrength: 100,
  },
  {
    id: 'texture',
    label: 'Texture',
    mode: 'classic',
    config: INK_TEXTURE,
    keyOrder: ['supersample', 'coarseNoise', 'fineNoise', 'noiseSmoothing', 'centerEdgeBias', 'noiseFloor', 'chip', 'scratch', 'jitterSeed'],
    trigger: 'glyph',
    stateKey: 'inkTextureStrength',
    defaultStrength: INK_TEXTURE.enabled === false ? 0 : 100,
  },
  {
    id: 'fuzz',
    label: 'Edge Fuzz',
    mode: 'classic',
    config: EDGE_FUZZ,
    keyOrder: ['inks', 'widthPx', 'inwardShare', 'roughness', 'frequency', 'opacity', 'seed'],
    trigger: 'glyph',
    stateKey: 'edgeFuzzStrength',
    defaultStrength: 100,
  },
  {
    id: 'bleed',
    label: 'Bleed',
    mode: 'classic',
    config: EDGE_BLEED,
    keyOrder: ['inks', 'widthPx', 'feather', 'lightnessShift', 'noiseRoughness', 'intensity', 'seed'],
    trigger: 'glyph',
    stateKey: 'edgeBleedStrength',
    defaultStrength: EDGE_BLEED.enabled === false ? 0 : 100,
  },
  {
    id: 'grain',
    label: 'Grain',
    mode: 'classic',
    config: GRAIN_CFG,
    keyOrder: ['scale', 'gamma', 'opacity', 'blend_mode', 'tile', 'base_scale_from_char_w', 'octave_rel_scales', 'octave_weights', 'pixel_hash_weight', 'alpha', 'seeds'],
    trigger: 'grain',
    stateKey: 'grainPct',
    defaultStrength: 0,
  },
  {
    id: 'expTone',
    label: 'Experimental tone & ribbon',
    mode: 'experimental',
    config: EXPERIMENTAL_EFFECTS_CONFIG,
    keyOrder: EXP_TONE_KEYS,
    trigger: 'glyph',
    stateKey: null,
    defaultStrength: 100,
  },
  {
    id: 'expEdge',
    label: 'Experimental edge shaping',
    mode: 'experimental',
    config: EXPERIMENTAL_EFFECTS_CONFIG,
    keyOrder: EXP_EDGE_KEYS,
    trigger: 'glyph',
    stateKey: null,
    defaultStrength: 100,
  },
  {
    id: 'expGrain',
    label: 'Experimental texture',
    mode: 'experimental',
    config: EXPERIMENTAL_EFFECTS_CONFIG,
    keyOrder: EXP_GRAIN_KEYS,
    trigger: 'glyph',
    stateKey: null,
    defaultStrength: 100,
  },
  {
    id: 'expDefects',
    label: 'Experimental defects',
    mode: 'experimental',
    config: EXPERIMENTAL_EFFECTS_CONFIG,
    keyOrder: EXP_DEFECT_KEYS,
    trigger: 'glyph',
    stateKey: null,
    defaultStrength: 100,
  },
];

const DEFAULT_SECTION_ORDER = SECTION_DEFS.map(def => def.id);
const SECTION_DEF_MAP = SECTION_DEFS.reduce((acc, def) => {
  acc[def.id] = def;
  return acc;
}, {});

function normalizeSectionOrder(order, fallback = DEFAULT_SECTION_ORDER) {
  const base = Array.isArray(order) ? order : [];
  const seen = new Set();
  const normalized = [];
  base.forEach(id => {
    if (typeof id !== 'string') return;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return;
    if (!Object.prototype.hasOwnProperty.call(SECTION_DEF_MAP, trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  (Array.isArray(fallback) ? fallback : DEFAULT_SECTION_ORDER).forEach(id => {
    if (!Object.prototype.hasOwnProperty.call(SECTION_DEF_MAP, id)) return;
    if (seen.has(id)) return;
    seen.add(id);
    normalized.push(id);
  });
  return normalized;
}

function normalizeInkEffectsMode(mode) {
  if (typeof mode !== 'string') return DEFAULT_INK_EFFECT_MODE;
  const trimmed = mode.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(INK_EFFECT_MODE_LABELS, trimmed)
    ? trimmed
    : DEFAULT_INK_EFFECT_MODE;
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
  sectionOrder: DEFAULT_SECTION_ORDER.slice(),
  dragState: null,
  modeRadios: [],
  currentMode: DEFAULT_INK_EFFECT_MODE,
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
    record.inkEffectsMode = normalizeInkEffectsMode(style?.inkEffectsMode ?? style?.effectsMode);
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
    inkEffectsMode: DEFAULT_INK_EFFECT_MODE,
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
    sectionOrder: Array.isArray(panelState.sectionOrder)
      ? panelState.sectionOrder.slice()
      : DEFAULT_SECTION_ORDER.slice(),
    inkEffectsMode: getInkEffectsModeFromState(),
  };
  SECTION_DEFS.forEach(def => {
    const meta = findMetaById(def.id);
    const configSource = meta && meta.config ? meta.config : def.config;
    const strengthValue = def.stateKey
      ? getPercentFromState(def.stateKey, def.defaultStrength ?? 0)
      : (Number.isFinite(def.defaultStrength) ? def.defaultStrength : 100);
    base.sections[def.id] = {
      strength: strengthValue,
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

function getInkEffectsModeFromState() {
  const appState = getAppState();
  if (!appState) return DEFAULT_INK_EFFECT_MODE;
  const mode = normalizeInkEffectsMode(appState.inkEffectsMode);
  appState.inkEffectsMode = mode;
  return mode;
}

function setInkEffectsModeOnState(mode) {
  const appState = getAppState();
  if (!appState) return DEFAULT_INK_EFFECT_MODE;
  const normalized = normalizeInkEffectsMode(mode);
  appState.inkEffectsMode = normalized;
  return normalized;
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
    scheduleGlyphRefresh(true);
    scheduleGrainRefresh();
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

function startPointerSectionDrag(event, meta) {
  if (!meta || !meta.root) return;
  if (event?.button !== undefined && event.button !== 0) return;
  if (typeof event?.pointerId !== 'number') return;
  const handle = event.currentTarget;
  if (!handle) return;

  event.preventDefault();

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
    commitPointerSectionDrop();
    endSectionDrag();
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

function setMetaModeDisabled(meta, disabled) {
  if (!meta) return;
  const shouldDisable = !!disabled;
  if (meta.slider) meta.slider.disabled = shouldDisable;
  if (meta.numberInput) meta.numberInput.disabled = shouldDisable;
  if (meta.inputs && typeof meta.inputs.forEach === 'function') {
    meta.inputs.forEach(input => {
      if (!input) return;
      input.disabled = shouldDisable;
    });
  }
  if (meta.root) {
    meta.root.classList.toggle('is-mode-disabled', shouldDisable);
  }
}

function syncInkEffectsModeRadios(mode) {
  const normalized = normalizeInkEffectsMode(mode);
  if (!Array.isArray(panelState.modeRadios)) return;
  panelState.modeRadios.forEach(radio => {
    if (!radio) return;
    const radioMode = normalizeInkEffectsMode(radio.value);
    const shouldCheck = radioMode === normalized;
    if (radio.checked !== shouldCheck) {
      radio.checked = shouldCheck;
    }
    radio.setAttribute('aria-checked', String(shouldCheck));
  });
}

function syncInkEffectsModeUI(mode = getInkEffectsModeFromState()) {
  const normalized = normalizeInkEffectsMode(mode);
  panelState.currentMode = normalized;
  syncInkEffectsModeRadios(normalized);
  if (!Array.isArray(panelState.metas)) return;
  panelState.metas.forEach(meta => {
    if (!meta) return;
    const metaMode = normalizeInkEffectsMode(meta.mode || 'classic');
    const disable = metaMode !== normalized;
    setMetaModeDisabled(meta, disable);
    if (meta.root) {
      meta.root.dataset.mode = metaMode;
    }
  });
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
  const mode = normalizeInkEffectsMode(def.mode || 'classic');
  sectionEl.dataset.mode = mode;

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
  let slider = null;
  let numberInput = null;
  let startPercent = def.defaultStrength ?? 0;
  if (hasStrengthControl) {
    const strengthWrap = document.createElement('div');
    strengthWrap.className = 'ink-section-controls';
    slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    startPercent = getPercentFromState(def.stateKey, def.defaultStrength ?? 0);
    slider.value = String(startPercent);
    strengthWrap.appendChild(slider);
    numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.min = '0';
    numberInput.max = '100';
    numberInput.step = '1';
    numberInput.value = String(startPercent);
    numberInput.setAttribute('aria-label', `${def.label} strength`);
    strengthWrap.appendChild(numberInput);
    header.appendChild(strengthWrap);
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
    slider,
    numberInput,
    body,
    toggleButton: toggleBtn,
    defaultStrength: def.defaultStrength ?? 0,
    hasStrengthControl,
    mode,
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
    body.appendChild(row);
    registerMetaInput(meta, path, input);
  });

  sectionEl.appendChild(body);
  root.appendChild(sectionEl);
  panelState.metas.push(meta);

  toggleBtn.addEventListener('click', () => {
    setSectionCollapsed(meta, !meta.isCollapsed);
  });
  if (slider) {
    slider.addEventListener('input', () => {
      applySectionStrength(meta, Number.parseFloat(slider.value) || 0);
    });
  }
  if (numberInput) {
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
  }

  setSectionCollapsed(meta, true);
  if (hasStrengthControl) {
    applySectionStrength(meta, startPercent, { silent: true, syncSlider: false, syncNumber: false });
  } else {
    setMetaModeDisabled(meta, mode !== panelState.currentMode);
  }
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
  if (meta.stateKey) {
    setPercentOnState(meta.stateKey, pct);
  }
  if (meta.hasStrengthControl && meta.config && typeof meta.config === 'object') {
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
  const mode = normalizeInkEffectsMode(style.inkEffectsMode || style.effectsMode);
  const appliedMode = setInkEffectsModeOnState(mode);
  panelState.currentMode = appliedMode;
  syncInkEffectsModeUI(appliedMode);
  if (Array.isArray(style.sectionOrder) && style.sectionOrder.length) {
    applySectionOrder(style.sectionOrder);
  }
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
    if (meta.hasStrengthControl && Number.isFinite(strength)) {
      applySectionStrength(meta, strength);
    }
  });
  panelState.lastLoadedStyleId = styleId;
  if (panelState.styleNameInput) {
    panelState.styleNameInput.value = style.name;
    panelState.styleNameInput.classList.remove('input-error');
  }
  syncInkEffectsModeRadios(panelState.currentMode);
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
  if (sectionId === 'fuzz') return strength > 0 && EDGE_FUZZ.enabled !== false;
  if (sectionId === 'bleed') return strength > 0 && EDGE_BLEED.enabled !== false;
  return strength > 0;
}

export function getInkSectionOrder() {
  if (Array.isArray(panelState.sectionOrder) && panelState.sectionOrder.length) {
    return panelState.sectionOrder.slice();
  }
  return normalizeSectionOrder(getSectionOrderFromState());
}

export function getInkEffectsMode() {
  return getInkEffectsModeFromState();
}

export function getExperimentalEffectsConfig() {
  return EXPERIMENTAL_EFFECTS_CONFIG;
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

  panelState.sectionOrder = normalizeSectionOrder(getSectionOrderFromState());
  setSectionOrderOnState(panelState.sectionOrder);

  panelState.currentMode = getInkEffectsModeFromState();
  const modeRadios = Array.from(document.querySelectorAll('input[name="inkEffectsMode"]'));
  panelState.modeRadios = modeRadios;
  modeRadios.forEach(radio => {
    if (!radio) return;
    const radioMode = normalizeInkEffectsMode(radio.value);
    if (INK_EFFECT_MODE_LABELS[radioMode]) {
      radio.setAttribute('aria-label', INK_EFFECT_MODE_LABELS[radioMode]);
    }
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const requested = normalizeInkEffectsMode(radio.value);
      const current = getInkEffectsModeFromState();
      if (requested === current) {
        syncInkEffectsModeRadios(current);
        return;
      }
      const applied = setInkEffectsModeOnState(requested);
      panelState.currentMode = applied;
      syncInkEffectsModeUI(applied);
      persistPanelState();
      scheduleGlyphRefresh(true);
      scheduleGrainRefresh();
    });
  });
  syncInkEffectsModeRadios(panelState.currentMode);

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

  syncInkEffectsModeUI(panelState.currentMode);

  panelState.initialized = true;
  syncInkStrengthDisplays();
}

export function refreshSavedInkStylesUI() {
  renderSavedStylesList();
}
