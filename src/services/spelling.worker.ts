import nspell from 'nspell';
import aff from '../../node_modules/dictionary-en/index.aff?raw';
import dic from '../../node_modules/dictionary-en/index.dic?raw';
import { proseWords, wordKey } from '../core/spelling';
const spell = nspell({ aff, dic });
for (const word of ['LaTeX', 'TeX', 'BibTeX', 'CodeMirror']) spell.add(word);
self.onmessage = (event: MessageEvent) => {
  const { id, type, text, comments, dictionary, word } = event.data;
  try {
    if (type === 'suggest') {
      self.postMessage({ id, suggestions: spell.suggest(word.replaceAll('’', "'")).slice(0, 8) });
    } else {
      const allowed = new Set(dictionary.map(wordKey));
      const cache = new Map<string, boolean>();
      const issues = proseWords(text, comments)
        .filter((item) => {
          const key = wordKey(item.word);
          if (allowed.has(key)) return false;
          if (!cache.has(item.word))
            cache.set(item.word, spell.correct(item.word.replaceAll('’', "'")));
          return !cache.get(item.word);
        })
        .slice(0, 2000);
      self.postMessage({ id, issues });
    }
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
