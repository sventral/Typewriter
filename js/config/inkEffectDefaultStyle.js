const SECTION_ORDER = ['expTone', 'expEdge', 'expGrain', 'expDefects'];
const SUBSECTION_ORDER = Object.freeze([
  'expTone.variations',
  'expTone.ribbon',
  'expEdge.rim',
  'expEdge.fuzz',
  'expEdge.counterFill',
  'expEdge.grain',
  'expEdge.weight',
  'expGrain.speckle',
  'expGrain.dropouts',
  'expDefects.smudge',
  'expDefects.punch',
]);

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map(item => deepClone(item));
  }
  if (value && typeof value === 'object') {
    const clone = {};
    Object.keys(value).forEach(key => {
      clone[key] = deepClone(value[key]);
    });
    return clone;
  }
  return value;
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(item => deepFreeze(item));
    return Object.freeze(value);
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach(key => {
      deepFreeze(value[key]);
    });
    return Object.freeze(value);
  }
  return value;
}

const BASE_SECTION_CONFIG = deepFreeze({
  enable: {
    toneCore: true,
    toneDynamics: true,
    ribbonBands: false,
    rim: false,
    centerEdge: false,
    fuzzExp: false,
    grainSpeck: true,
    dropouts: true,
    edgeFuzz: true,
    smudge: false,
    punch: true,
  },
  ink: {
    pressureMid: 0.72,
    pressureVar: 0.35,
    inkGamma: 0.94,
    toneJitter: 0.5,
    rim: 0.25,
    rimCurve: 2.21,
    mottling: 0,
    speckDark: 0.15,
    speckLight: 0.81,
    speckGrayBias: 0.43,
  },
  ribbon: {
    height: 0.35,
    position: 0.55,
    delta: 0.12,
    fade: 0.65,
    wobble: 0.25,
  },
  noise: {
    lfScale: 17,
    hfScale: 1,
  },
  centerEdge: {
    center: 0.28,
    edge: 0,
    thicken: 0,
    patchFill: 1,
    patchSize: 0.5,
  },
  dropouts: {
    amount: 1.02,
    width: 1.75,
    scale: 8,
    pinhole: 0.31,
    streakDensity: 0.37,
    pinholeWeight: 0.72,
  },
  edgeFuzz: {
    opacity: 0.48,
    inBand: 0.1,
    outBand: 0.09,
    rough: 1,
    scale: 18,
    mix: 1,
  },
counterFill: {
    transparency: 0.3,
    fill: 0.65,
    coverage: 0.45,
    noise: 0.8,
  },
  fuzzExp: {
    enable: false,
    thicken: 0,
    patchFill: 1,
  },
  smudge: {
    strength: 0.74,
    radius: 2.75,
    falloff: 1.83,
    scale: 24,
    density: 0.22,
    dirDeg: 248,
    spread: 0.16,
  },
  punch: {
    chance: 0.26,
    count: 1,
    rMin: 0.004,
    rMax: 0.082,
    edgeBias: 0.8,
    soft: 0.295,
    intensity: 0.96,
  },
  enabled: false,
});

const DEFAULT_SUBSECTION_QUALITIES = Object.freeze({
  'expTone.variations': 55,
  'expTone.ribbon': 55,
  'expEdge.rim': 55,
  'expEdge.fuzz': 100,
  'expEdge.counterFill': 100,
  'expEdge.grain': 100,
  'expEdge.weight': 100,
  'expGrain.speckle': 100,
  'expGrain.dropouts': 100,
  'expDefects.smudge': 100,
  'expDefects.punch': 100,
});

const DEFAULT_SUBSECTION_SCALES = Object.freeze(
  SUBSECTION_ORDER.reduce((acc, id) => {
    acc[id] = 100;
    return acc;
  }, {})
);

function pickSubsectionDefaults(sectionId, source) {
  const entries = Object.entries(source || {});
  const filtered = entries.filter(([key]) => key.startsWith(`${sectionId}.`));
  return filtered.reduce((acc, [key, value]) => {
    const subId = key.split('.')[1];
    acc[subId] = value;
    return acc;
  }, {});
}

function createSection(strength, qualities, scales) {
  return {
    strength,
    config: deepClone(BASE_SECTION_CONFIG),
    qualities,
    scales,
  };
}

const DEFAULT_SECTIONS = {
  expTone: createSection(
    100,
    pickSubsectionDefaults('expTone', DEFAULT_SUBSECTION_QUALITIES),
    pickSubsectionDefaults('expTone', DEFAULT_SUBSECTION_SCALES),
  ),
  expEdge: createSection(
    0,
    pickSubsectionDefaults('expEdge', DEFAULT_SUBSECTION_QUALITIES),
    pickSubsectionDefaults('expEdge', DEFAULT_SUBSECTION_SCALES),
  ),
  expGrain: createSection(
    0,
    pickSubsectionDefaults('expGrain', DEFAULT_SUBSECTION_QUALITIES),
    pickSubsectionDefaults('expGrain', DEFAULT_SUBSECTION_SCALES),
  ),
  expDefects: createSection(
    0,
    pickSubsectionDefaults('expDefects', DEFAULT_SUBSECTION_QUALITIES),
    pickSubsectionDefaults('expDefects', DEFAULT_SUBSECTION_SCALES),
  ),
};

const DEFAULT_STYLE = {
  version: 2,
  exportedAt: '2025-11-17T15:59:24.503Z',
  style: {
    id: '9a9bbb09-cc87-4811-ab28-8824cb1546bf',
    name: 'Basic',
    overall: 100,
    sections: DEFAULT_SECTIONS,
    sectionOrder: SECTION_ORDER.slice(),
  },
};

export const DEFAULT_INK_EFFECT_STYLE = deepFreeze(DEFAULT_STYLE);
export const DEFAULT_INK_SECTION_ORDER = Object.freeze(SECTION_ORDER.slice());

const SECTION_STRENGTH_DEFAULTS = Object.freeze({
  expTone: DEFAULT_SECTIONS.expTone.strength,
  expEdge: DEFAULT_SECTIONS.expEdge.strength,
  expGrain: DEFAULT_SECTIONS.expGrain.strength,
  expDefects: DEFAULT_SECTIONS.expDefects.strength,
});

const SUBSECTION_QUALITY_DEFAULTS = Object.freeze({ ...DEFAULT_SUBSECTION_QUALITIES });
const SUBSECTION_SCALE_DEFAULTS = Object.freeze({ ...DEFAULT_SUBSECTION_SCALES });

export function cloneDefaultInkEffectStyle() {
  return deepClone(DEFAULT_INK_EFFECT_STYLE);
}

export function cloneDefaultExperimentalConfig() {
  return deepClone(BASE_SECTION_CONFIG);
}

export function getDefaultInkSectionStrength(sectionId) {
  return Number.isFinite(SECTION_STRENGTH_DEFAULTS[sectionId])
    ? SECTION_STRENGTH_DEFAULTS[sectionId]
    : 0;
}

export function getDefaultInkSectionQuality(sectionId) {
  // Backwards-compatibility: return the first subsection quality if available.
  const match = SUBSECTION_ORDER.find(id => id.startsWith(`${sectionId}.`));
  if (match && Number.isFinite(SUBSECTION_QUALITY_DEFAULTS[match])) {
    return SUBSECTION_QUALITY_DEFAULTS[match];
  }
  return 100;
}

export function getDefaultInkSubsectionQuality(subsectionId) {
  return Number.isFinite(SUBSECTION_QUALITY_DEFAULTS[subsectionId])
    ? SUBSECTION_QUALITY_DEFAULTS[subsectionId]
    : 100;
}

export function getDefaultInkSubsectionScale(subsectionId) {
  return Number.isFinite(SUBSECTION_SCALE_DEFAULTS[subsectionId])
    ? SUBSECTION_SCALE_DEFAULTS[subsectionId]
    : 100;
}

export const DEFAULT_INK_SUBSECTION_ORDER = SUBSECTION_ORDER.slice();
