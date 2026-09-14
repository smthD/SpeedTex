import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indexDelimiters,
  activeDelimiterPairs,
  delimiterPresets,
} from '../src/core/delimiter-highlighting.ts';
import { defaults, validateConfig } from '../src/core/config.ts';
const matched = (text: string) => {
  const index = indexDelimiters(text);
  assert.ok(
    index.tokens.every((t) => !t.error),
    JSON.stringify(index.tokens.filter((t) => t.error).map((t) => text.slice(t.from, t.to))),
  );
  return index;
};
test('nested LaTeX structures have paired colors and active enclosing pair', () => {
  const text = String.raw`\[\frac{\sqrt{x^{2}+1}}{\alpha+\frac{1}{x}}\]`;
  const index = matched(text);
  assert.equal(index.pairs.length, 7);
  for (const p of index.pairs)
    assert.equal(index.tokens[p.open].depth, index.tokens[p.close].depth);
  const active = activeDelimiterPairs(index, [text.indexOf('2')]);
  assert.equal(active.size, 1);
  const pair = index.pairs[[...active][0]];
  assert.equal(text.slice(index.tokens[pair.open].to, index.tokens[pair.close].from), '2');
});
test('sized, invisible, asymmetric and named fences are parsed as complete tokens', () => {
  for (const text of [
    String.raw`\left. x \right|`,
    String.raw`\left[ x \right)`,
    String.raw`\left\langle x \middle| y \right\rangle`,
    String.raw`\Bigl\{x\Bigr\}`,
    String.raw`\big( x \big)`,
    String.raw`\lVert x \rVert`,
    String.raw`\lfloor x \rfloor`,
    String.raw`\{x\}`,
    String.raw`$$x$$`,
  ]) {
    const index = matched(text);
    assert.equal(index.pairs.length, 1, text);
  }
  const text = String.raw`\left (x\right )`,
    index = matched(text);
  assert.equal(text.slice(index.tokens[0].from, index.tokens[0].to), String.raw`\left (`);
});
test('comments, commands, inline verbatim and raw environments do not create false pairs', () => {
  const text = String.raw`% {[(
\verb|{($| \% \$ \commandname
\begin{verbatim} }]\left( \end{verbatim}
\begin{equation} (x) \end{equation}`;
  const index = matched(text);
  assert.equal(index.pairs.length, 3);
  assert.equal(index.tokens.filter((t) => t.kind === 'environment').length, 4);
});
test('malformed input recovers without crossing pairs or pairing literal braces with groups', () => {
  for (const text of [
    '([)]',
    String.raw`\left(x`,
    String.raw`\right)`,
    String.raw`\middle|x`,
    String.raw`\{x}`,
    String.raw`\begin{align}x\end{equation}`,
  ])
    assert.ok(
      indexDelimiters(text).tokens.some((t) => t.error),
      text,
    );
  const text = '([)] {y}',
    index = indexDelimiters(text);
  assert.equal(index.tokens.at(-1)?.error, false);
  for (const p of index.pairs) assert.ok(index.tokens[p.open].from < index.tokens[p.close].from);
});
test('presets and custom settings validate, migrate and remain isolated', () => {
  for (const settings of Object.values(delimiterPresets)) {
    const config = defaults();
    config.settings.delimiterHighlight = structuredClone(settings);
    assert.deepEqual(validateConfig(config).settings.delimiterHighlight, settings);
  }
  const old = defaults();
  delete (old.settings as any).delimiterHighlight;
  assert.equal(validateConfig(old).settings.delimiterHighlight.mode, 'depth');
  const config = defaults();
  config.settings.delimiterHighlight.colors = ['bad'];
  assert.throws(() => validateConfig(config));
  assert.notEqual(defaults().settings.delimiterHighlight.colors[0], 'bad');
});

test('symmetric norm commands and heavily malformed input remain bounded', () => {
  for (const text of [String.raw`\|x\|`, String.raw`\vert x \vert`, String.raw`\big|x\big|`])
    assert.equal(matched(text).pairs.length, 1);
  const index = indexDelimiters('('.repeat(20000) + ']'.repeat(20000));
  assert.equal(index.tokens.length, 40000);
  assert.equal(index.pairs.length, 0);
});
