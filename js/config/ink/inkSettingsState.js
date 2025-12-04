import { clamp } from '../../utils/math.js';
import {
  SECTION_DEF_MAP,
  SECTION_STATE_KEY_MAP,
  SUBSECTION_QUALITY_CONFIG,
  SUBSECTION_SCALE_CONFIG,
  EFFECT_QUALITY_DEFAULT,
  EFFECT_QUALITY_MIN,
  EFFECT_QUALITY_MAX,
  EFFECT_SCALE_DEFAULT,
  EFFECT_SCALE_MIN,
  EFFECT_SCALE_MAX,
  EXPERIMENTAL_EFFECTS_CONFIG,
  normalizeSectionOrder,
  normalizeSubsectionOrder,
} from './inkSettingsConfig.js';

function normalizedPercent(value) {
  return clamp((Number(value) || 0) / 100, 0, 1);
}

function getPercentFromState(state, key, fallback = 0) {
  if (!state || typeof state !== 'object') return Number(fallback) || 0;
  const raw = state[key];
  const num = Number(raw);
  if (!Number.isFinite(num)) return Number(fallback) || 0;
  return clamp(Math.round(num), 0, 100);
}

function getScalarFromState(state, key, fallback = 0, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  if (!state || typeof state !== 'object') return clamp(Number(fallback) || 0, min, max);
  const raw = state[key];
  const num = Number(raw);
  if (!Number.isFinite(num)) return clamp(Number(fallback) || 0, min, max);
  return clamp(num, min, max);
}

function getSubsectionQualityPercent(state, subsectionId, defaultValue = EFFECT_QUALITY_DEFAULT) {
  const cfg = SUBSECTION_QUALITY_CONFIG[subsectionId];
  if (!cfg) return clamp(defaultValue, EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX);
  return getScalarFromState(state, cfg.stateKey, defaultValue, EFFECT_QUALITY_MIN, EFFECT_QUALITY_MAX);
}

function getSubsectionScalePercent(state, subsectionId, defaultValue = EFFECT_SCALE_DEFAULT) {
  const cfg = SUBSECTION_SCALE_CONFIG[subsectionId];
  if (!cfg) return clamp(defaultValue, EFFECT_SCALE_MIN, EFFECT_SCALE_MAX);
  return getScalarFromState(state, cfg.stateKey, defaultValue, EFFECT_SCALE_MIN, EFFECT_SCALE_MAX);
}

export function createInkSettingsStateApi({ state } = {}) {
  const getInkEffectFactor = () => normalizedPercent(getPercentFromState(state, 'effectsOverallStrength', 100));

  const getInkSectionStrength = (sectionId) => {
    const stateKey = SECTION_STATE_KEY_MAP[sectionId];
    if (!stateKey) return 1;
    const fallback = Number.isFinite(SECTION_DEF_MAP[sectionId]?.defaultStrength)
      ? SECTION_DEF_MAP[sectionId].defaultStrength
      : 100;
    return normalizedPercent(getPercentFromState(state, stateKey, fallback));
  };

  const isInkSectionEnabled = (sectionId) => {
    if (!SECTION_STATE_KEY_MAP[sectionId]) return true;
    return getInkSectionStrength(sectionId) > 0;
  };

  const getInkSectionOrder = () => normalizeSectionOrder(state?.inkSectionOrder);

  const getInkSubsectionOrder = () => normalizeSubsectionOrder(state?.inkSubsectionOrder);

  const getExperimentalEffectsConfig = () => EXPERIMENTAL_EFFECTS_CONFIG;

  const getExperimentalQualitySettings = () => {
    const settings = {};
    Object.keys(SUBSECTION_QUALITY_CONFIG).forEach((subId) => {
      settings[subId] = getSubsectionQualityPercent(state, subId, EFFECT_QUALITY_DEFAULT);
    });
    return settings;
  };

  const getExperimentalScaleSettings = () => {
    const settings = {};
    Object.keys(SUBSECTION_SCALE_CONFIG).forEach((subId) => {
      settings[subId] = getSubsectionScalePercent(state, subId, EFFECT_SCALE_DEFAULT);
    });
    return settings;
  };

  return {
    getInkEffectFactor,
    getInkSectionStrength,
    isInkSectionEnabled,
    getInkSectionOrder,
    getInkSubsectionOrder,
    getExperimentalEffectsConfig,
    getExperimentalQualitySettings,
    getExperimentalScaleSettings,
  };
}
