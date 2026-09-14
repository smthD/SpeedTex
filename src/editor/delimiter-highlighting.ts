import { Facet } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  type EditorView,
} from '@codemirror/view';
import {
  activeDelimiterPairs,
  delimiterPresets,
  type DelimiterIndex,
  type HighlightSettings,
} from '../core/delimiter-highlighting';
export const delimiterOptions = Facet.define<HighlightSettings, HighlightSettings>({
  combine: (values) => values[0] || delimiterPresets.Prism,
});
export const delimiterHighlighting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    private index: DelimiterIndex = { tokens: [], pairs: [] };
    private worker?: Worker;
    private timer?: ReturnType<typeof setTimeout>;
    private revision = 0;
    constructor(readonly view: EditorView) {
      this.schedule();
    }
    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.index = { tokens: [], pairs: [] };
        this.decorations = Decoration.none;
        this.schedule();
      } else if (
        update.startState.facet(delimiterOptions) !== update.state.facet(delimiterOptions)
      ) {
        this.schedule();
        this.draw();
      } else if (update.selectionSet || update.viewportChanged) this.draw();
    }
    schedule() {
      clearTimeout(this.timer);
      const id = ++this.revision;
      if (!this.view.state.facet(delimiterOptions).enabled) {
        this.worker?.terminate();
        this.worker = undefined;
        this.decorations = Decoration.none;
        return;
      }
      this.timer = setTimeout(() => {
        if (!this.worker) {
          this.worker = new Worker(new URL('../services/delimiters.worker.ts', import.meta.url), {
            type: 'module',
          });
          this.worker.onmessage = ({ data }) => {
            if (data.id !== this.revision) return;
            this.index = data.index;
            this.draw();
            this.view.dispatch({});
          };
        }
        this.worker.postMessage({ id, text: this.view.state.doc.toString() });
      }, 80);
    }
    draw() {
      const settings = this.view.state.facet(delimiterOptions);
      if (!settings.enabled) {
        this.decorations = Decoration.none;
        return;
      }
      const active = activeDelimiterPairs(
        this.index,
        this.view.state.selection.ranges.map((r) => r.head),
      );
      if (!settings.environments)
        for (const n of active) if (this.index.pairs[n].kind === 'environment') active.delete(n);
      const ranges: ReturnType<ReturnType<typeof Decoration.mark>['range']>[] = [];
      if (settings.highlightScope)
        for (const n of active) {
          const pair = this.index.pairs[n],
            a = this.index.tokens[pair.open],
            b = this.index.tokens[pair.close];
          for (const visible of this.view.visibleRanges) {
            const from = Math.max(a.to, visible.from),
              to = Math.min(b.from, visible.to);
            if (to > from)
              ranges.push(
                Decoration.mark({
                  class: 'cm-latex-scope',
                  attributes: { style: `background-color:${settings.activeColor}0c` },
                }).range(from, to),
              );
          }
        }
      for (const token of this.index.tokens) {
        if (token.kind === 'environment' && !settings.environments) continue;
        if (!this.view.visibleRanges.some((r) => token.to > r.from && token.from < r.to)) continue;
        const focused = token.pair !== undefined && active.has(token.pair);
        if (settings.mode === 'focus' && !focused && !(settings.showErrors && token.error))
          continue;
        const kind = [
          'brace',
          'paren',
          'bracket',
          'sized',
          'math',
          'environment',
          'symbol',
        ].indexOf(token.pair === undefined ? token.kind : this.index.pairs[token.pair].kind);
        const color =
          token.error && settings.showErrors
            ? settings.errorColor
            : settings.colors[
                (settings.mode === 'kind' ? Math.max(0, kind) : token.depth) %
                  settings.colors.length
              ];
        let title = token.error ? 'Unmatched delimiter' : `Nesting level ${token.depth + 1}`;
        if (token.pair !== undefined) {
          const pair = this.index.pairs[token.pair];
          const other =
            this.index.tokens[this.index.tokens[pair.open] === token ? pair.close : pair.open];
          const line = this.view.state.doc.lineAt(other.from);
          title = `Matching delimiter: line ${line.number}, column ${other.from - line.from + 1}`;
        }
        ranges.push(
          Decoration.mark({
            class: `cm-latex-delimiter${focused ? ' cm-latex-active cm-latex-' + settings.activeStyle : ''}${token.error && settings.showErrors ? ' cm-latex-unmatched' : ''}`,
            attributes: {
              style: `--delimiter-color:${color};--delimiter-active:${settings.activeColor};--delimiter-fill:${settings.activeColor}24`,
              title,
            },
          }).range(token.from, token.to),
        );
      }
      this.decorations = Decoration.set(ranges, true);
    }
    destroy() {
      clearTimeout(this.timer);
      this.worker?.terminate();
    }
  },
  { decorations: (value) => value.decorations },
);
