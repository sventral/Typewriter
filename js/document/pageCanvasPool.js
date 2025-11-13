const DEFAULT_POOL_LIMIT = 4;

export function createPageCanvasPool(options = {}) {
  const {
    limit = DEFAULT_POOL_LIMIT,
    doc = typeof document === 'undefined' ? null : document,
  } = options;

  const buckets = {
    front: [],
    back: [],
  };

  let poolLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_POOL_LIMIT;

  const createCanvas = () => {
    if (!doc || typeof doc.createElement !== 'function') {
      return { width: 0, height: 0, getContext: () => null };
    }
    return doc.createElement('canvas');
  };

  const acquire = (kind = 'front') => {
    const bucket = buckets[kind] || buckets.front;
    const canvas = bucket.length ? bucket.pop() : createCanvas();
    return canvas;
  };

  const release = (canvas, kind = 'front') => {
    if (!canvas) return;
    const bucket = buckets[kind] || buckets.front;
    if (bucket.length >= poolLimit) {
      if (typeof canvas.remove === 'function') {
        try { canvas.remove(); } catch {}
      }
      return;
    }
    if (typeof canvas.remove === 'function' && canvas.parentNode) {
      try { canvas.remove(); } catch {}
    }
    bucket.push(canvas);
  };

  const setLimit = (value) => {
    if (Number.isFinite(value) && value > 0) {
      poolLimit = Math.floor(value);
      trimBuckets();
    }
  };

  const trimBuckets = () => {
    for (const kind of Object.keys(buckets)) {
      const bucket = buckets[kind];
      while (bucket.length > poolLimit) {
        const canvas = bucket.pop();
        if (canvas && typeof canvas.remove === 'function') {
          try { canvas.remove(); } catch {}
        }
      }
    }
  };

  const dispose = () => {
    for (const kind of Object.keys(buckets)) {
      const bucket = buckets[kind];
      while (bucket.length) {
        const canvas = bucket.pop();
        if (canvas && typeof canvas.remove === 'function') {
          try { canvas.remove(); } catch {}
        }
      }
    }
  };

  return {
    acquireFront: () => acquire('front'),
    acquireBack: () => acquire('back'),
    releaseFront: (canvas) => release(canvas, 'front'),
    releaseBack: (canvas) => release(canvas, 'back'),
    setLimit,
    dispose,
  };
}
