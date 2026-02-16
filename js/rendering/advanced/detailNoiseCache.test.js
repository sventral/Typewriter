import assert from 'node:assert/strict';
import { createDetailNoiseCache } from './detailNoiseCache.js';
import { noise2 } from './textureMath.js';

const approxEqual = (a, b, epsilon = 1e-7) => Math.abs(a - b) <= epsilon;

const baseParams = {
  detailCss: 4.25,
  width: 8,
  height: 6,
  dpPerCss: 2,
  scale: 0.75,
  seed: 0x1234ABCD,
  xMul: 1.5,
  yMul: 0.85,
  xOffset: 13.25,
  yOffset: -3.5,
};

const cache = createDetailNoiseCache({ noise2, maxEntriesPerDetail: 2 });

cache.clear();

const tile1 = cache.getTile(baseParams);
let stats = cache.stats();
assert.equal(stats.misses, 1, 'First request should register a cache miss');
assert.equal(stats.hits, 0, 'No hits should be recorded after first miss');

const tile2 = cache.getTile(baseParams);
stats = cache.stats();
assert.strictEqual(tile1, tile2, 'Cache should reuse tile instances for identical requests');
assert.equal(stats.hits, 1, 'Second request should count as a cache hit');

const invDp = 1 / baseParams.dpPerCss;
for (let y = 0; y < baseParams.height; y++) {
  for (let x = 0; x < baseParams.width; x++) {
    const i = y * baseParams.width + x;
    const xCss = x * invDp;
    const yCss = y * invDp;
    const expected = noise2(
      xCss * baseParams.xMul + baseParams.xOffset,
      yCss * baseParams.yMul + baseParams.yOffset,
      baseParams.scale,
      baseParams.seed,
    );
    assert.ok(
      approxEqual(expected, tile1.data[i], 1e-6),
      `Tile sample mismatch at (${x}, ${y})`,
    );
  }
}

const paramsA = { ...baseParams, seed: 0x1 };
const paramsB = { ...baseParams, seed: 0x2 };
const paramsC = { ...baseParams, seed: 0x3 };

cache.clear();
const tileA = cache.getTile(paramsA);
const tileB = cache.getTile(paramsB);
cache.getTile(paramsB); // refresh B as most recently used
cache.getTile(paramsC);
const tileAAfterEvict = cache.getTile(paramsA);

assert.notStrictEqual(
  tileA,
  tileAAfterEvict,
  'Oldest tile should be evicted when cache exceeds capacity',
);

console.log('detailNoiseCache tests passed.');
