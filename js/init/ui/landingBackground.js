const SETTINGS = {
  countRange: [2, 9],
  diameterMM: [75, 120],
  thicknessMM: [5, 10],
  opacity: [0.10, 0.32],
  scale: 0.7,
  colorMode: 'primary',
  palette: '#ff0000,#00ff00,#0000ff',
  fixedColor: '#ff0000',
  placement: {
    overlap: 1,
    gapMM: 0,
    marginMM: 0,
    edgeBleedMM: 0,
    spread: 1,
    candidates: 85,
    clustering: {
      chance: 0.06,
      clusterCountRange: [1, 2],
      clusterSizeRange: [1, 2],
      clusterRadiusMM: 250,
      maxClusteredFraction: 0.38,
    },
  },
  texture: {
    roughness: 0.9,
    ellipseAmt: 0,
    blobs: 0.89,
    drips: true,
    dripAmt: 0.36,
  },
};

// Approx conversion: 1 mm in CSS px at 96 DPI.
const PX_PER_MM = 96 / 25.4;

function makeSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(start, end, t) {
  return start + ((end - start) * t);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randInt(rand, min, max) {
  const floorMin = Math.floor(min);
  const floorMax = Math.floor(max);
  return floorMin + Math.floor(rand() * ((floorMax - floorMin) + 1));
}

function valueNoise1D(rand, points) {
  const values = new Array(points).fill(0).map(() => rand());
  return (t) => {
    const x = t * points;
    const i0 = Math.floor(x) % points;
    const i1 = (i0 + 1) % points;
    const f = x - Math.floor(x);
    const s = f * f * (3 - (2 * f));
    return lerp(values[i0], values[i1], s);
  };
}

function rgba({ r, g, b, a }) {
  return `rgba(${r},${g},${b},${a})`;
}

function pickColorPrimary(rand, opacityMin, opacityMax) {
  const a = lerp(opacityMin, opacityMax, rand());
  const which = Math.floor(rand() * 3);
  return {
    r: which === 0 ? 255 : 0,
    g: which === 1 ? 255 : 0,
    b: which === 2 ? 255 : 0,
    a,
  };
}

function resizeOnce(canvas, ctx) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clear(canvas, ctx) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function bounds(scale, placement) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const marginPx = (placement.marginMM || 0) * PX_PER_MM * scale;
  const bleedPx = (placement.edgeBleedMM || 0) * PX_PER_MM * scale;
  return {
    width,
    height,
    minX: (-bleedPx) + marginPx,
    maxX: width + bleedPx - marginPx,
    minY: (-bleedPx) + marginPx,
    maxY: height + bleedPx - marginPx,
  };
}

function clampToBounds(point, areaBounds) {
  return {
    x: clamp(point.x, areaBounds.minX, areaBounds.maxX),
    y: clamp(point.y, areaBounds.minY, areaBounds.maxY),
  };
}

// Spread sampler: prefers "farther from others", but still allows overlap (overlap=1 => very permissive)
function chooseSpreadPlacement(rand, scale, placement, placed, outerRpx) {
  const areaBounds = bounds(scale, placement);
  if (areaBounds.maxX <= areaBounds.minX || areaBounds.maxY <= areaBounds.minY) {
    return { x: areaBounds.width * 0.5, y: areaBounds.height * 0.5 };
  }

  if (!placed.length) {
    return {
      x: lerp(areaBounds.minX, areaBounds.maxX, rand()),
      y: lerp(areaBounds.minY, areaBounds.maxY, rand()),
    };
  }

  const candidates = placement.candidates || 85;
  const overlap = clamp(placement.overlap ?? 1, 0, 1);
  const spread = clamp(placement.spread ?? 1, 0, 1);
  const gapPx = (placement.gapMM || 0) * PX_PER_MM * scale;

  // More overlap => softer selection; spread=1 => stronger preference for far placements.
  let p = lerp(1.2, 5.6, spread) * lerp(1.0, 0.35, overlap);
  p = clamp(p, 0.8, 6.0);
  const baseline = overlap * lerp(0.10, 0.22, 1 - spread);

  const sampled = [];
  let maxScore = -Infinity;

  for (let i = 0; i < candidates; i += 1) {
    const x = lerp(areaBounds.minX, areaBounds.maxX, rand());
    const y = lerp(areaBounds.minY, areaBounds.maxY, rand());

    let nearest = placed[0];
    let minDistance = Infinity;
    for (const stain of placed) {
      const distance = Math.hypot(x - stain.x, y - stain.y);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = stain;
      }
    }

    const minDist = ((outerRpx + nearest.outerR) * (1 - overlap)) + gapPx;
    const clearance = minDistance - minDist;
    const score = clearance;

    if (score > maxScore) maxScore = score;
    sampled.push({ x, y, score });
  }

  let totalWeight = 0;
  for (const sample of sampled) {
    const normalized = sample.score - maxScore;
    const squashed = 1 / (1 + Math.exp(-normalized / 90));
    const weight = Math.pow(squashed + baseline, p);
    sample.weight = weight;
    totalWeight += weight;
  }

  if (!(totalWeight > 0)) {
    let best = sampled[0];
    for (const sample of sampled) {
      if (sample.score > best.score) best = sample;
    }
    return { x: best.x, y: best.y };
  }

  let draw = rand() * totalWeight;
  for (const sample of sampled) {
    draw -= sample.weight;
    if (draw <= 0) return { x: sample.x, y: sample.y };
  }

  return {
    x: sampled[sampled.length - 1].x,
    y: sampled[sampled.length - 1].y,
  };
}

function chooseClusterPlacement(rand, scale, placement, clusterRadiusMM, center, placed, outerRpx) {
  const areaBounds = bounds(scale, placement);
  const overlap = clamp(placement.overlap ?? 1, 0, 1);
  const gapPx = (placement.gapMM || 0) * PX_PER_MM * scale;
  const radiusPx = (clusterRadiusMM || 0) * PX_PER_MM * scale;

  const tries = 36;
  let best = null;
  let bestScore = -Infinity;

  for (let i = 0; i < tries; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = Math.pow(rand(), 1.6) * radiusPx;
    let x = center.x + (Math.cos(angle) * radius);
    let y = center.y + (Math.sin(angle) * radius);
    ({ x, y } = clampToBounds({ x, y }, areaBounds));

    let nearest = placed.length ? placed[0] : null;
    let minDistance = Infinity;
    for (const stain of placed) {
      const distance = Math.hypot(x - stain.x, y - stain.y);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = stain;
      }
    }

    const minDist = nearest ? ((outerRpx + nearest.outerR) * (1 - overlap)) + gapPx : 0;
    const clearance = nearest ? (minDistance - minDist) : 9999;
    const distToCenter = Math.hypot(x - center.x, y - center.y);

    // Keep it near center, but avoid perfect stacking.
    const score = (-distToCenter) + (0.25 * clearance);

    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }

  return best || clampToBounds(center, areaBounds);
}

function drawCoffeeStain(ctx, rand, stain, texture, scale) {
  const {
    x, y, outerR, thickness, color,
  } = stain;

  const steps = 220;
  const outerFreq = 14 + Math.floor(rand() * 18);
  const innerFreq = 14 + Math.floor(rand() * 18);
  const outerNoise = valueNoise1D(rand, outerFreq);
  const innerNoise = valueNoise1D(rand, innerFreq);

  const roughness = clamp(texture.roughness ?? 0.8, 0, 1);
  const outerJitter = outerR * lerp(0.00, 0.055, roughness) * lerp(0.75, 1.25, rand());
  const innerJitter = outerR * lerp(0.00, 0.050, roughness) * lerp(0.75, 1.25, rand());

  const ellipseAmt = clamp(texture.ellipseAmt ?? 0, 0, 1);
  const scaleX = lerp(1.0, lerp(0.92, 1.08, rand()), ellipseAmt);
  const scaleY = lerp(1.0, lerp(0.90, 1.10, rand()), ellipseAmt);
  const rotation = lerp(-0.35, 0.35, rand()) * ellipseAmt;

  function rotate(px, py) {
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    return {
      x: (px * c) - (py * s),
      y: (px * s) + (py * c),
    };
  }

  const innerR = Math.max(2, outerR - thickness);

  const ringPath = new Path2D();
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = t * Math.PI * 2;
    const noise = (outerNoise(t) - 0.5) * 2;
    const r = outerR + (noise * outerJitter);
    const px = Math.cos(angle) * r * scaleX;
    const py = Math.sin(angle) * r * scaleY;
    const rp = rotate(px, py);
    if (i === 0) ringPath.moveTo(x + rp.x, y + rp.y);
    else ringPath.lineTo(x + rp.x, y + rp.y);
  }
  ringPath.closePath();

  for (let i = steps; i >= 0; i -= 1) {
    const t = i / steps;
    const angle = t * Math.PI * 2;
    const noise = (innerNoise(t) - 0.5) * 2;
    const r = innerR + (noise * innerJitter);
    const px = Math.cos(angle) * r * scaleX;
    const py = Math.sin(angle) * r * scaleY;
    const rp = rotate(px, py);
    if (i === steps) ringPath.moveTo(x + rp.x, y + rp.y);
    else ringPath.lineTo(x + rp.x, y + rp.y);
  }
  ringPath.closePath();

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = rgba(color);
  ctx.fill(ringPath, 'evenodd');
  ctx.restore();

  const edgeAlphaOne = clamp(color.a + 0.10, 0, 0.60);
  const edgeAlphaTwo = clamp(color.a + 0.18, 0, 0.70);

  function strokeOutline(target, alpha, widthPx) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba({ ...color, a: alpha });
    ctx.lineWidth = widthPx;

    const path = new Path2D();
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const angle = t * Math.PI * 2;
      const noise = target === 'outer' ? ((outerNoise(t) - 0.5) * 2) : ((innerNoise(t) - 0.5) * 2);
      const base = target === 'outer' ? outerR : innerR;
      const jitter = target === 'outer' ? outerJitter : innerJitter;
      const r = base + (noise * jitter);
      const px = Math.cos(angle) * r * scaleX;
      const py = Math.sin(angle) * r * scaleY;
      const rp = rotate(px, py);
      if (i === 0) path.moveTo(x + rp.x, y + rp.y);
      else path.lineTo(x + rp.x, y + rp.y);
    }
    path.closePath();
    ctx.stroke(path);
    ctx.restore();
  }

  const edgeWidthScale = lerp(0.6, 1.2, roughness);
  strokeOutline('outer', edgeAlphaTwo, lerp(0.9, 2.2, rand()) * edgeWidthScale);
  strokeOutline('inner', edgeAlphaOne, lerp(0.7, 2.0, rand()) * edgeWidthScale);

  const blobAmt = clamp(texture.blobs ?? 0.8, 0, 1);
  const blobCount = Math.floor(lerp(0, 95, blobAmt) + (lerp(0, 50, blobAmt) * rand()));
  if (blobCount > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < blobCount; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = lerp(innerR, outerR, rand());
      const wobble = (rand() - 0.5) * thickness * 0.9;
      const radiusWithWobble = radius + wobble;
      const px = Math.cos(angle) * radiusWithWobble * scaleX;
      const py = Math.sin(angle) * radiusWithWobble * scaleY;
      const rp = rotate(px, py);

      const size = lerp(0.4, 2.4, rand()) * PX_PER_MM * scale;
      const alpha = clamp(color.a * lerp(0.10, 0.34, rand()) * blobAmt, 0, 0.22);
      ctx.fillStyle = rgba({ ...color, a: alpha });
      ctx.beginPath();
      ctx.ellipse(
        x + rp.x,
        y + rp.y,
        size,
        size * lerp(0.8, 1.2, rand()),
        rand() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  if (texture.drips && (texture.dripAmt ?? 0) > 0) {
    const dripAmt = clamp(texture.dripAmt, 0, 1);
    const dripChance = 0.65 * dripAmt;
    const dripCount = rand() < dripChance
      ? (1 + Math.floor(rand() * (1 + Math.floor(3 * dripAmt))))
      : 0;

    for (let i = 0; i < dripCount; i += 1) {
      const angle = lerp(Math.PI * 0.65, Math.PI * 1.35, rand());
      const startR = lerp(innerR, outerR, rand());
      const px = Math.cos(angle) * startR * scaleX;
      const py = Math.sin(angle) * startR * scaleY;
      const rp = rotate(px, py);

      const startX = x + rp.x;
      const startY = y + rp.y;

      const length = lerp(6, 30, rand()) * PX_PER_MM * scale * dripAmt;
      const width = lerp(0.9, 2.8, rand()) * PX_PER_MM * scale * lerp(0.6, 1.0, dripAmt);
      const curve = (rand() - 0.5) * 10 * PX_PER_MM * scale * dripAmt;

      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = rgba({ ...color, a: clamp(color.a * 0.55, 0, 0.35) });
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(
        startX + curve,
        startY + (length * 0.35),
        startX + (curve * 0.6),
        startY + (length * 0.75),
        startX + (curve * 0.2),
        startY + length,
      );
      ctx.stroke();

      ctx.fillStyle = rgba({ ...color, a: clamp(color.a * 0.45, 0, 0.30) });
      ctx.beginPath();
      ctx.ellipse(startX + (curve * 0.2), startY + length, width * 0.9, width * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = rgba({ ...color, a: clamp(color.a * 0.10, 0, 0.10) });
  ctx.beginPath();
  ctx.ellipse(x, y, innerR * scaleX * 0.98, innerR * scaleY * 0.98, rotation, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function generateBackground(canvas, ctx) {
  resizeOnce(canvas, ctx);
  clear(canvas, ctx);

  const seed = makeSeed();
  const rand = mulberry32(seed);
  const count = randInt(rand, SETTINGS.countRange[0], SETTINGS.countRange[1]);

  const placed = [];
  const stains = [];
  const scale = SETTINGS.scale;
  const placement = SETTINGS.placement;
  const clustering = placement.clustering || {};
  const doClustering = count > 1 && rand() < (clustering.chance ?? 0);

  const clusters = [];
  if (doClustering) {
    const clusterCountMin = clustering.clusterCountRange?.[0] ?? 1;
    const clusterCountMax = clustering.clusterCountRange?.[1] ?? 1;
    const clusterSizeMin = clustering.clusterSizeRange?.[0] ?? 1;
    const clusterSizeMax = clustering.clusterSizeRange?.[1] ?? 1;
    const clusterCount = randInt(rand, clusterCountMin, clusterCountMax);
    const maxClustered = Math.floor(count * clamp(clustering.maxClusteredFraction ?? 0, 0, 1));
    let remainingBudget = Math.max(0, maxClustered);

    for (let i = 0; i < clusterCount; i += 1) {
      if (remainingBudget <= 0) break;
      let size = randInt(rand, clusterSizeMin, clusterSizeMax);
      size = Math.max(1, Math.min(size, remainingBudget));
      clusters.push({ size, center: null });
      remainingBudget -= size;
    }
  }

  // Place clusters (centers spread out).
  for (const cluster of clusters) {
    const diameter = lerp(SETTINGS.diameterMM[0], SETTINGS.diameterMM[1], rand());
    const initialOuterRadius = (diameter * scale * 0.5) * PX_PER_MM;
    const center = chooseSpreadPlacement(rand, scale, placement, placed, initialOuterRadius);
    cluster.center = center;

    for (let i = 0; i < cluster.size; i += 1) {
      const diameterMM = i === 0 ? diameter : lerp(SETTINGS.diameterMM[0], SETTINGS.diameterMM[1], rand());
      const thicknessMM = lerp(SETTINGS.thicknessMM[0], SETTINGS.thicknessMM[1], rand());
      const outerR = (diameterMM * scale * 0.5) * PX_PER_MM;
      const thickness = (thicknessMM * scale) * PX_PER_MM;
      const position = i === 0
        ? center
        : chooseClusterPlacement(
          rand,
          scale,
          placement,
          clustering.clusterRadiusMM ?? 0,
          center,
          placed,
          outerR,
        );
      const color = pickColorPrimary(rand, SETTINGS.opacity[0], SETTINGS.opacity[1]);

      stains.push({
        x: position.x,
        y: position.y,
        outerR,
        thickness,
        color,
      });
      placed.push({ x: position.x, y: position.y, outerR });
    }
  }

  // Place remaining rings spread out.
  while (stains.length < count) {
    const diameterMM = lerp(SETTINGS.diameterMM[0], SETTINGS.diameterMM[1], rand());
    const thicknessMM = lerp(SETTINGS.thicknessMM[0], SETTINGS.thicknessMM[1], rand());
    const outerR = (diameterMM * scale * 0.5) * PX_PER_MM;
    const thickness = (thicknessMM * scale) * PX_PER_MM;
    const position = chooseSpreadPlacement(rand, scale, placement, placed, outerR);
    const color = pickColorPrimary(rand, SETTINGS.opacity[0], SETTINGS.opacity[1]);

    stains.push({
      x: position.x,
      y: position.y,
      outerR,
      thickness,
      color,
    });
    placed.push({ x: position.x, y: position.y, outerR });
  }

  // Draw (stable per stain index).
  for (let i = 0; i < stains.length; i += 1) {
    const localRand = mulberry32((seed + (i * 2654435761)) >>> 0);
    drawCoffeeStain(ctx, localRand, stains[i], SETTINGS.texture, SETTINGS.scale);
  }
}

export function setupLandingBackground() {
  const canvas = document.getElementById('landingBackgroundCanvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  generateBackground(canvas, ctx);
}
