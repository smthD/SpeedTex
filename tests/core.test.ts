import { selectTermLeft, leftTermCut, braceContent, mergeRanges } from '../src/core/editing.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextAt, ContextIndex } from '../src/core/context.ts';
import { parseTemplate, matchSnippet, defaultSnippets, safeRegex } from '../src/core/snippets.ts';
import { navigate, pairs } from '../src/core/navigation.ts';
import {
  defaults,
  validateConfig,
  bindingConflicts,
  KeybindingResolver,
} from '../src/core/config.ts';
import { indexDocument, fuzzy } from '../src/core/indexer.ts';
const atEnd = (s: string) => contextAt(s, s.length);
test('math context: dollars, display, environments, escapes and comments', () => {
  for (const s of ['$x', '$$x', '\\(x', '\\[x', '\\begin{align*}\nx &= y', '\\begin{equation}x'])
    assert.equal(atEnd(s).mode, 'math', s);
  for (const s of [
    '$x$ prose',
    '$$x$$ prose',
    '\\(x\\) prose',
    '\\[x\\] prose',
    '\\$5',
    '% $x\nprose',
    '\\begin{align}x\\end{align} prose',
  ])
    assert.equal(atEnd(s).mode, 'text', s);
  assert.equal(atEnd('$x % comment').comment, true);
  assert.equal(atEnd('\\% $x').mode, 'math');
  assert.equal(atEnd('$x+\\text{ordinary prose').mode, 'text');
  assert.equal(atEnd('$x+\\text{ordinary prose}+y').mode, 'math');
  assert.equal(atEnd('\\cite{rud').argument, 'cite');
});
test('cached context invalidation propagates across changed math delimiters', () => {
  const i = new ContextIndex();
  let text = 'Introduction\n$x\n+y\n+z\n';
  i.update(text);
  assert.equal(i.at(text.length).mode, 'math');
  text = text.replace('$x', ' x');
  i.update(text, 13);
  assert.equal(i.at(text.length).mode, 'text');
});
test('snippet template orders tab stops and final cursor', () => {
  const p = parseTemplate('\\frac{${1:x}}{${2:y}}$0');
  assert.equal(p.text, '\\frac{x}{y}');
  assert.deepEqual(p.stops, [
    { number: 1, from: 6, to: 7 },
    { number: 2, from: 9, to: 10 },
    { number: 0, from: 11, to: 11 },
  ]);
});
test('snippets honor mode, comments, boundaries and manual activation', () => {
  assert.equal(matchSnippet('$fr/', atEnd('$fr/'), defaultSnippets, true)?.text, '\\frac{}{}');
  assert.equal(matchSnippet('fr/', atEnd('fr/'), defaultSnippets, true), null);
  assert.equal(matchSnippet('$ % fr/', atEnd('$ % fr/'), defaultSnippets, true), null);
  assert.equal(matchSnippet('$\\sin', atEnd('$\\sin'), defaultSnippets, true), null);
  assert.equal(matchSnippet('$arcsin', atEnd('$arcsin'), defaultSnippets, true), null);
  const manual = { ...defaultSnippets[0], auto: false };
  assert.equal(matchSnippet('$fr/', atEnd('$fr/'), [manual], true), null);
  assert.ok(matchSnippet('$fr/', atEnd('$fr/'), [manual], false));
});
test('snippet conditional filters and priorities', () => {
  const base = { ...defaultSnippets[0], context: 'everywhere' as const, afterWhitespace: true };
  assert.equal(matchSnippet('xfr/', atEnd('xfr/'), [base], true), null);
  assert.ok(matchSnippet(' fr/', atEnd(' fr/'), [base], true));
  assert.equal(
    matchSnippet(' fr/', atEnd(' fr/'), [{ ...base, environment: 'align' }], true),
    null,
  );
  const high = { ...base, id: 'high', replacement: 'higher', priority: 10 };
  assert.equal(matchSnippet(' fr/', atEnd(' fr/'), [base, high], true)?.text, 'higher');
  assert.throws(() => safeRegex('(a+)+'));
  assert.ok(safeRegex('[ab]/').test('a/'));
});
test('nested brace navigation reaches sibling argument then exit', () => {
  const text = '\\frac{\\sqrt{x^{2}+1}}{\\alpha+\\frac{1}{x}}';
  const numeratorEnd = text.indexOf('}{\\alpha');
  const denominator = text.indexOf('\\alpha');
  assert.equal(navigate(text, numeratorEnd, 'nextArgument'), denominator);
  assert.equal(navigate(text, denominator, 'previousArgument'), 6);
  const pos = text.indexOf('2');
  assert.equal(navigate(text, pos, 'outside'), text.indexOf('2') + 2);
  assert.equal(navigate('\\frac{numerator}{denominator}', 15, 'nextArgument'), 17);
  assert.equal(navigate('\\frac{numerator}{denominator}', 20, 'nextArgument'), 29);
});
test('escaped braces and comments do not become argument pairs', () => {
  assert.equal(pairs('\\{x\\} % {bad}\n{ok}').filter((p) => p.char === '{').length, 1);
  assert.equal(navigate('$a$ then \\[b\\]', 1, 'mathEnd'), 2);
});
test('configuration validation rejects malformed imports', () => {
  assert.equal(validateConfig(defaults()).settings.fontSize, 15);
  assert.throws(() => validateConfig({ ...defaults(), version: 2 }));
  assert.throws(() =>
    validateConfig({ ...defaults(), settings: { ...defaults().settings, fontSize: NaN } }),
  );
  const c = defaults();
  c.snippets.push(c.snippets[0]);
  assert.throws(() => validateConfig(c));
});
test('context keys override global keys and chords time out', () => {
  const r = new KeybindingResolver();
  const bindings = [
    { key: 'Ctrl-f', command: 'next', context: 'math' as const },
    { key: 'Mod-f', command: 'find', context: 'everywhere' as const },
    { key: 'Mod-k Mod-s', command: 'settings', context: 'everywhere' as const },
  ];
  assert.equal(r.resolve('Mod-f', 'math', bindings).command, 'next');
  assert.equal(r.resolve('Mod-f', 'text', bindings).command, 'find');
  assert.equal(r.resolve('Mod-k', 'text', bindings, 0).pending, true);
  assert.equal(r.resolve('Mod-s', 'text', bindings, 10).command, 'settings');
  r.resolve('Mod-k', 'text', bindings, 0);
  assert.equal(r.resolve('Mod-s', 'text', bindings, 2000).command, undefined);
  assert.equal(
    bindingConflicts([
      { key: 'Mod-x', command: 'one', context: 'math' },
      { key: 'Mod-x', command: 'two', context: 'text' },
    ]).length,
    0,
  );
});
test('indexer finds nested headings, labels, definitions, and citations', () => {
  const text =
    '\\section{A \\textbf{nested} heading}\n% \\label{ignored}\n\\label{sec:a}\n\\newcommand{\\R}{x}';
  const syms = indexDocument('main.tex', text);
  assert.equal(syms[0].name, 'A \\textbf{nested} heading');
  assert.ok(syms.some((s) => s.name === 'sec:a'));
  assert.ok(syms.some((s) => s.name === '\\R'));
  assert.ok(!syms.some((s) => s.name === 'ignored'));
  const bib = indexDocument(
    'refs.bib',
    '@book{rudin,\n author={Walter Rudin},\n title={Analysis},\n year={1976}\n}',
  );
  assert.equal(bib[0].name, 'rudin');
  assert.match(bib[0].detail!, /1976/);
  assert.ok(fuzzy('mn', 'main.tex') > 0);
  assert.equal(fuzzy('xyz', 'main.tex'), -1);
});

test('smart delimiters: display math, left/right, escaped pairs and pair deletion', async () => {
  const { delimiterInput, delimiterBackspace } = await import('../src/core/delimiters.ts');
  assert.deepEqual(delimiterInput('$$', 1, 1, '$'), { from: 0, to: 2, insert: '$$$$', anchor: 2 });
  assert.equal(delimiterInput('\\left', 5, 5, '(')?.insert, '(\\right)');
  assert.equal(delimiterInput('\\', 1, 1, '[')?.insert, '[\\]');
  assert.equal(delimiterInput('(x)', 2, 2, ')')?.anchor, 3);
  assert.deepEqual(delimiterBackspace('\\left(\\right)', 6), {
    from: 0,
    to: 13,
    insert: '',
    anchor: 0,
  });
  assert.equal(delimiterBackspace('$$$$', 2)?.insert, '');
});

test('logical forward movement visits nested arguments before exiting the fraction', () => {
  const marked = [
    String.raw`\frac{|3x^{2}}{1}`,
    String.raw`\frac{3x^{|2}}{1}`,
    String.raw`\frac{3x^{2}|}{1}`,
    String.raw`\frac{3x^{2}}{|1}`,
    String.raw`\frac{3x^{2}}{1}|`,
  ];
  for (let i = 0; i < marked.length - 1; i++) {
    const text = marked[i].replace('|', '');
    assert.equal(
      navigate(text, marked[i].indexOf('|'), 'nextPosition'),
      marked[i + 1].indexOf('|'),
    );
  }
  const spaced = String.raw`\frac{ | 3x^{2}}{1}`;
  assert.equal(
    navigate(spaced.replace('|', ''), spaced.indexOf('|'), 'nextPosition'),
    spaced.replace('|', '').indexOf('2'),
  );
  // The explicit exit command still exits immediately.
  const text = marked[0].replace('|', '');
  assert.equal(navigate(text, 6, 'outside'), text.indexOf('}{1}') + 1);
  assert.equal(navigate(text, text.length, 'nextPosition'), text.length);
});

test('logical forward movement skips escaped and commented braces and handles spaced arguments', () => {
  const marked = String.raw`\frac{|\{literal\} % {ignored}
    \sqrt{x}} {y}`;
  const text = marked.replace('|', '');
  assert.equal(navigate(text, marked.indexOf('|'), 'nextPosition'), text.indexOf('{x}') + 1);
  const sibling = String.raw`\frac{x|} {y}`;
  assert.equal(
    navigate(sibling.replace('|', ''), sibling.indexOf('|'), 'nextPosition'),
    sibling.replace('|', '').indexOf('y'),
  );
  assert.equal(navigate('plain text', 0, 'nextPosition'), 0);
});

test('legacy Alt+Right default upgrades without replacing customized bindings', () => {
  const old = defaults();
  delete old.keybindingDefaultsVersion;
  old.keybindings = [
    { command: 'outside', key: 'Alt-ArrowRight', context: 'everywhere' },
    { command: 'outside', key: 'Alt-x', context: 'math' },
    { command: 'nextArgument', key: 'Alt-ArrowRight', context: 'math' },
  ];
  const upgraded = validateConfig(old);
  assert.equal(upgraded.keybindings[0].command, 'nextPosition');
  assert.deepEqual(upgraded.keybindings.slice(1, old.keybindings.length), old.keybindings.slice(1));
  assert.equal(old.keybindings[0].command, 'outside');
  assert.deepEqual(validateConfig(upgraded), upgraded);
  const explicit = { ...old, keybindingDefaultsVersion: 2 };
  assert.equal(validateConfig(explicit).keybindings[0].command, 'outside');
});

test('logical backward movement goes from denominator content to the numerator', () => {
  for (const marked of [
    String.raw`\frac{3x^2}{1 |}`,
    String.raw`\frac{3x^2}{|1}`,
    String.raw`\frac{3x^2}  {1|}`,
    String.raw`\frac{3x^2}{}{1|}`,
  ]) {
    const text = marked.replace('|', '');
    const expected = text.includes('{}') ? text.indexOf('{}') + 1 : 6;
    assert.equal(navigate(text, marked.indexOf('|'), 'previousPosition'), expected);
    assert.equal(text, marked.replace('|', ''));
  }
  assert.equal(navigate('plain text', 5, 'previousPosition'), 5);
  assert.equal(navigate(String.raw`\frac{x}{y}`, 6, 'previousPosition'), 6);
});

test('logical backward movement reverses the nested forward stops', () => {
  const marked = [
    String.raw`\frac{|3x^{2}}{1}`,
    String.raw`\frac{3x^{|2}}{1}`,
    String.raw`\frac{3x^{2}|}{1}`,
    String.raw`\frac{3x^{2}}{|1}`,
    String.raw`\frac{3x^{2}}{1}|`,
  ];
  const text = marked[0].replace('|', '');
  for (let i = marked.length - 1; i > 0; i--) {
    assert.equal(
      navigate(text, marked[i].indexOf('|'), 'previousPosition'),
      marked[i - 1].indexOf('|'),
    );
    assert.equal(
      navigate(text, marked[i - 1].indexOf('|'), 'nextPosition'),
      marked[i].indexOf('|'),
    );
  }
  const escaped = String.raw`\frac{x\{ignored\}}{y % {ignored}
    |}`;
  assert.equal(navigate(escaped.replace('|', ''), escaped.indexOf('|'), 'previousPosition'), 6);
});

test('legacy Alt+Left upgrades from both earlier defaults while preserving custom bindings', () => {
  for (const version of [undefined, 1, 2] as const) {
    const legacy = defaults();
    legacy.keybindingDefaultsVersion = version;
    legacy.keybindings = [
      { command: 'inside', key: 'Alt-ArrowLeft', context: 'everywhere' },
      { command: 'inside', key: 'Alt-u', context: 'everywhere' },
      { command: 'inside', key: 'Alt-ArrowLeft', context: 'math' },
    ];
    const upgraded = validateConfig(legacy);
    assert.equal(upgraded.keybindingDefaultsVersion, 7);
    assert.equal(upgraded.keybindings[0].command, 'previousPosition');
    assert.deepEqual(
      upgraded.keybindings.slice(1, legacy.keybindings.length),
      legacy.keybindings.slice(1),
    );
    assert.equal(legacy.keybindings[0].command, 'inside');
    assert.deepEqual(validateConfig(upgraded), upgraded);
    legacy.keybindingDefaultsVersion = 3;
    assert.equal(validateConfig(legacy).keybindings[0].command, 'inside');
  }
});

test('appearance settings validate colors and migrate legacy light profiles', () => {
  const original = defaults();
  const migrated = validateConfig({ ...original, settings: { theme: 'light', fontSize: 18 } });
  assert.equal(migrated.settings.theme, 'dark');
  assert.equal(migrated.settings.fontSize, 18);
  assert.equal(migrated.settings.accentColor, '#9daeff');
  const custom = structuredClone(original);
  custom.settings.accentColor = '#Aa19fF';
  custom.settings.cursorColor = '#ffffff';
  assert.deepEqual(validateConfig(JSON.parse(JSON.stringify(custom))).settings, custom.settings);
  for (const value of ['red', '#fff', '#12345678', 'url(test)', null]) {
    assert.throws(
      () => validateConfig({ ...original, settings: { ...original.settings, accentColor: value } }),
      /hex color/,
    );
  }
});

test('outer argument movement ignores all nested brace layers', () => {
  const text = String.raw`\frac{3x^{2x^{2}}}{3x^{2}}`;
  const numerator = text.indexOf('{') + 1;
  const denominator = text.indexOf('}{3x') + 2;
  assert.equal(navigate(text, text.indexOf('^{2}') + 2, 'nextArgument'), denominator);
  assert.equal(navigate(text, text.lastIndexOf('^{2}') + 2, 'previousArgument'), numerator);
  for (let pos = numerator; pos < denominator - 1; pos++)
    assert.equal(navigate(text, pos, 'nextArgument'), denominator);
  assert.equal(navigate(text, text.length - 2, 'nextArgument'), text.length);
  assert.equal(navigate(text, numerator, 'previousArgument'), numerator);
  const spaced = String.raw`\frac{a^{b}}  {c^{d}}`;
  assert.equal(navigate(spaced, spaced.indexOf('b'), 'nextArgument'), spaced.indexOf('{c') + 1);
  assert.equal(navigate(spaced, spaced.indexOf('d'), 'previousArgument'), 6);
  const ignored = String.raw`\{escaped\} % {comment}
\frac{x^{2}}{y^{3}}`;
  assert.equal(navigate(ignored, ignored.indexOf('2'), 'nextArgument'), ignored.indexOf('{y') + 1);
});

test('term movement implements directional ends and starts for all separators', () => {
  assert.equal(navigate('3x+5x', 0, 'nextTerm'), 2);
  assert.equal(navigate('3x+5x', 2, 'nextTerm'), 3);
  assert.equal(navigate('3x+5x', 5, 'previousTerm'), 3);
  assert.equal(navigate('3x+5x', 3, 'previousTerm'), 2);
  for (const separator of ['+', '-', ' ', '   ', '\\cdot', '\\times', ' +  ', '\t', '\n']) {
    const text = '3x' + separator + '5x';
    assert.equal(navigate(text, 0, 'nextTerm'), 2);
    assert.equal(
      navigate(text, 2, 'nextTerm'),
      2 + (separator.startsWith('\\') ? separator.length : 1),
    );
    assert.equal(navigate(text, text.length, 'previousTerm'), 2 + separator.length);
    assert.equal(
      navigate(text, 2 + separator.length, 'previousTerm'),
      separator.startsWith('\\') ? 2 : 1 + separator.length,
    );
  }
  assert.equal(navigate(String.raw`x\timesfoo+y`, 0, 'nextTerm'), 10);
  assert.equal(navigate(String.raw`x\+y`, 0, 'nextTerm'), 4);
  assert.equal(navigate('  +  ', 0, 'nextTerm'), 1);
  assert.equal(navigate('  +  ', 5, 'previousTerm'), 4);
  assert.equal(navigate('', 0, 'nextTerm'), 0);
});

test('line jumps land at actual line boundaries, including blank lines and CRLF', () => {
  assert.equal(navigate('abc\n  def\n', 7, 'lineStart'), 4);
  assert.equal(navigate('abc\n  def\n', 5, 'lineEnd'), 9);
  assert.equal(navigate('abc\n  def\n', 3, 'lineStart'), 0);
  assert.equal(navigate('abc\n  def\n', 10, 'lineEnd'), 10);
  assert.equal(navigate('\nabc', 0, 'lineStart'), 0);
  assert.equal(navigate('abc\r\ndef', 1, 'lineEnd'), 3);
});

test('movement binding migration preserves custom local moves and installs new keys once', () => {
  const old = defaults();
  old.keybindingDefaultsVersion = 3;
  old.keybindings = [
    { command: 'nextArgument', key: 'Alt-f', context: 'math' },
    { command: 'previousArgument', key: 'Alt-a', context: 'math' },
    { command: 'nextPosition', key: 'Alt-d', context: 'everywhere' },
    { command: 'previousPosition', key: 'Alt-s', context: 'everywhere' },
    { command: 'mathEnd', key: 'Alt-j', context: 'everywhere' },
  ];
  const upgraded = validateConfig(old);
  assert.deepEqual(upgraded.keybindings.slice(0, 5), old.keybindings);
  for (const key of ['Alt-e', 'Alt-w', 'Alt-r', 'Alt-q'])
    assert.ok(upgraded.keybindings.some((b) => b.key === key));
  assert.deepEqual(validateConfig(upgraded), upgraded);
  old.keybindings.push({ command: 'palette', key: 'Alt-e', context: 'everywhere' });
  assert.equal(validateConfig(old).keybindings.filter((b) => b.key === 'Alt-e').length, 1);
});

test('term selection grows left and cuts use the same lexical boundaries', () => {
  const a = selectTermLeft('3x+5x', { from: 5, to: 5 });
  assert.deepEqual(a, { from: 3, to: 5 });
  const b = selectTermLeft('3x+5x', a);
  assert.deepEqual(b, { from: 0, to: 5 });
  assert.deepEqual(selectTermLeft('3x+5x', b), b);
  assert.deepEqual(selectTermLeft('3x+5x', { from: 4, to: 4 }), a);
  assert.deepEqual(leftTermCut('3x+5x', 5), a);
  assert.deepEqual(leftTermCut('3x+5x', 3), { from: 0, to: 3 });
  assert.deepEqual(leftTermCut('3x+5x', 0), { from: 0, to: 0 });
  assert.deepEqual(selectTermLeft('', { from: 0, to: 0 }), { from: 0, to: 0 });
  const text = String.raw`3x \cdot 5x`;
  assert.deepEqual(selectTermLeft(text, { from: text.length, to: text.length }), {
    from: text.length - 2,
    to: text.length,
  });
});
test('brace cut targets only innermost contents and never removes delimiters', () => {
  const text = String.raw`\frac{3x+1}{2}`;
  assert.deepEqual(braceContent(text, text.indexOf('1')), { from: 6, to: 10 });
  assert.equal(braceContent(text, 0), null);
  assert.equal(braceContent(text, text.length), null);
  const nested = String.raw`\frac{x^{2}}{y}`;
  assert.deepEqual(braceContent(nested, nested.indexOf('2')), { from: 9, to: 10 });
  assert.equal(braceContent(String.raw`\{x\}`, 2), null);
  assert.equal(braceContent('% {x}', 3), null);
  assert.deepEqual(
    mergeRanges([
      { from: 1, to: 3 },
      { from: 1, to: 3 },
      { from: 2, to: 4 },
    ]),
    [{ from: 1, to: 4 }],
  );
});
test('editing migration assigns requested clipboard keys and remains customizable after migration', () => {
  const c = defaults();
  c.keybindingDefaultsVersion = 4;
  c.keybindings = [
    { command: 'mathEnd', key: 'Alt-p', context: 'everywhere' },
    { command: 'nextPosition', key: 'Alt-d', context: 'everywhere' },
  ];
  const migrated = validateConfig(c);
  assert.deepEqual(
    migrated.keybindings.find((b) => b.key === 'Alt-p'),
    { command: 'selectTerm', key: 'Alt-p', context: 'everywhere' },
  );
  assert.ok(migrated.keybindings.some((b) => b.key === 'Alt-d' && b.command === 'nextPosition'));
  for (const key of ['Alt-o', 'Alt-i', 'Alt-l'])
    assert.ok(migrated.keybindings.some((b) => b.key === key));
  migrated.keybindings = migrated.keybindings.filter((b) => b.key !== 'Alt-p');
  assert.deepEqual(validateConfig(migrated), migrated);
});

test('term navigation stops inside math and round/square delimiters', () => {
  for (const [open, close] of [
    ['$', '$'],
    ['$$', '$$'],
    ['\\[', '\\]'],
    ['\\(', '\\)'],
    ['(', ')'],
    ['[', ']'],
    ['\\left(', '\\right)'],
    ['\\left[', '\\right]'],
    ['\\left (', '\\right )'],
  ]) {
    const text = `${open}5x+3${close}`;
    assert.equal(navigate(text, open.length + 2, 'previousTerm'), open.length, text);
    assert.equal(navigate(text, open.length, 'nextTerm'), open.length + 2, text);
    assert.equal(navigate(text, open.length + 2, 'nextTerm'), open.length + 3, text);
    assert.equal(navigate(text, open.length + 4, 'previousTerm'), open.length + 3, text);
  }
  const text = String.raw`3\left(x^2\right)`;
  assert.equal(navigate(text, 1, 'nextTerm'), text.indexOf('x'));
  assert.equal(navigate(text, text.indexOf('\\right'), 'previousTerm'), text.indexOf('x'));
  assert.equal(navigate('x^{2}', 0, 'nextTerm'), 5);
  for (const text of [
    String.raw`x\$5`,
    String.raw`x\leftarrow`,
    String.raw`x\timesfoo`,
    String.raw`x\{y\}`,
  ])
    assert.equal(navigate(text, 0, 'nextTerm'), text.length, text);
  assert.equal(navigate('([x])', 0, 'nextTerm'), 1);
  assert.equal(navigate('([x])', 5, 'previousTerm'), 4);
});

test('custom term rules are validated, portable and shared by movement/select/cut', () => {
  const old = defaults();
  delete (old.settings as Partial<typeof old.settings>).termSeparators;
  delete (old.settings as Partial<typeof old.settings>).termWhitespace;
  assert.ok(validateConfig(old).settings.termSeparators.includes('$'));
  const c = defaults();
  c.settings.termSeparators = ['=', '<=', '\\approx'];
  c.settings.termWhitespace = false;
  const rules = validateConfig(JSON.parse(JSON.stringify(c))).settings;
  const text = String.raw`x+y <= z\approx w`;
  assert.equal(navigate(text, 0, 'nextTerm', rules), 4);
  assert.equal(navigate(text, text.length, 'previousTerm', rules), text.indexOf(' w'));
  assert.deepEqual(selectTermLeft('a=b', { from: 3, to: 3 }, rules), { from: 2, to: 3 });
  assert.deepEqual(leftTermCut('a=b', 3, rules), { from: 2, to: 3 });
  for (const bad of [null, 'x', [null], [''], ['\n'], ['x'.repeat(81)], Array(65).fill('=')]) {
    const value = defaults();
    (value.settings as any).termSeparators = bad;
    assert.throws(() => validateConfig(value));
  }
});

test('navigation crosses each adjacent separator independently and reversibly', () => {
  for (const [text, stops] of [
    ['3x^2++x', [0, 4, 5, 6, 7]],
    [String.raw`x\cdot\times y`, [0, 1, 6, 12, 13, 14]],
    [String.raw`$$x\left(y\right)$$`, [0, 2, 3, 9, 10, 17, 19]],
  ] as const) {
    for (let i = 1; i < stops.length; i++) {
      assert.equal(navigate(text, stops[i - 1], 'nextTerm'), stops[i], text);
      assert.equal(navigate(text, stops[i], 'previousTerm'), stops[i - 1], text);
    }
  }
  const rules = { termSeparators: ['<=', '+'], termWhitespace: true };
  assert.equal(navigate('x<=+y', 1, 'nextTerm', rules), 3);
  assert.equal(navigate('x<=+y', 3, 'nextTerm', rules), 4);
  assert.equal(navigate('x<=+y', 3, 'previousTerm', rules), 1);
  assert.equal(navigate(String.raw`x\cdot y`, 4, 'nextTerm'), 6);
  assert.equal(navigate(String.raw`x\cdot y`, 4, 'previousTerm'), 1);
});
