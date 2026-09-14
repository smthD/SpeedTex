import { delimiterPresets, type HighlightSettings } from './delimiter-highlighting.ts';
import { defaultTermRules, type TermRules } from './terms.ts';
import { defaultColors, colorRoles, validColor, type Colors } from './appearance.ts';
import { defaultSnippets, safeRegex, type Snippet } from './snippets.ts';
export interface Binding {
  command: string;
  key: string;
  context: 'everywhere' | 'math' | 'text';
}
export interface Settings extends Colors, TermRules {
  theme: 'dark';
  delimiterHighlight: HighlightSettings;
  fontSize: number;
  lineHeight: number;
  lineNumbers: boolean;
  wordWrap: boolean;
  spellCheck: boolean;
  spellComments: boolean;
  spellDisabledFiles: string[];
  autoPairs: boolean;
  smartScripts: boolean;
  autoSnippets: boolean;
  completion: boolean;
  completionLimit: number;
  autoSave: boolean;
  buildOnSave: boolean;
  liveDelay: number;
  liveMode: 'accurate' | 'fast';
  compiler: string;
  buildArgs: string[];
  rootFile: string;
}
export interface Macro {
  id: string;
  name: string;
  steps: ({ command: string } | { insert: string })[];
}
export interface Config {
  version: 1;
  keybindingDefaultsVersion?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  settings: Settings;
  snippets: Snippet[];
  keybindings: Binding[];
  macros: Macro[];
}
export const defaultBindings: Binding[] = [
  ['sourceToPdf', 'Mod-Shift-j'],
  ['nextSpelling', 'F7'],
  ['spellingSuggestions', 'Shift-F7'],
  ['quickOpen', 'Mod-p'],
  ['palette', 'Mod-Shift-p'],
  ['save', 'Mod-s'],
  ['openProject', 'Mod-o'],
  ['build', 'Mod-Enter'],
  ['togglePreview', 'Mod-Shift-v'],
  ['symbols', 'Mod-Shift-o'],
  ['nextArgument', 'Alt-f', 'math'],
  ['previousArgument', 'Alt-a', 'math'],
  ['nextPosition', 'Alt-d'],
  ['previousPosition', 'Alt-s'],
  ['nextTerm', 'Alt-e'],
  ['previousTerm', 'Alt-w'],
  ['lineEnd', 'Alt-r'],
  ['lineStart', 'Alt-q'],
  ['selectTerm', 'Alt-p'],
  ['cutTerm', 'Alt-o'],
  ['cutBraces', 'Alt-i'],
  ['pasteClipboard', 'Alt-l'],
  ['matching', 'Mod-Shift-m'],
  ['nextCommand', 'Alt-ArrowDown'],
  ['previousCommand', 'Alt-ArrowUp'],
  ['nextFile', 'Ctrl-Tab'],
  ['previousFile', 'Ctrl-Shift-Tab'],
  ['reopen', 'Mod-Shift-t'],
  ['closeFile', 'Mod-w'],
  ['search', 'Mod-f'],
  ['projectSearch', 'Mod-Shift-f'],
  ['snippets', 'Mod-Alt-s'],
  ['settings', 'Mod-,'],
  ['toggleSidebar', 'Mod-b'],
  ['toggleSnippets', 'Mod-Alt-e'],
  ['nextPlaceholder', 'Tab'],
  ['previousPlaceholder', 'Shift-Tab'],
  ['selectNext', 'Mod-d'],
  ['selectAllMatches', 'Mod-Shift-l'],
].map(([command, key, context]) => ({
  command,
  key,
  context: (context || 'everywhere') as Binding['context'],
}));
export function defaults(): Config {
  return structuredClone({
    version: 1,
    keybindingDefaultsVersion: 7,
    settings: {
      theme: 'dark',
      delimiterHighlight: delimiterPresets.Prism,
      ...defaultColors,
      ...defaultTermRules,
      fontSize: 15,
      lineHeight: 1.85,
      lineNumbers: true,
      wordWrap: true,
      spellCheck: true,
      spellComments: false,
      spellDisabledFiles: [],
      autoPairs: true,
      smartScripts: true,
      autoSnippets: true,
      completion: true,
      completionLimit: 20,
      autoSave: false,
      buildOnSave: false,
      liveDelay: 350,
      liveMode: 'accurate',
      compiler: 'latexmk',
      buildArgs: [
        '-pdf',
        '-interaction=nonstopmode',
        '-file-line-error',
        '-synctex=1',
        '-no-shell-escape',
      ],
      rootFile: 'main.tex',
    },
    snippets: defaultSnippets,
    keybindings: defaultBindings,
    macros: [],
  });
}
export function validateConfig(value: unknown): Config {
  if (!value || typeof value !== 'object') throw new Error('Configuration must be a JSON object.');
  const c = value as Config;
  const d = defaults();
  if (c.version !== 1) throw new Error('Unsupported configuration version. Expected 1.');
  const s = { ...d.settings, ...c.settings };
  if (typeof s.termWhitespace !== 'boolean') throw new Error('termWhitespace must be a boolean.');
  if (
    !Array.isArray(s.termSeparators) ||
    s.termSeparators.length > 64 ||
    s.termSeparators.some(
      (t) => typeof t !== 'string' || !t.trim() || t.length > 80 || /[\r\n]/.test(t),
    )
  )
    throw new Error(
      'Term boundaries must be up to 64 nonempty literal strings (80 characters each, no line breaks).',
    );
  s.termSeparators = [...new Set(s.termSeparators)];
  if (
    !Array.isArray(s.spellDisabledFiles) ||
    s.spellDisabledFiles.length > 10000 ||
    s.spellDisabledFiles.some((p) => typeof p !== 'string' || p.length > 1024)
  )
    throw new Error('spellDisabledFiles must be a list of file paths.');
  const h = { ...delimiterPresets.Prism, ...s.delimiterHighlight };
  if (
    !['depth', 'kind', 'focus'].includes(h.mode) ||
    !['outline', 'fill', 'underline'].includes(h.activeStyle) ||
    !Array.isArray(h.colors) ||
    h.colors.length < 1 ||
    h.colors.length > 12 ||
    h.colors.some((c) => !validColor(c)) ||
    !validColor(h.activeColor) ||
    !validColor(h.errorColor) ||
    ['enabled', 'showErrors', 'highlightScope', 'environments'].some(
      (k) => typeof h[k as keyof HighlightSettings] !== 'boolean',
    )
  )
    throw new Error('Invalid delimiter highlighting settings.');
  s.delimiterHighlight = h;
  // Legacy light profiles migrate without losing their other settings.
  if (!['dark', 'light'].includes(s.theme)) throw new Error('Unsupported theme.');
  s.theme = 'dark';
  for (const key of Object.keys(colorRoles) as (keyof Colors)[])
    if (!validColor(s[key])) throw new Error(`${key} must be a six-digit hex color.`);
  for (const [k, min, max] of [
    ['fontSize', 10, 32],
    ['liveDelay', 100, 2000],
    ['lineHeight', 1, 3],
    ['completionLimit', 1, 100],
  ] as const)
    if (typeof s[k] !== 'number' || !Number.isFinite(s[k]) || s[k] < min || s[k] > max)
      throw new Error(`Invalid ${k}.`);
  for (const k of [
    'lineNumbers',
    'wordWrap',
    'spellCheck',
    'spellComments',
    'autoPairs',
    'smartScripts',
    'autoSnippets',
    'completion',
    'autoSave',
    'buildOnSave',
  ] as const)
    if (typeof s[k] !== 'boolean') throw new Error(`${k} must be boolean.`);
  if (
    typeof s.compiler !== 'string' ||
    !s.compiler.trim() ||
    !Array.isArray(s.buildArgs) ||
    s.buildArgs.some((x) => typeof x !== 'string') ||
    typeof s.rootFile !== 'string'
  )
    throw new Error('Invalid compiler configuration.');
  if (!Array.isArray(c.snippets) || !Array.isArray(c.keybindings))
    throw new Error('Snippets and keybindings must be arrays.');
  if (!['accurate', 'fast'].includes(s.liveMode)) throw new Error('Invalid live preview mode');
  const ids = new Set<string>();
  for (const n of c.snippets) {
    if (
      typeof n.id !== 'string' ||
      !n.id ||
      ids.has(n.id) ||
      typeof n.name !== 'string' ||
      typeof n.trigger !== 'string' ||
      !n.trigger ||
      typeof n.replacement !== 'string' ||
      typeof n.group !== 'string' ||
      !['math', 'text', 'everywhere'].includes(n.context) ||
      !['literal', 'regex'].includes(n.kind) ||
      !Number.isFinite(n.priority)
    )
      throw new Error('Invalid or duplicate snippet.');
    ids.add(n.id);
    for (const k of ['enabled', 'auto', 'retainTrigger', 'recursive'] as const)
      if (typeof n[k] !== 'boolean') throw new Error(`Invalid snippet ${k}.`);
    if (n.kind === 'regex') safeRegex(n.trigger);
    for (const k of ['environment', 'argument', 'afterCharacters'] as const)
      if (n[k] !== undefined && typeof n[k] !== 'string') throw new Error(`Invalid ${k}.`);
  }
  for (const b of c.keybindings)
    if (
      typeof b.command !== 'string' ||
      typeof b.key !== 'string' ||
      !b.key.trim() ||
      !['math', 'text', 'everywhere'].includes(b.context)
    )
      throw new Error('Invalid keybinding.');
  if (
    c.macros !== undefined &&
    (!Array.isArray(c.macros) ||
      c.macros.some(
        (m) =>
          typeof m.id !== 'string' ||
          typeof m.name !== 'string' ||
          !Array.isArray(m.steps) ||
          m.steps.length > 50 ||
          m.steps.some(
            (step) =>
              !('command' in step
                ? typeof step.command === 'string'
                : 'insert' in step && typeof step.insert === 'string'),
          ),
      ))
  )
    throw new Error('Invalid macro.');
  if (
    c.keybindingDefaultsVersion !== undefined &&
    ![1, 2, 3, 4, 5, 6, 7].includes(c.keybindingDefaultsVersion)
  )
    throw new Error('Unsupported keybinding defaults version.');
  // Upgrade only the original default shortcut. Explicitly customized keys and
  // configurations saved with the new defaults retain their chosen behavior.
  let keybindings = c.keybindings.map((binding) => {
    const version = c.keybindingDefaultsVersion ?? 1;
    if (binding.context === 'everywhere') {
      if (version < 2 && binding.command === 'outside' && binding.key === 'Alt-ArrowRight')
        return { ...binding, command: 'nextPosition' };
      if (version < 3 && binding.command === 'inside' && binding.key === 'Alt-ArrowLeft')
        return { ...binding, command: 'previousPosition' };
    }
    return { ...binding };
  });
  if ((c.keybindingDefaultsVersion ?? 1) < 4) {
    // Upgrade the old argument defaults only when the new shortcut is free.
    // Existing Alt+A/F and all custom local brace bindings stay intact.
    for (const [command, oldKey, newKey] of [
      ['nextArgument', 'Ctrl-f', 'Alt-f'],
      ['previousArgument', 'Ctrl-Shift-f', 'Alt-a'],
    ]) {
      const binding = keybindings.find(
        (b) => b.command === command && b.key === oldKey && b.context === 'math',
      );
      if (binding && !keybindings.some((b) => b.key.toLowerCase() === newKey.toLowerCase()))
        binding.key = newKey;
    }
    for (const binding of defaultBindings.filter((b) =>
      ['nextTerm', 'previousTerm', 'lineStart', 'lineEnd'].includes(b.command),
    )) {
      if (
        !keybindings.some(
          (b) => b.command === binding.command || b.key.toLowerCase() === binding.key.toLowerCase(),
        )
      )
        keybindings.push({ ...binding });
    }
  }
  if ((c.keybindingDefaultsVersion ?? 1) < 5) {
    // These four keys are explicitly reassigned by the editing command layout,
    // including the formerly customized Alt+P math-end binding.
    const editing = defaultBindings.filter((b) =>
      ['selectTerm', 'cutTerm', 'cutBraces', 'pasteClipboard'].includes(b.command),
    );
    const keys = new Set(editing.map((b) => b.key.toLowerCase()));
    keybindings = keybindings.filter((b) => !keys.has(b.key.toLowerCase()));
    keybindings.push(...editing.map((b) => ({ ...b })));
  }
  if ((c.keybindingDefaultsVersion ?? 1) < 6) {
    for (const binding of defaultBindings.filter((b) =>
      ['nextSpelling', 'spellingSuggestions'].includes(b.command),
    )) {
      if (
        !keybindings.some(
          (b) => b.command === binding.command || b.key.toLowerCase() === binding.key.toLowerCase(),
        )
      )
        keybindings.push({ ...binding });
    }
  }
  if ((c.keybindingDefaultsVersion ?? 1) < 7) {
    const binding = defaultBindings.find((b) => b.command === 'sourceToPdf')!;
    if (
      !keybindings.some(
        (b) =>
          b.command === binding.command ||
          normalizedKey(b.key).toLowerCase() === normalizedKey(binding.key).toLowerCase(),
      )
    )
      keybindings.push({ ...binding });
  }
  return {
    ...d,
    ...c,
    keybindingDefaultsVersion: 7,
    keybindings,
    settings: s,
    macros: c.macros || [],
  };
}
export function bindingConflicts(bindings: Binding[]) {
  return bindings.flatMap((a, i) =>
    bindings
      .slice(i + 1)
      .filter(
        (b) =>
          normalizedKey(a.key).toLowerCase() === normalizedKey(b.key).toLowerCase() &&
          (a.context === b.context || a.context === 'everywhere' || b.context === 'everywhere'),
      )
      .map((b) => `${a.key}: ${a.command} / ${b.command}`),
  );
}
export function eventKey(e: KeyboardEvent, mac = false) {
  const mods: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push('Mod');
  if (mac && e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  let key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return [...mods, key].join('-');
}
export function normalizedKey(key: string, mac = false) {
  return key
    .split(' ')
    .map((k) => k.replace(mac ? /Meta-/g : /Ctrl-/g, 'Mod-'))
    .join(' ');
}
export class KeybindingResolver {
  private prefix = '';
  private expires = 0;
  resolve(key: string, mode: 'math' | 'text', bindings: Binding[], now = Date.now(), mac = false) {
    if (now > this.expires) this.prefix = '';
    const sequence = this.prefix ? this.prefix + ' ' + key : key;
    const valid = bindings
      .filter((b) => b.context === 'everywhere' || b.context === mode)
      .sort((a, b) => Number(b.context !== 'everywhere') - Number(a.context !== 'everywhere'));
    const match = valid.find((b) => normalizedKey(b.key, mac) === sequence);
    if (match) {
      this.prefix = '';
      return { command: match.command, pending: false };
    }
    if (valid.some((b) => normalizedKey(b.key, mac).startsWith(sequence + ' '))) {
      this.prefix = sequence;
      this.expires = now + 1500;
      return { pending: true };
    }
    this.prefix = '';
    return { pending: false };
  }
}
