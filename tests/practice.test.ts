import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateChallenge,
  createChallengeGenerator,
  normalizeEquation,
  makeScore,
  addScore,
  readScores,
} from '../src/core/practice.ts';
import { renderEquation } from '../src/services/equation-renderer.ts';
import { mathjax } from '@mathjax/src/mjs/mathjax.js';
mathjax.asyncLoad = (name: string) => import(name.replace('/js/', '/mjs/'));
let seed = 14819;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
test('randomized grammar renders AMS / physics / mathtools across styles and lengths', async () => {
  const unique = new Set<string>();
  const topics = new Set<string>();
  for (const style of ['physics', 'mathematics'] as const)
    for (const difficulty of ['short', 'standard', 'extended'] as const) {
      for (let n = 0; n < 120; n++) {
        const c = generateChallenge(style, difficulty, random);
        unique.add(c.tex);
        topics.add(c.topic);
        const r = await renderEquation(c.tex);
        assert.match(r.svg, /<svg/);
        assert.ok(r.fingerprint.length > 0);
        assert.doesNotMatch(r.svg, /merror/);
      }
    }
  assert.ok(unique.size > 650);
  assert.ok(topics.size >= 17);
});
test('notation comparison accepts TeX aliases but distinguishes different expressions', async () => {
  const a = await renderEquation('\\frac{x}{2}');
  const b = await renderEquation('\\dfrac{x}{2}');
  const c = await renderEquation('\\frac{x}{3}');
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(
    (await renderEquation('x\\, + y')).fingerprint,
    (await renderEquation('x+y')).fingerprint,
  );
  assert.notEqual(
    (await renderEquation('\\mathbb{R}')).fingerprint,
    (await renderEquation('R')).fingerprint,
  );
  assert.notEqual(a.fingerprint, c.fingerprint);
  await assert.rejects(renderEquation('\\frac{'));
  await assert.rejects(renderEquation('\\unknowncommand{x}'));
  const physics = await renderEquation(
    '\\pdv[2]{f}{x}+\\bra{\\psi}\\hat{H}\\ket{\\phi}+\\curl{\\vb{A}}',
  );
  assert.match(physics.svg, /<svg/);
});
test('scores measure output, exclude assisted and implausibly short attempts, partition records', () => {
  const c = generateChallenge('physics', 'standard', random);
  assert.equal(makeScore(c, 0, false), null);
  assert.equal(makeScore(c, 12000, true), null);
  const s = makeScore(c, 12000, false)!;
  assert.equal(s.cpm, Math.round(c.tex.replace(/\s/g, '').length * 5));
  let scores = [s];
  assert.equal(addScore(scores, s).length, 1);
  for (let n = 0; n < 20; n++) scores = addScore(scores, { ...s, id: String(n), cpm: 100 + n });
  assert.equal(scores.length, 10);
  scores = addScore(scores, { ...s, id: 'math', style: 'mathematics' });
  assert.equal(scores.length, 11);
  assert.deepEqual(readScores('broken'), []);
  assert.deepEqual(readScores('[{"cpm":-1}]'), []);
  assert.deepEqual(readScores(JSON.stringify(scores)), scores);
  assert.equal(normalizeEquation('\\[ x + y \\]'), normalizeEquation('x+y'));
  assert.notEqual(normalizeEquation('\\sin x'), normalizeEquation('\\sinx'));
});

function seeded(value: number) {
  return () => (value = (value * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

test('sessions avoid nearby topics, stay bounded, and reproduce from a seed', () => {
  const a = createChallengeGenerator(seeded(71));
  const b = createChallengeGenerator(seeded(71));
  for (const style of ['physics', 'mathematics'] as const) {
    for (const difficulty of ['short', 'standard', 'extended'] as const) {
      const recent: string[] = [];
      const structures = new Set<string>();
      let totalLength = 0;
      for (let i = 0; i < 250; i++) {
        const c = a(style, difficulty);
        assert.equal(c.tex, b(style, difficulty).tex);
        assert.ok(!recent.includes(c.topic), `Repeated topic ${c.topic}`);
        recent.push(c.topic);
        if (recent.length > 5) recent.shift();
        assert.ok(c.tex.length <= { short: 150, standard: 330, extended: 620 }[difficulty], c.tex);
        // Erase letters/numbers, retain TeX commands, delimiters and operators:
        // differences here cannot be explained by swapping variable names.
        structures.add((c.tex.match(/\\[a-zA-Z]+|[^a-zA-Z0-9\s]/g) || []).join(''));
        totalLength += c.tex.length;
      }
      assert.ok(
        structures.size > 170,
        `${style}/${difficulty}: only ${structures.size} structures`,
      );
      assert.ok(totalLength > 0);
    }
  }
});

test('constant random sources terminate with valid output at every length', async () => {
  for (const value of [0, 0.23, 0.999999]) {
    const next = createChallengeGenerator(() => value);
    for (const style of ['physics', 'mathematics'] as const)
      for (const difficulty of ['short', 'standard', 'extended'] as const) {
        for (let i = 0; i < 15; i++) {
          const c = next(style, difficulty);
          assert.ok(
            c.tex.length <= { short: 150, standard: 330, extended: 620 }[difficulty],
            c.tex,
          );
          await renderEquation(c.tex);
        }
      }
  }
});
