import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proseWords, dictionaryWords } from '../src/core/spelling.ts';
import { defaults, validateConfig } from '../src/core/config.ts';
import nspell from 'nspell';
import { readFile } from 'node:fs/promises';
const words = (s: string, comments = false) => proseWords(s, comments).map((w) => w.word);
test('checks prose and text arguments while excluding LaTeX syntax, math, metadata and code', () => {
  const text = String.raw`\documentclass{article}
\usepackage[unknownoption]{amsmath}
\newcommand{\R}{\mathbb{strangeword}}
\newcommand\thing[1]{somefakeword #1}
\section{Introdution}
Normal prose with \textbf{mispelled words}.
$mathfake$ $$mathfake$$ \(mathfake\) \[mathfake\]
\begin{align} mathfake + \text{visble prose} \end{align}
\label{badlabel}\ref{badlabel}\citep[badoptional]{badcitation}
\url{https://badhost.test/badpath}\href{badurl}{linked prose}
https://badhost.test/badpath user@badhost.test
\begin{verbatim} badcode \end{verbatim}
\verb|badinline| % badcomment
Final words.`;
  const actual = words(text);
  assert.deepEqual(actual, [
    'Introdution',
    'Normal',
    'prose',
    'with',
    'mispelled',
    'words',
    'visble',
    'prose',
    'linked',
    'prose',
    'Final',
    'words',
  ]);
  for (const item of proseWords(text)) assert.equal(text.slice(item.from, item.to), item.word);
  assert.deepEqual(words('good % badcomment\nnext', true), ['good', 'badcomment', 'next']);
  assert.deepEqual(words(String.raw`\begin{equation*} badmath \end{equation*} good`), ['good']);
  assert.deepEqual(words('naïve café don’t NASA x'), ['naïve', 'café', 'don’t']);
});
test('unfinished math and argument groups remain safe', () => {
  assert.deepEqual(words('prose $unfinished'), ['prose']);
  assert.deepEqual(words(String.raw`prose \cite{unfinished`), ['prose']);
  assert.deepEqual(words(String.raw`prose \begin{verbatim} unfinished`), ['prose']);
});
test('bundled dictionary detects mistakes and provides corrections', async () => {
  const spell = nspell({
    aff: await readFile('node_modules/dictionary-en/index.aff', 'utf8'),
    dic: await readFile('node_modules/dictionary-en/index.dic', 'utf8'),
  });
  assert.equal(spell.correct('mathematics'), true);
  assert.equal(spell.correct('mispelled'), false);
  assert.ok(spell.suggest('mispelled').includes('misspelled'));
  assert.deepEqual(dictionaryWords(['Quilltex', 'quilltex']), ['quilltex']);
  assert.throws(() => dictionaryWords(['bad word']));
  const old = defaults();
  delete (old.settings as any).spellCheck;
  assert.equal(validateConfig(old).settings.spellCheck, true);
  (old.settings as any).spellComments = 'yes';
  assert.throws(() => validateConfig(old));
});

test('spelling shortcuts migrate without overriding user keys', () => {
  const config = defaults();
  config.keybindingDefaultsVersion = 5;
  config.keybindings = [{ command: 'build', key: 'F7', context: 'everywhere' }];
  const migrated = validateConfig(config);
  assert.equal(migrated.keybindings.find((b) => b.key === 'F7')?.command, 'build');
  assert.equal(
    migrated.keybindings.find((b) => b.key === 'Shift-F7')?.command,
    'spellingSuggestions',
  );
  migrated.keybindings = [];
  assert.deepEqual(validateConfig(migrated).keybindings, []);
});
