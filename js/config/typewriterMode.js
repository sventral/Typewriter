import { clamp } from '../utils/math.js';

export const TYPEWRITER_DEFAULTS = {
  enabled: false,
  bellSound: 'bell-1',
  bellVolume: 70,
  bellLead: 5,
  stopSound: 'stop-1',
  stopEnabled: true,
  backspaceEnabled: false,
};

export function normalizeTypewriterSettings(raw = {}, defaults = TYPEWRITER_DEFAULTS) {
  const base = defaults || TYPEWRITER_DEFAULTS;
  const bellSound =
    typeof raw.bellSound === 'string' && raw.bellSound.trim()
      ? raw.bellSound.trim()
      : base.bellSound;
  const stopSound =
    typeof raw.stopSound === 'string' && raw.stopSound.trim()
      ? raw.stopSound.trim()
      : base.stopSound;
  const bellVolume = clamp(Math.round(Number(raw.bellVolume ?? base.bellVolume)), 0, 100);
  const bellLead = clamp(Math.round(Number(raw.bellLead ?? base.bellLead)), 0, 40);
  const enabled = raw.enabled === true;
  const stopEnabled = raw.stopEnabled !== false;
  const backspaceEnabled =
    raw.backspaceEnabled === true
      ? true
      : raw.backspaceEnabled === false
        ? false
        : base.backspaceEnabled === true;
  return { enabled, bellSound, bellVolume, bellLead, stopSound, stopEnabled, backspaceEnabled };
}
