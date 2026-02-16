import { clamp } from '../../utils/math.js';
import {
  SECTION_DEFS,
  EFFECT_QUALITY_DEFAULT,
  EFFECT_QUALITY_MIN,
  EFFECT_QUALITY_MAX,
  EFFECT_SCALE_DEFAULT,
  EFFECT_SCALE_MIN,
  EFFECT_SCALE_MAX,
  DEFAULT_SUBSECTION_ORDER,
  SUBSECTION_IDS_BY_SECTION,
  DEFAULT_SECTION_ORDER,
  normalizeSectionOrder,
  normalizeSubsectionOrder,
} from './inkSettingsConfig.js';
import {
  getDefaultInkSectionQuality,
  getDefaultInkSubsectionQuality,
  getDefaultInkSubsectionScale,
} from '../inkEffectDefaultStyle.js';

const STYLE_NAME_MAX_LEN = 60;
const STYLE_EXPORT_VERSION = 2;

export const STYLE_INCLUDE_KEYS = Object.freeze(['font', 'slant', 'jitter', 'effects']);

export const DEFAULT_STYLE_INCLUDES = Object.freeze({
  font: true,
  slant: true,
  jitter: true,
  effects: true,
});

const LEGACY_SUBSECTION_SECTION_MAP = Object.freeze({
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
});

export function deepCloneValue(value) {
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

export function sanitizeStyleName(name) {
  if (typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, STYLE_NAME_MAX_LEN);
}

export function ensureUniqueStyleName(name, existingStyles, excludeId = null) {
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

export function normalizeStyleIncludes(source, fallback = DEFAULT_STYLE_INCLUDES) {
  const base = { ...(fallback || DEFAULT_STYLE_INCLUDES) };
  if (source && typeof source === 'object') {
    STYLE_INCLUDE_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        base[key] = !!source[key];
      }
    });
  }
  return base;
}

export function generateStyleId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `style-${ts}-${rand}`;
}

function clampQualityValue(value, fallback = EFFECT_QUALITY_DEFAULT) {
  const safeFallback = Number.isFinite(fallback) ? fallback : EFFECT_QUALITY_DEFAULT;
  const raw = Number.isFinite(Number(value)) ? Number(value) : safeFallback;
  const normalized = Number.isFinite(raw) ? raw : safeFallback;
  return clamp(Math.round(normalized), EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX);
}

function clampScaleValue(value, fallback = EFFECT_SCALE_DEFAULT) {
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, EFFECT_SCALE_MIN, EFFECT_SCALE_MAX);
}

function applyConfigToTarget(target, source) {
  if (!target || typeof target !== 'object') return;
  if (!source || typeof source !== 'object') return;
  Object.keys(source).forEach(key => {
    target[key] = deepCloneValue(source[key]);
  });
}

export function normalizeStyleRecord(style, index = 0) {
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
      includes: normalizeStyleIncludes(style?.includes),
      fontName: typeof style?.fontName === 'string' ? style.fontName : null,
      lineSlantEnabled: typeof style?.lineSlantEnabled === 'boolean' ? style.lineSlantEnabled : null,
      lineSlantRangeDeg: style?.lineSlantRangeDeg && typeof style.lineSlantRangeDeg === 'object'
        ? deepCloneValue(style.lineSlantRangeDeg)
        : null,
      glyphJitterEnabled: typeof style?.glyphJitterEnabled === 'boolean' ? style.glyphJitterEnabled : null,
      glyphJitterAmountPct: style?.glyphJitterAmountPct && typeof style.glyphJitterAmountPct === 'object'
        ? deepCloneValue(style.glyphJitterAmountPct)
        : null,
      glyphJitterFrequencyPct: style?.glyphJitterFrequencyPct && typeof style.glyphJitterFrequencyPct === 'object'
        ? deepCloneValue(style.glyphJitterFrequencyPct)
        : null,
      glyphJitterSeed: Number.isFinite(style?.glyphJitterSeed) ? style.glyphJitterSeed >>> 0 : null,
      glyphBaselineOffsetAboveChars: typeof style?.glyphBaselineOffsetAboveChars === 'string'
        ? style.glyphBaselineOffsetAboveChars
        : null,
      glyphBaselineOffsetAboveRangePct: style?.glyphBaselineOffsetAboveRangePct && typeof style.glyphBaselineOffsetAboveRangePct === 'object'
        ? deepCloneValue(style.glyphBaselineOffsetAboveRangePct)
        : null,
      glyphBaselineOffsetBelowChars: typeof style?.glyphBaselineOffsetBelowChars === 'string'
        ? style.glyphBaselineOffsetBelowChars
        : null,
      glyphBaselineOffsetBelowRangePct: style?.glyphBaselineOffsetBelowRangePct && typeof style.glyphBaselineOffsetBelowRangePct === 'object'
        ? deepCloneValue(style.glyphBaselineOffsetBelowRangePct)
        : null,
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
      const configSource = section.config != null
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
        const legacySectionId = LEGACY_SUBSECTION_SECTION_MAP[subKey];

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

export function createDefaultStyleRecord(index = 0) {
  const record = {
    id: generateStyleId(),
    name: index === 0 ? 'Current style' : `Style ${index + 1}`,
    overall: 100,
    sections: {},
    sectionOrder: DEFAULT_SECTION_ORDER.slice(),
    subsectionOrder: DEFAULT_SUBSECTION_ORDER.slice(),
    includes: normalizeStyleIncludes(DEFAULT_STYLE_INCLUDES),
    fontName: null,
    lineSlantEnabled: null,
    lineSlantRangeDeg: null,
    glyphJitterEnabled: null,
    glyphJitterAmountPct: null,
    glyphJitterFrequencyPct: null,
    glyphJitterSeed: null,
    glyphBaselineOffsetAboveChars: null,
    glyphBaselineOffsetAboveRangePct: null,
    glyphBaselineOffsetBelowChars: null,
    glyphBaselineOffsetBelowRangePct: null,
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

export function cloneDefaultStyleSnapshot() {
  return deepCloneValue(DEFAULT_STYLE_SNAPSHOT);
}

export function makeStyleExportFileName(style) {
  const rawName = sanitizeStyleName(style?.name) || 'Ink style';
  const safe = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = safe || 'ink-style';
  return `${base}.ink-style.json`;
}

export function buildStyleExportPayload(style) {
  return {
    version: STYLE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    style: normalizeStyleRecord(style || {}) || createDefaultStyleRecord(0),
  };
}

export function extractStyleFromPayload(payload) {
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

export function normalizeImportedStyle(rawStyle) {
  let sanitized = normalizeStyleRecord(rawStyle, 0);
  if (!sanitized) {
    sanitized = createDefaultStyleRecord(0);
  }
  sanitized.id = generateStyleId();
  sanitized.name = sanitizeStyleName(sanitized.name) || 'Imported style';
  return sanitized;
}
