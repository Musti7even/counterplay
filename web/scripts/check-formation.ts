// Self-check for the formation snapper: node --experimental-strip-types scripts/check-formation.ts
import assert from 'node:assert/strict';
import { classify } from '../src/data.ts';

const line = (depth: number, n: number) => Array.from({ length: n }, (_, i) => depth + (i % 2 ? 0.8 : -0.8));
assert.equal(classify([...line(-35, 4), ...line(-20, 4), ...line(-5, 2)], undefined, undefined, 4).label, '4-4-2');
assert.equal(classify([...line(-35, 4), ...line(-20, 3), ...line(-4, 3)], undefined, undefined, 4).label, '4-3-3');
assert.equal(classify([...line(-36, 3), ...line(-20, 5), ...line(-4, 2)]).label, '3-5-2');
assert.equal(classify([...line(-36, 4), ...line(-27, 2), ...line(-16, 3), ...line(-3, 1)], undefined, undefined, 4).label, '4-2-3-1');
console.log('formation check ok');
