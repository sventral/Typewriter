//js/rendering/experimental/distanceMaps.js

export function computeInsideDistance(alpha, w, h) {
  const INF = 1e9;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = alpha[i] > 0 ? INF : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d0 = dist[i];
      if (d0 === 0) continue;
      let best = d0;
      if (x > 0) best = Math.min(best, dist[i - 1] + 1);
      if (y > 0) best = Math.min(best, dist[i - w] + 1);
      if (x > 0 && y > 0) best = Math.min(best, dist[i - w - 1] + 1.4142135);
      if (x < w - 1 && y > 0) best = Math.min(best, dist[i - w + 1] + 1.4142135);
      dist[i] = best;
    }
  }
  let maxInside = 0;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d0 = dist[i];
      if (d0 === 0) continue;
      let best = d0;
      if (x < w - 1) best = Math.min(best, dist[i + 1] + 1);
      if (y < h - 1) best = Math.min(best, dist[i + w] + 1);
      if (x < w - 1 && y < h - 1) best = Math.min(best, dist[i + w + 1] + 1.4142135);
      if (x > 0 && y < h - 1) best = Math.min(best, dist[i + w - 1] + 1.4142135);
      dist[i] = best;
      if (best < INF && best > maxInside) maxInside = best;
    }
  }
  return { dist, maxInside };
}

export function computeOutsideDistance(alpha, w, h) {
  const INF = 1e9;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = alpha[i] === 0 ? INF : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d0 = dist[i];
      if (d0 === 0) continue;
      let best = d0;
      if (x > 0) best = Math.min(best, dist[i - 1] + 1);
      if (y > 0) best = Math.min(best, dist[i - w] + 1);
      if (x > 0 && y > 0) best = Math.min(best, dist[i - w - 1] + 1.4142135);
      if (x < w - 1 && y > 0) best = Math.min(best, dist[i - w + 1] + 1.4142135);
      dist[i] = best;
    }
  }
  let maxOutside = 0;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d0 = dist[i];
      if (d0 === 0) continue;
      let best = d0;
      if (x < w - 1) best = Math.min(best, dist[i + 1] + 1);
      if (y < h - 1) best = Math.min(best, dist[i + w] + 1);
      if (x < w - 1 && y < h - 1) best = Math.min(best, dist[i + w + 1] + 1.4142135);
      if (x > 0 && y < h - 1) best = Math.min(best, dist[i + w - 1] + 1.4142135);
      dist[i] = best;
      if (best < INF && best > maxOutside) maxOutside = best;
    }
  }
  return { dist, maxOutside };
}

export function createDistanceMapProvider(shape) {
  const inside = shape?.insideDist;
  const outside = shape?.outsideDist;
  const maxInside = shape?.maxInside || 0;
  return {
    getInside: index => (inside ? inside[index] : 0),
    getOutside: index => (outside ? outside[index] : 0),
    getMaxInside: () => maxInside,
    raw: { inside, outside },
  };
}
