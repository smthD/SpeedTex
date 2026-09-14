import { Facet } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  type EditorView,
} from '@codemirror/view';
import type { SpellingIssue } from '../core/spelling';
export interface SpellOptions {
  enabled: boolean;
  comments: boolean;
  dictionary: string[];
}
export const spellOptions = Facet.define<SpellOptions, SpellOptions>({
  combine: (values) => values[0] || { enabled: false, comments: false, dictionary: [] },
});
export const spellPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    issues: SpellingIssue[] = [];
    error = '';
    private worker?: Worker;
    private timer?: ReturnType<typeof setTimeout>;
    private revision = 0;
    private id = 0;
    private pending = new Map<
      number,
      {
        resolve: (value: string[]) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    constructor(readonly view: EditorView) {
      this.schedule();
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.startState.facet(spellOptions) !== update.state.facet(spellOptions)
      ) {
        this.issues = [];
        this.decorations = Decoration.none;
        this.schedule();
      }
    }
    schedule() {
      clearTimeout(this.timer);
      this.revision++;
      if (!this.view.state.facet(spellOptions).enabled) {
        this.stop();
        return;
      }
      this.timer = setTimeout(() => this.check(), 450);
    }
    private connect() {
      if (this.worker) return this.worker;
      const worker = (this.worker = new Worker(
        new URL('../services/spelling.worker.ts', import.meta.url),
        { type: 'module' },
      ));
      worker.onerror = () => {
        this.error = 'Spell checker could not start';
        this.stop();
      };
      return worker;
    }
    private check() {
      const options = this.view.state.facet(spellOptions),
        doc = this.view.state.doc;
      const revision = this.revision,
        id = ++this.id;
      const worker = this.connect();
      worker.onmessage = ({ data }) => {
        const request = this.pending.get(data.id);
        if (request) {
          this.pending.delete(data.id);
          clearTimeout(request.timer);
          if (data.error) request.reject(new Error(data.error));
          else request.resolve(data.suggestions);
          return;
        }
        if (data.id !== id || revision !== this.revision || this.view.state.doc !== doc) return;
        this.error = data.error || '';
        this.issues = data.issues || [];
        this.decorations = Decoration.set(
          this.issues.map((issue) =>
            Decoration.mark({
              class: 'cm-spelling-error',
              attributes: {
                title: `Spelling: ${issue.word} · use Spelling suggestions from the command palette`,
              },
            }).range(issue.from, issue.to),
          ),
        );
        this.view.requestMeasure();
        // An empty transaction lets CodeMirror draw the asynchronously produced decorations.
        this.view.dispatch({});
      };
      worker.postMessage({
        id,
        type: 'check',
        text: doc.toString(),
        comments: options.comments,
        dictionary: options.dictionary,
      });
    }
    suggest(word: string): Promise<string[]> {
      if (!this.worker)
        return Promise.reject(new Error(this.error || 'Spell checker is still loading.'));
      const id = ++this.id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Spelling suggestions timed out.'));
        }, 5000);
        this.pending.set(id, { resolve, reject, timer });
        this.worker!.postMessage({ id, type: 'suggest', word });
      });
    }
    stop() {
      this.worker?.terminate();
      this.worker = undefined;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Spell checking stopped.'));
      }
      this.pending.clear();
    }
    destroy() {
      clearTimeout(this.timer);
      this.stop();
    }
  },
  { decorations: (value) => value.decorations },
);

export let personalDictionary: string[] = [];
export function setPersonalDictionary(words: string[]) {
  personalDictionary = words;
}
