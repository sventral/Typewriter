const strength = on => (on ? 1 : 0);

export function exportRepoStyleConfig(config) {
  if (!config || typeof config !== 'object') {
    return { sectionOrder: [], sections: {} };
  }

  const enable = config.enable || {};
  const sections = {
    fill: {
      strength: strength(enable.toneCore),
      config: {
        pressureMid: config.ink?.pressureMid,
        pressureVar: config.ink?.pressureVar,
        inkGamma: config.ink?.inkGamma,
        toneJitter: config.ink?.toneJitter,
        rim: config.ink?.rim,
        rimCurve: config.ink?.rimCurve,
        ribbon: {
          height: config.ribbon?.height,
          position: config.ribbon?.position,
          delta: config.ribbon?.delta,
          fade: config.ribbon?.fade,
          wobble: config.ribbon?.wobble,
        },
        centerThickenPct: config.centerEdge?.center,
        edgeThinPct: config.centerEdge?.edge,
      },
    },
    texture: {
      strength: strength(enable.grainSpeck),
      config: {
        mottling: config.ink?.mottling,
        speckDark: config.ink?.speckDark,
        speckLight: config.ink?.speckLight,
        speckGrayBias: config.ink?.speckGrayBias,
      },
    },
    fuzz: {
      strength: strength(enable.edgeFuzz),
      config: { ...(config.edgeFuzz || {}) },
    },
    smudge: {
      strength: strength(enable.smudge),
      config: { ...(config.smudge || {}) },
    },
    dropouts: {
      strength: strength(enable.dropouts),
      config: { ...(config.dropouts || {}) },
    },
    punch: {
      strength: strength(enable.punch),
      config: { ...(config.punch || {}) },
    },
  };

  const sectionOrder = Array.isArray(config.sectionOrder) && config.sectionOrder.length
    ? [...config.sectionOrder]
    : ['fill', 'texture', 'fuzz', 'smudge', 'dropouts', 'punch'];

  return { sectionOrder, sections };
}
