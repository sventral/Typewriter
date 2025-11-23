import { clamp } from './math.js';

export function createBellPlayer({ basePath = 'audio/', fallbackId = 'bell-1' } = {}) {
  const cache = new Map();

  function resolveId(soundId) {
    return (typeof soundId === 'string' && soundId.trim()) ? soundId.trim() : fallbackId;
  }

  function resolveSrc(id) {
    return `${basePath}${id}.mp3`;
  }

  function play(soundId, volume = 70) {
    const id = resolveId(soundId);
    const vol = clamp(Math.round(Number(volume ?? 70)), 0, 100) / 100;
    const src = resolveSrc(id);
    let template = cache.get(src);
    if (!template) {
      template = new Audio(src);
      template.preload = 'auto';
      cache.set(src, template);
    }
    try {
      const instance = template.cloneNode(true);
      instance.volume = vol;
      instance.play().catch(() => {});
    } catch {
      try {
        template.currentTime = 0;
        template.volume = vol;
        template.play().catch(() => {});
      } catch {}
    }
  }

  return { play };
}
