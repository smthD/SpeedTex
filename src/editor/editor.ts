import { delimiterHighlighting, delimiterOptions } from './delimiter-highlighting';
import { spellOptions, spellPlugin, personalDictionary } from './spelling';
import { selectTermLeft, leftTermCut, braceContent, mergeRanges } from '../core/editing';
import {
  EditorState,
  EditorSelection,
  StateEffect,
  StateField,
  Compartment,
  Prec,
} from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
} from '@codemirror/view';
import {
  history,
  isolateHistory,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
  insertTab,
  undo,
  redo,
} from '@codemirror/commands';
import {
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
  selectSelectionMatches,
  selectNextOccurrence,
} from '@codemirror/search';
import {
  StreamLanguage,
  syntaxHighlighting,
  HighlightStyle,
  indentOnInput,
} from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import {
  autocompletion,
  completionKeymap,
  startCompletion,
  acceptCompletion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import { ContextIndex } from '../core/context';
import { matchSnippet, parseTemplate, type Stop } from '../core/snippets';
import { delimiterInput, delimiterBackspace } from '../core/delimiters';
import { navigate, type Movement } from '../core/navigation';
import { type Config, KeybindingResolver, eventKey } from '../core/config';
import type { SymbolEntry } from '../core/indexer';
interface Session {
  stops: Stop[];
  index: number;
}
const pushSession = StateEffect.define<Session>(),
  setSessions = StateEffect.define<Session[]>();
const sessions = StateField.define<Session[]>({
  create: () => [],
  update(value, tr) {
    if (tr.isUserEvent('undo') || tr.isUserEvent('redo')) return [];
    let next = value.map((s) => ({
      ...s,
      stops: s.stops.map((p) => ({
        ...p,
        from: tr.changes.mapPos(p.from, -1),
        to: tr.changes.mapPos(p.to, 1),
      })),
    }));
    for (const e of tr.effects) {
      if (e.is(pushSession)) next = [...next, e.value];
      if (e.is(setSessions)) next = e.value;
    }
    if (tr.selection && !tr.docChanged && !tr.effects.length) {
      const p = tr.newSelection.main.head;
      if (!next.some((s) => s.stops.some((x) => p >= x.from && p <= x.to))) next = [];
    }
    return next;
  },
});
const palette = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: tags.name, color: 'var(--syntax-command)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.bracket, color: 'var(--secondary-accent)' },
  { tag: tags.meta, color: 'var(--syntax-command)' },
]);
const readOnly = new Compartment();
const appearance = new Compartment();
const completions = new Compartment();
const wrapping = new Compartment();
const spelling = new Compartment();
const delimiters = new Compartment();
function theme(c: Config) {
  return [
    c.settings.lineNumbers ? lineNumbers() : [],
    EditorView.theme(
      {
        '&': {
          fontSize: c.settings.fontSize + 'px',
          height: '100%',
          backgroundColor: 'var(--editor)',
          color: 'var(--text)',
        },
        '.cm-content': {
          fontFamily: 'var(--font-mono)',
          padding: '20px 0 200px',
          caretColor: 'var(--cursor)',
        },
        '.cm-line': { padding: '0 24px', lineHeight: String(c.settings.lineHeight) },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-gutters': {
          backgroundColor: 'var(--editor)',
          color: 'var(--muted)',
          border: 'none',
          padding: '0',
          minWidth: '53px',
        },
        '.cm-lineNumbers .cm-gutterElement': {
          padding: '0 10px 0 18px',
          lineHeight: String(c.settings.lineHeight),
        },
        '.cm-activeLineGutter': { color: 'var(--accent)', backgroundColor: 'transparent' },
        '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
        '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,::selection': {
          backgroundColor: 'var(--selection)',
        },
        '.cm-cursor': { borderLeftColor: 'var(--cursor)' },
        '.cm-tooltip': {
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
        },
        '.cm-tooltip-autocomplete ul li[aria-selected]': {
          backgroundColor: 'var(--selected)',
          color: 'var(--text)',
        },
        '.cm-search': { backgroundColor: 'var(--surface)', padding: '10px' },
        '.cm-textfield': {
          backgroundColor: 'var(--editor)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
        },
        '.cm-panels': {
          backgroundColor: 'var(--surface)',
          color: 'var(--text)',
          borderColor: 'var(--border)',
        },
      },
      { dark: c.settings.theme === 'dark' },
    ),
  ];
}
const commands = [
  'pdv',
  'dv',
  'dd',
  'vb',
  'va',
  'grad',
  'div',
  'curl',
  'bra',
  'ket',
  'braket',
  'expval',
  'comm',
  'Tr',
  'norm',
  'abs',
  'qty',
  'hat',
  'forall',
  'exists',
  'subseteq',
  'setminus',
  'cup',
  'cap',
  'bigcup',
  'overline',
  'neg',
  'land',
  'lor',
  'iff',
  'leq',
  'geq',
  'mid',
  'in',
  'lVert',
  'rVert',
  'hbar',
  'frac',
  'sqrt',
  'sin',
  'cos',
  'tan',
  'log',
  'ln',
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'varepsilon',
  'theta',
  'lambda',
  'pi',
  'sigma',
  'omega',
  'sum',
  'int',
  'lim',
  'infty',
  'partial',
  'nabla',
  'rightarrow',
  'implies',
  'mathbb',
  'mathbf',
  'mathrm',
  'text',
  'begin',
  'end',
  'section',
  'subsection',
  'label',
  'ref',
  'eqref',
  'cite',
  'input',
  'include',
  'usepackage',
  'newcommand',
  'left',
  'right',
];
const environments = [
  'equation',
  'equation*',
  'align',
  'align*',
  'gather',
  'matrix',
  'pmatrix',
  'bmatrix',
  'cases',
  'itemize',
  'enumerate',
  'theorem',
  'proof',
  'figure',
  'table',
];
export class WritingEditor {
  view: EditorView;
  context = new ContextIndex();
  resolver = new KeybindingResolver();
  private contextDoc: unknown;
  spellFile = '@practice';
  spelling() {
    return this.view.plugin(spellPlugin);
  }
  private spellSettings() {
    const s = this.config().settings;
    return {
      enabled:
        s.spellCheck &&
        !s.spellDisabledFiles.includes(this.spellFile) &&
        (this.spellFile === '@practice' || /\.(tex|txt|md)$/i.test(this.spellFile)),
      comments: s.spellComments,
      dictionary: personalDictionary,
    };
  }
  private onChange: (text: string) => void;
  constructor(
    parent: HTMLElement,
    private config: () => Config,
    private symbols: () => SymbolEntry[],
    private files: () => string[],
    private run: (id: string) => boolean,
    onChange: (text: string) => void,
    private onCursor: () => void,
  ) {
    this.onChange = onChange;
    this.view = new EditorView({ parent, state: this.state('') });
  }
  private syncContext() {
    if (this.contextDoc !== this.view.state.doc) {
      this.context.update(this.view.state.doc.toString());
      this.contextDoc = this.view.state.doc;
    }
  }
  mode() {
    this.syncContext();
    return this.context.at(this.view.state.selection.main.head);
  }
  state(text: string) {
    return EditorState.create({
      doc: text,
      extensions: [
        readOnly.of(EditorState.readOnly.of(false)),
        sessions,
        spellPlugin,
        spelling.of(spellOptions.of(this.spellSettings())),
        history(),
        drawSelection(),
        rectangularSelection(),
        crosshairCursor(),
        highlightSpecialChars(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        delimiterHighlighting,
        delimiters.of(delimiterOptions.of(this.config().settings.delimiterHighlight)),
        indentOnInput(),
        StreamLanguage.define(stex),
        syntaxHighlighting(palette),
        EditorState.allowMultipleSelections.of(true),
        appearance.of(theme(this.config())),
        wrapping.of(this.config().settings.wordWrap ? EditorView.lineWrapping : []),
        Prec.highest(
          EditorView.domEventHandlers({
            contextmenu: (event, view) => {
              const element = event.target as HTMLElement;
              if (!element.closest('.cm-spelling-error')) return false;
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              event.preventDefault();
              view.dispatch({ selection: { anchor: pos } });
              this.run('spellingSuggestions');
              return true;
            },
            keydown: (e) => {
              const key = eventKey(e, /Mac/.test(navigator.platform));
              const r = this.resolver.resolve(
                key,
                this.mode().mode,
                this.config().keybindings,
                Date.now(),
                /Mac/.test(navigator.platform),
              );
              if (r.pending) {
                e.preventDefault();
                return true;
              }
              if (r.command) {
                const handled = this.run(r.command);
                if (handled) e.preventDefault();
                return handled;
              }
              if (e.key === 'Escape' && this.view.state.field(sessions).length) {
                this.view.dispatch({ effects: setSessions.of([]) });
                return true;
              }
              if (e.key === 'Backspace') return this.backspace();
              return false;
            },
          }),
        ),
        EditorView.inputHandler.of((v, from, to, text) => this.input(from, to, text)),
        completions.of(this.completionExtension()),
        keymap.of([
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            let from = u.state.doc.length;
            u.changes.iterChangedRanges((a) => {
              from = Math.min(from, a);
            });
            this.context.update(u.state.doc.toString(), from);
            this.contextDoc = u.state.doc;
            this.onChange(u.state.doc.toString());
          }
          if (u.selectionSet || u.docChanged) this.onCursor();
        }),
      ],
    });
  }
  load(state: EditorState) {
    this.view.setState(state);
    this.contextDoc = null;
    this.view.focus();
    this.onCursor();
  }
  private completionExtension() {
    return autocompletion({
      override: [(c) => this.complete(c)],
      activateOnTyping: this.config().settings.completion,
      maxRenderedOptions: this.config().settings.completionLimit,
    });
  }
  lock(locked: boolean) {
    this.view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(locked)) });
  }
  configure() {
    this.view.dispatch({
      effects: [
        appearance.reconfigure(theme(this.config())),
        wrapping.reconfigure(this.config().settings.wordWrap ? EditorView.lineWrapping : []),
        completions.reconfigure(this.completionExtension()),
        spelling.reconfigure(spellOptions.of(this.spellSettings())),
        delimiters.reconfigure(delimiterOptions.of(this.config().settings.delimiterHighlight)),
      ],
    });
  }
  private complete(c: CompletionContext) {
    const prefix = c.state.sliceDoc(Math.max(0, c.pos - 300), c.pos);
    const argument = /\\([a-zA-Z]+)\{([^{}]*)$/.exec(prefix);
    let options: { label: string; detail?: string; type?: string }[] = [];
    let from = c.pos;
    if (argument) {
      const q = argument[2].split(',').at(-1)!;
      from = c.pos - q.length;
      const name = argument[1];
      if (['ref', 'eqref', 'autoref', 'pageref', 'cref', 'Cref'].includes(name))
        options = this.symbols()
          .filter((s) => s.kind === 'label')
          .map((s) => ({ label: s.name, detail: s.path, type: 'constant' }));
      else if (/cite/i.test(name))
        options = this.symbols()
          .filter((s) => s.kind === 'citation')
          .map((s) => ({ label: s.name, detail: s.detail, type: 'text' }));
      else if (['begin', 'end'].includes(name))
        options = [
          ...environments,
          ...this.symbols()
            .filter((s) => s.kind === 'environment')
            .map((s) => s.name),
        ].map((label) => ({ label, type: 'class' }));
      else if (['input', 'include', 'includegraphics', 'bibliography'].includes(name))
        options = this.files().map((label) => ({ label, type: 'text' }));
      else if (name === 'usepackage')
        options = [
          'physics',
          'amsmath',
          'amssymb',
          'amsthm',
          'geometry',
          'hyperref',
          'graphicx',
          'biblatex',
          'mathtools',
          'tikz',
          'xcolor',
        ].map((label) => ({ label, type: 'module' }));
    }
    if (!options.length) {
      const m = c.matchBefore(/\\[a-zA-Z@]*/);
      if (!m || this.mode().comment) return null;
      from = m.from;
      options = [
        ...commands.map((x) => '\\' + x),
        ...this.symbols()
          .filter((s) => s.kind === 'command')
          .map((s) => s.name),
      ].map((label) => ({ label, type: 'function' }));
    }
    return {
      from,
      options: [...new Map(options.map((o) => [o.label, o])).values()],
      validFor: /^[\w@:\-./]*$/,
    };
  }
  private input(from: number, to: number, text: string) {
    if (this.view.state.selection.ranges.length > 1) return false;
    const c = this.config();
    this.syncContext();
    const context = this.context.at(from);
    const doc = this.view.state.doc;
    const prefix = doc.sliceString(0, from) + text;
    if (c.settings.autoSnippets && text.length === 1) {
      const match = matchSnippet(prefix, context, c.snippets, true);
      if (match) {
        this.expand(match.from, to, match.text, match.stops);
        if (match.snippet.recursive) {
          for (let depth = 0; depth < 8; depth++) {
            const pos = this.view.state.selection.main.head;
            const next = matchSnippet(
              this.view.state.sliceDoc(0, pos),
              this.mode(),
              c.snippets,
              true,
            );
            if (!next) break;
            this.expand(next.from, pos, next.text, next.stops);
            if (!next.snippet.recursive) break;
          }
        }
        return true;
      }
    }
    if (
      c.settings.smartScripts &&
      context.mode === 'math' &&
      !context.comment &&
      ['_', '^'].includes(text)
    ) {
      const selected = doc.sliceString(from, to);
      this.expand(from, to, text + '{' + selected + '}', [
        { number: 1, from: 2, to: 2 + selected.length },
        { number: 0, from: selected.length + 3, to: selected.length + 3 },
      ]);
      return true;
    }
    if (c.settings.autoPairs && !context.comment) {
      const edit = delimiterInput(doc.toString(), from, to, text);
      if (edit) {
        this.view.dispatch({
          changes: { from: edit.from, to: edit.to, insert: edit.insert },
          selection: { anchor: edit.anchor, head: edit.head },
        });
        return true;
      }
    }
    return false;
  }
  private backspace() {
    const { from, to } = this.view.state.selection.main;
    if (from !== to || !this.config().settings.autoPairs) return false;
    const edit = delimiterBackspace(this.view.state.doc.toString(), from);
    if (!edit) return false;
    this.view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: { anchor: edit.anchor },
    });
    return true;
  }
  expand(from: number, to: number, text: string, stops: Stop[]) {
    const absolute = stops.map((s) => ({ ...s, from: s.from + from, to: s.to + from }));
    const first = absolute[0];
    const isOnlyFinal = absolute.length === 1 && first.number === 0;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: first.from, head: first.to },
      effects: isOnlyFinal ? [] : pushSession.of({ stops: absolute, index: 0 }),
      userEvent: 'input.snippet',
    });
  }
  insertTemplate(template: string) {
    const parsed = parseTemplate(template);
    const s = this.view.state.selection.main;
    this.expand(s.from, s.to, parsed.text, parsed.stops);
    this.view.focus();
  }
  placeholder(direction = 1): boolean {
    const stack = this.view.state.field(sessions);
    if (!stack.length) {
      if (direction < 0) return false;
      if (acceptCompletion(this.view)) return true;
      const pos = this.view.state.selection.main.head;
      const match = matchSnippet(
        this.view.state.sliceDoc(0, pos),
        this.mode(),
        this.config().snippets,
        false,
      );
      if (match) {
        this.expand(match.from, pos, match.text, match.stops);
        return true;
      }
      return insertTab(this.view);
    }
    const next = stack.map((s) => ({ ...s }));
    const session = next.at(-1)!;
    session.index += direction;
    if (session.index < 0) session.index = 0;
    if (session.index >= session.stops.length) {
      next.pop();
      this.view.dispatch({ effects: setSessions.of(next) });
      return this.placeholder(direction);
    }
    const stop = session.stops[session.index];
    if (stop.number === 0) next.pop();
    this.view.dispatch({
      selection: { anchor: stop.from, head: stop.to },
      effects: setSessions.of(next),
      scrollIntoView: true,
    });
    return true;
  }
  move(action: Movement) {
    const text = this.view.state.doc.toString();
    const ranges = this.view.state.selection.ranges.map((s) =>
      EditorSelection.cursor(navigate(text, s.head, action, this.config().settings)),
    );
    this.view.dispatch({ selection: EditorSelection.create(ranges), scrollIntoView: true });
    return true;
  }
  wrap(command: string) {
    this.view.dispatch(
      this.view.state.changeByRange((range) => ({
        changes: {
          from: range.from,
          to: range.to,
          insert: command + '{' + this.view.state.sliceDoc(range.from, range.to) + '}',
        },
        range: EditorSelection.range(
          range.from + command.length + 1,
          range.to + command.length + 1,
        ),
      })),
    );
    this.view.focus();
    return true;
  }
  jump(pos: number) {
    pos = Math.min(Math.max(0, pos), this.view.state.doc.length);
    this.view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    this.view.focus();
  }
  selectTerm() {
    const state = this.view.state;
    const text = state.doc.toString();
    const ranges = state.selection.ranges.map((range) => {
      const target = selectTermLeft(text, range, this.config().settings);
      return EditorSelection.range(target.to, target.from);
    });
    this.view.dispatch({
      selection: EditorSelection.create(ranges, state.selection.mainIndex),
      scrollIntoView: true,
      userEvent: 'select',
    });
    return true;
  }
  async clipboardAction(
    action: 'cutTerm' | 'cutBraces' | 'pasteClipboard',
    clipboard: { readClipboard(): Promise<string>; writeClipboard(text: string): Promise<void> },
  ) {
    const state = this.view.state;
    if (state.readOnly) return true;
    const unchanged = () =>
      this.view.dom.isConnected &&
      !this.view.state.readOnly &&
      this.view.state.doc === state.doc &&
      this.view.state.selection.eq(state.selection);
    if (action === 'pasteClipboard') {
      const text = await clipboard.readClipboard();
      if (!text) return true;
      if (!unchanged())
        throw new Error('Cursor or document changed while reading clipboard; paste again.');
      this.view.dom.dispatchEvent(new Event('quill-paste'));
      this.view.dispatch({
        ...state.replaceSelection(text),
        effects: setSessions.of([]),
        scrollIntoView: true,
        userEvent: 'input.paste',
        annotations: isolateHistory.of('full'),
      });
    } else {
      const text = state.doc.toString();
      const hasSelection = state.selection.ranges.some((r) => !r.empty);
      const ranges = mergeRanges(
        state.selection.ranges.flatMap((r) => {
          if (action === 'cutBraces') {
            const inside = braceContent(text, r.head);
            return inside ? [inside] : [];
          }
          return hasSelection
            ? r.empty
              ? []
              : [{ from: r.from, to: r.to }]
            : [leftTermCut(text, r.head, this.config().settings)];
        }),
      );
      if (!ranges.length) return true;
      // Never delete unless the OS/browser confirms the clipboard write succeeded.
      await clipboard.writeClipboard(ranges.map((r) => text.slice(r.from, r.to)).join('\n'));
      if (!unchanged())
        throw new Error('Cursor or document changed while copying; text was copied but not cut.');
      const changes = state.changes(ranges.map((r) => ({ ...r, insert: '' })));
      this.view.dispatch({
        changes,
        selection: EditorSelection.create(
          ranges.map((r) => EditorSelection.cursor(changes.mapPos(r.from, -1))),
        ),
        effects: setSessions.of([]),
        scrollIntoView: true,
        userEvent: 'delete.cut',
        annotations: isolateHistory.of('full'),
      });
    }
    this.view.focus();
    return true;
  }
  action(id: string) {
    switch (id) {
      case 'nextPlaceholder':
        return this.placeholder();
      case 'previousPlaceholder':
        return this.placeholder(-1);
      case 'search':
        return openSearchPanel(this.view);
      case 'undo':
        return undo(this.view);
      case 'redo':
        return redo(this.view);
      case 'selectNext':
        return selectNextOccurrence(this.view);
      case 'selectAllMatches':
        return selectSelectionMatches(this.view);
      case 'complete':
        return startCompletion(this.view);
    }
    return false;
  }
}
