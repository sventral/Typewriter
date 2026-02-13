import { clamp } from '../utils/math.js';

export const TYPEWRITER_DEFAULTS = {
  enabled: false,
  bellEnabled: false,
  bellSound: 'bell-1',
  bellVolume: 70,
  bellLead: 5,
  stopSound: 'stop-1',
  stopEnabled: false,
  stopVolume: 70,
  backspaceEnabled: false,
  caretLockEnabled: true,
};

export function normalizeTypewriterSettings(raw = {}, defaults = TYPEWRITER_DEFAULTS) {
  const base = defaults || TYPEWRITER_DEFAULTS;
  const hasBellEnabled = typeof raw.bellEnabled === 'boolean';
  const legacyEnabled = raw.enabled === true;
  const bellEnabled = hasBellEnabled ? raw.bellEnabled : legacyEnabled;
  const bellSound =
    typeof raw.bellSound === 'string' && raw.bellSound.trim()
      ? raw.bellSound.trim()
      : base.bellSound;
  const stopSound =
    typeof raw.stopSound === 'string' && raw.stopSound.trim()
      ? raw.stopSound.trim()
      : base.stopSound;
  const bellVolume = clamp(Math.round(Number(raw.bellVolume ?? base.bellVolume)), 0, 100);
  const stopVolume = clamp(Math.round(Number(raw.stopVolume ?? raw.bellVolume ?? base.stopVolume)), 0, 100);
  const bellLead = clamp(Math.round(Number(raw.bellLead ?? base.bellLead)), 0, 40);
  let stopEnabled = raw.stopEnabled === true;
  if (!hasBellEnabled && typeof raw.stopEnabled === 'boolean') {
    stopEnabled = legacyEnabled && raw.stopEnabled;
  } else if (typeof raw.stopEnabled !== 'boolean') {
    stopEnabled = base.stopEnabled === true;
  }
  const enabled = bellEnabled || stopEnabled;
  const backspaceEnabled =
    raw.backspaceEnabled === true
      ? true
      : raw.backspaceEnabled === false
        ? false
        : base.backspaceEnabled === true;
  const caretLockEnabled =
    raw.caretLockEnabled === true
      ? true
      : raw.caretLockEnabled === false
        ? false
        : base.caretLockEnabled === true;
  return {
    enabled,
    bellEnabled,
    bellSound,
    bellVolume,
    bellLead,
    stopSound,
    stopEnabled,
    stopVolume,
    backspaceEnabled,
    caretLockEnabled,
  };
}
