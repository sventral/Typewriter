import { clamp } from './math.js';

export function createBellPlayer({ basePath = 'audio/', fallbackId = 'bell-1' } = {}) {
  const cache = new Map();
  let audioCtx = null;
  const baseGain = 0.75;

  function resolveId(soundId) {
    return (typeof soundId === 'string' && soundId.trim()) ? soundId.trim() : fallbackId;
  }

  function resolveSrc(id) {
    return `${basePath}${id}.mp3`;
  }
  function resolveStopSrc(id) {
    return `${basePath}${id}.wav`;
  }

  function play(soundId, volume = 70) {
    const id = resolveId(soundId);
    const vol = clamp(Math.round(Number(volume ?? 70)), 0, 100) / 100 * baseGain;
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

  function playStop(soundId, volume = 70) {
    const id = resolveId(soundId);
    const vol = clamp(Math.round(Number(volume ?? 70)), 0, 100) / 100 * baseGain;
    const src = resolveStopSrc(id);
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

  function ensureCtx() {
    if (audioCtx) return audioCtx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    return audioCtx;
  }

  // kept for potential future synthetic sounds; not used for stop anymore
  function playThud(volume = 70) {
    const vol = clamp(Math.round(Number(volume ?? 70)), 0, 100) / 100;
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.09);
    const gain = ctx.createGain();
    const maxGain = 0.16 * vol;
    gain.gain.setValueAtTime(maxGain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);

    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.35;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(300, now);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.10 * vol, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);
    noise.connect(noiseFilter).connect(noiseGain);

    const master = ctx.createGain();
    master.gain.value = 1.0;
    gain.connect(master);
    noiseGain.connect(master);
    master.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.14);
    noise.start(now);
    noise.stop(now + 0.12);
  }

  return { play, playStop, playThud };
}
