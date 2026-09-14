import { delimiterPresets } from './core/delimiter-highlighting';
import { spellingMenu } from './ui-spelling-menu';
import { dictionaryWords, wordKey } from './core/spelling';
import { setPersonalDictionary } from './editor/spelling';
import { PdfWorkspace } from './services/pdf-workspace';
import { PracticeWorkspace } from './practice/workspace';
import { applyAppearance } from './services/appearance';
import {
  colorRoles,
  defaultColors,
  accentPresets,
  validColor,
  type ColorKey,
} from './core/appearance';
import { LiveScheduler } from './core/live-scheduler';
import type { LiveResult } from './services/host';
import { PdfPreview } from './services/pdf-preview';
import './style.css';
import { EditorState } from '@codemirror/state';
import { WritingEditor } from './editor/editor';
import { defaults, validateConfig, bindingConflicts, type Config } from './core/config';
import { fuzzy, type SymbolEntry } from './core/indexer';
import type { Movement } from './core/navigation';
import type { Snippet } from './core/snippets';
import { host, native, demoFiles, type Project, type Recovery } from './services/host';
import { icon, escape as esc, button, download, upload } from './ui';
interface Tab {
  path: string;
  state: EditorState;
  version: string | null;
  saved: string;
  dirty: boolean;
  conflict: boolean;
}
interface Command {
  id: string;
  name: string;
  category: string;
  run: () => unknown;
}
let config = defaults(),
  project: Project = { name: 'Mathematical analysis', root: 'demo', entries: [] },
  active = '',
  tabs: Tab[] = [],
  closed: string[] = [],
  symbols: SymbolEntry[] = [],
  sidebarTab = 'files',
  collapsed = new Set<string>(),
  pinned = new Set<string>(),
  building = false,
  output = '',
  indexTimer: ReturnType<typeof setTimeout>,
  recoveryTimer: ReturnType<typeof setTimeout>,
  saveTimer: ReturnType<typeof setTimeout>;
let dictionaries = { global: [] as string[], project: [] as string[] };
const ignoredSpelling = new Set<string>();
let indexSequence = 0;
const indexed = new Map<string, SymbolEntry[]>(),
  versions = new Map<string, number>();
let recovery: Recovery[] = [];
const commands: Command[] = [];
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const app = $('#app');
app.innerHTML = `
<header class="topbar"><div class="brand"><span class="brand-mark">Q_</span><span>QUILL</span></div><button class="project-switch" data-command="openProject">${icon('folder', 15)}<span id="project-name">Mathematical analysis</span>${icon('down', 12)}</button><div class="top-actions">${button('palette', 'Command palette', 'search', 'icon-button')}<span class="keycap">Ctrl ⇧ P</span><span class="mode-badge">${native ? '0.2' : 'BROWSER'}</span></div></header>
<div class="workspace"><nav class="activity" aria-label="Workspace views"><button class="activity-button active" data-side="files" title="Project explorer">${icon('folder', 21)}</button><button class="activity-button" data-side="search" title="Search project">${icon('search', 21)}</button><button class="activity-button" data-side="outline" title="Document outline">${icon('book', 21)}</button><button class="activity-button" data-command="snippets" title="Snippet library">${icon('code', 21)}</button>${button('practice', 'Typing practice', 'practice', 'activity-button')}<div class="activity-bottom">${button('keyboard', 'Keyboard shortcuts', 'keyboard', 'icon-button')}${button('settings', 'Settings', 'settings', 'icon-button')}</div></nav>
<aside class="sidebar"><div class="sidebar-header"><span id="side-title">EXPLORER</span><div>${button('newFile', 'New file', 'plus', 'icon-button')}${button('openProject', 'Open project', 'folder', 'icon-button')}</div></div><div class="project-caption"><span class="project-dot"></span><strong id="folder-title">mathematical-analysis</strong></div><div id="side-content"></div></aside>
<main class="main"><div class="tabs-row"><div id="tabs" role="tablist"></div><div class="editor-actions"><button data-command="toggleLive" id="live-toggle" class="live-toggle" aria-pressed="false">Live off</button>${button('togglePreview', 'Toggle PDF preview', 'panel', 'icon-button')}${button('build', 'Build', 'play', 'build-button')}<span class="keycap">Ctrl ↵</span></div></div><div class="breadcrumb"><div><span id="breadcrumb-folder">mathematical-analysis</span>${icon('chevron', 11)}<span id="breadcrumb-file">main.tex</span></div><div class="breadcrumb-right"><button id="live-status" data-command="liveDetails" hidden></button><span class="tiny-dot"></span><span id="save-status">All changes saved</span></div></div><div class="writing-area"><div id="editor"></div><aside id="preview" hidden><div class="preview-header"><strong>PDF PREVIEW</strong><div>${button('detachPdf', 'Detach PDF window', 'panel', 'icon-button')}${button('refreshPdf', 'Refresh', 'refresh', 'icon-button')}${button('togglePreview', 'Close preview', 'close', 'icon-button')}</div></div><div id="pdf-content" class="pdf-content"><div class="preview-empty">${icon('file', 38)}<h3>No preview</h3><p>Compile to display the PDF.</p>${button('build', 'Build document', 'play', 'primary')}<small>${native ? 'Uses your local LaTeX installation.' : 'Compilation is available in the desktop app.'}</small></div></div></aside></div><section id="build-panel" hidden><div class="build-header"><span>${icon('terminal', 15)} BUILD OUTPUT <span id="build-result"></span></span><div>${button('cancelBuild', 'Stop', 'close', 'text-button')}${button('toggleBuild', 'Close output', 'close', 'icon-button')}</div></div><div id="diagnostics"></div><pre id="build-output"></pre></section></main></div>
<footer class="statusbar"><div><button data-command="symbols">${icon('code', 13)}<span id="status-mode">LaTeX</span></button><span class="status-separator"></span><span id="status-project">4 project files</span></div><div><button data-command="toggleSnippets"><span class="tiny-dot"></span><span id="snippet-status">Snippets on</span></button><span id="position">Ln 1, Col 1</span><button data-command="settings" id="profile-status">Default</button></div></footer><div id="toast" role="status"></div><dialog id="dialog"></dialog>`;
const editor = new WritingEditor(
  $('#editor'),
  () => config,
  () => symbols,
  () => project.entries.filter((e) => !e.directory).map((e) => e.path),
  run,
  (text) => changed(text),
  updateStatus,
);
const practice = new PracticeWorkspace(
  () => config,
  () => symbols,
  () => project.entries.filter((e) => !e.directory).map((e) => e.path),
  run,
  () => editor.view.focus(),
);
const commandEditor = () => (practice.isOpen ? practice.editor : editor);
$('#dialog').addEventListener('close', () => {
  if (!$<HTMLDialogElement>('#dialog').open) applyAppearance(config.settings);
});
const pdfPreview = new PdfPreview($('#pdf-content'), toast);
const pdfWorkspace = new PdfWorkspace($('#preview'), $('#pdf-content'), pdfPreview, run, toast);
pdfPreview.onPresented = (id) => {
  if (native) void host.retainSync(id).catch((error) => toast(error.message));
};
pdfPreview.onSync = (id, page, x, y) =>
  guard(async () => {
    const result = await host.syncInverse(id, page, x, y);
    if (pdfPreview.syncId !== id) return;
    const tab = tabs.find((t) => t.path === result.file);
    const text = tab
      ? active === result.file
        ? editor.view.state.doc.toString()
        : tab.state.doc.toString()
      : (await host.read(result.file)).text;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
      '',
    );
    if (hash !== result.hash)
      throw new Error(
        'Source changed since this PDF was built. Wait for live preview or rebuild before navigating.',
      );
    await openFile(result.file);
    const line = editor.view.state.doc.line(Math.min(result.line, editor.view.state.doc.lines));
    editor.jump(Math.min(line.to, line.from + result.column - 1));
    await host.focusEditor();
  });

let lastLiveEdit = 0;
let liveLog = '';
const liveSamples: Record<string, number | string>[] = [];
const live = new LiveScheduler<LiveResult & { started: number; edited: number; mode: string }>({
  delay: () => config.settings.liveDelay,
  cancel: () => {
    void host.cancelLive();
  },
  status: (state) => {
    $('#live-status').textContent = state;
  },
  run: async () => {
    const started = performance.now(),
      edited = lastLiveEdit;
    const settings = config.settings;
    const buffers = tabs
      .filter((t) => /\.(tex|bib|sty|cls|txt)$/.test(t.path))
      .map((t) => ({ path: t.path, text: t.state.doc.toString() }));
    const engine =
      settings.compiler === 'latexmk'
        ? settings.buildArgs.includes('-xelatex')
          ? 'xelatex'
          : settings.buildArgs.includes('-lualatex')
            ? 'lualatex'
            : 'pdflatex'
        : settings.compiler;
    return {
      ...(await host.liveBuild({
        rootFile: settings.rootFile,
        compiler: settings.compiler,
        engine,
        mode: settings.liveMode,
        buffers,
      })),
      started,
      edited,
      mode: settings.liveMode,
    };
  },
  present: async (result, isCurrent) => {
    liveLog = result.log;
    if (!result.ok || !result.pdf) {
      $('#live-status').textContent = 'Waiting for valid LaTeX';
      $('#live-status').dataset.state = 'invalid';
      return;
    }
    const renderStarted = performance.now();
    await pdfPreview.load(
      async () => ({ pdf: result.pdf!, syncId: result.syncId }),
      project.root +
        ':' +
        config.settings.rootFile
          .split('/')
          .at(-1)!
          .replace(/\.tex$/, '.pdf'),
      isCurrent,
    );
    if (!isCurrent()) return;
    const painted = performance.now();
    const sample = {
      mode: result.mode,
      ...result.metrics,
      previewMs: Math.round(painted - renderStarted),
      pipelineMs: Math.round(painted - result.started),
      editToPreviewMs: Math.round(painted - result.edited),
    };
    liveSamples.push(sample);
    if (liveSamples.length > 200) liveSamples.shift();
    $('#live-status').textContent =
      `Live ${result.mode === 'fast' ? 'draft' : 'PDF'} · ${sample.editToPreviewMs} ms`;
    $('#live-status').title =
      `Copy ${sample.syncMs} ms · TeX ${sample.compileMs} ms · PDF ${sample.previewMs} ms`;
    $('#live-status').dataset.metrics = JSON.stringify(sample);
    $('#live-status').dataset.samples = String(liveSamples.length);
    $('#live-status').dataset.state = 'ready';
  },
});
function requestLive() {
  lastLiveEdit = performance.now();
  live.changed();
}
function stopLive() {
  live.setEnabled(false);
  $('#live-toggle').textContent = 'Live off';
  $('#live-toggle').setAttribute('aria-pressed', 'false');
  $('#live-status').hidden = true;
}

const worker = new Worker(new URL('./services/index.worker.ts', import.meta.url), {
  type: 'module',
});
worker.onmessage = (e) => {
  if (versions.get(e.data.path) !== e.data.version) return;
  indexed.set(e.data.path, e.data.symbols);
  symbols = [...indexed.values()].flat();
  if (sidebarTab !== 'search') renderSidebar();
};
function index(path: string, text: string) {
  const version = ++indexSequence;
  versions.set(path, version);
  worker.postMessage({ path, text, version });
}
function current() {
  return tabs.find((t) => t.path === active);
}
function toast(message: string) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  setTimeout(() => $('#toast').classList.remove('visible'), 4200);
}
function guard(fn: () => unknown) {
  try {
    Promise.resolve(fn()).catch((e) => toast(e.message || String(e)));
  } catch (e) {
    toast((e as Error).message);
  }
}
function run(id: string): boolean {
  const c = commands.find((c) => c.id === id);
  if (c) {
    if (
      !active &&
      !practice.isOpen &&
      ['Editing', 'Mathematics', 'Structural navigation'].includes(c.category)
    ) {
      toast('Open a project file to start writing.');
      return true;
    }
    try {
      const result = c.run();
      if (result instanceof Promise) {
        result.catch((e) => toast(e.message || String(e)));
        return true;
      }
      return result !== false;
    } catch (e) {
      toast((e as Error).message);
      return true;
    }
  }
  return editor.action(id);
}
function register(id: string, name: string, category: string, fn: () => unknown) {
  commands.push({ id, name, category, run: fn });
}
function changed(text: string) {
  const tab = current();
  if (!tab) return;
  tab.state = editor.view.state;
  tab.dirty = text !== tab.saved;
  requestLive();
  renderTabs();
  updateStatus();
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => index(tab.path, text), 250);
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => guard(storeRecovery), 450);
  if (config.settings.autoSave) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => guard(save), 1200);
  }
}
async function storeRecovery() {
  const dirty = tabs
    .filter((t) => t.dirty)
    .map((t) => ({
      root: project.root,
      path: t.path,
      text: t.state.doc.toString(),
      version: t.version,
    }));
  recovery = [...recovery.filter((r) => r.root !== project.root), ...dirty];
  await host.saveRecovery(recovery);
}
function updateStatus() {
  if (!editor?.view) return;
  const pos = editor.view.state.selection.main.head;
  const line = editor.view.state.doc.lineAt(pos);
  const ctx = editor.mode();
  $('#position').textContent = `Ln ${line.number}, Col ${pos - line.from + 1}`;
  $('#status-mode').textContent = ctx.comment
    ? 'Comment'
    : ctx.mode === 'math'
      ? 'Math mode'
      : 'LaTeX · Text';
  $('#status-mode').classList.toggle('math', ctx.mode === 'math');
  $('#save-status').textContent = current()?.conflict
    ? 'File changed on disk'
    : current()?.dirty
      ? 'Unsaved changes'
      : 'All changes saved';
  $('#snippet-status').textContent = config.settings.autoSnippets
    ? 'Snippets on'
    : 'Snippets paused';
}
function renderTabs() {
  $('#tabs').innerHTML = tabs
    .map(
      (t) =>
        `<div class="file-tab ${t.path === active ? 'selected' : ''}" role="tab" aria-selected="${t.path === active}"><button class="tab-name" data-file="${esc(t.path)}">${icon(t.path.endsWith('.tex') ? 'code' : 'file', 14)}<span>${esc(t.path.split('/').at(-1))}</span>${t.dirty ? '<span class="dirty-dot"></span>' : ''}</button><button class="tab-close" data-close="${esc(t.path)}" aria-label="Close ${esc(t.path)}">${icon('close', 12)}</button></div>`,
    )
    .join('');
  $('#breadcrumb-file').textContent = active || 'No file open';
}
function renderSidebar() {
  const side = $('#side-content');
  $('#side-title').textContent =
    sidebarTab === 'files'
      ? 'EXPLORER'
      : sidebarTab === 'outline'
        ? 'DOCUMENT OUTLINE'
        : 'PROJECT SEARCH';
  document
    .querySelectorAll('[data-side]')
    .forEach((e) => e.classList.toggle('active', (e as HTMLElement).dataset.side === sidebarTab));
  if (sidebarTab === 'files') {
    const entries = [...project.entries].sort((a, b) => a.path.localeCompare(b.path));
    side.innerHTML = `${pinned.size ? '<div class="tree-label">PINNED</div>' + [...pinned].map((p) => fileRow(p, false, true)).join('') : ''}<div class="file-tree">${entries
      .filter((e) => !Array.from(collapsed).some((d) => e.path.startsWith(d + '/')))
      .map((e) => fileRow(e.path, e.directory))
      .join(
        '',
      )}</div><button class="sidebar-command" data-command="quickOpen">${icon('search', 14)}<span>Go to file</span><kbd>Ctrl P</kbd></button><div class="outline-section"><div class="tree-label">OUTLINE <button data-command="symbols" title="Go to symbol">${icon('search', 13)}</button></div>${outlineRows(7)}</div>`;
  } else if (sidebarTab === 'outline')
    side.innerHTML = `<div class="sidebar-search"><input id="outline-filter" placeholder="Filter symbols…" aria-label="Filter outline"></div><div id="outline-list">${outlineRows()}</div>`;
  else {
    side.innerHTML = `<div class="sidebar-search"><input id="project-query" placeholder="Search project…" aria-label="Search project"><div class="search-options"><label><input id="search-case" type="checkbox"> Aa</label><label><input id="search-regex" type="checkbox"> .*</label><label><input id="search-word" type="checkbox"> Word</label></div><button class="secondary" id="do-project-search">Search files</button></div><div id="search-results" class="search-results"><p>Search across .tex, .bib, and text files.</p></div>`;
    $('#do-project-search').onclick = () => guard(projectSearch);
    $('#project-query').onkeydown = (e) => {
      if (e.key === 'Enter') guard(projectSearch);
    };
  }
  if (sidebarTab === 'outline')
    $('#outline-filter').oninput = () => {
      $('#outline-list').innerHTML = outlineRows(
        Infinity,
        $<HTMLInputElement>('#outline-filter').value,
      );
    };
}
function fileRow(path: string, directory: boolean, pin = false) {
  const depth = path.split('/').length - 1;
  return `<div class="tree-row ${path === active ? 'selected' : ''}" style="--depth:${pin ? 0 : depth}"><button ${directory ? 'data-folder' : 'data-file'}="${esc(path)}">${icon(directory ? (collapsed.has(path) ? 'chevron' : 'down') : path.endsWith('.tex') ? 'code' : 'file', 14)}<span>${esc(path.split('/').at(-1))}</span></button>${directory ? '' : `<button class="row-menu ${pinned.has(path) ? 'is-pinned' : ''}" data-file-menu="${esc(path)}" aria-label="File actions for ${esc(path)}">···</button>`}</div>`;
}
function outlineRows(limit = Infinity, query = '') {
  return (
    symbols
      .filter(
        (s) =>
          s.path === active &&
          (sidebarTab === 'outline' || s.kind === 'section') &&
          fuzzy(query, s.name) >= 0,
      )
      .slice(0, limit)
      .map(
        (s) =>
          `<button class="outline-row" style="padding-left:${17 + Math.max(0, (s.level || 2) - 2) * 11}px" data-jump="${s.from}" data-path="${esc(s.path)}"><span class="outline-mark">${s.kind === 'section' ? '§' : '#'}</span><span>${esc(s.name)}</span></button>`,
      )
      .join('') || '<p class="empty-small">Document structure appears here.</p>'
  );
}
async function openFile(path: string, pos?: number) {
  if (path.endsWith('.pdf')) {
    $('#preview').hidden = false;
    await pdfPreview.load(() => host.readPreview(path), project.root + ':' + path);
    return;
  }
  if (!/\.(tex|bib|sty|cls|md|txt|json)$/.test(path)) {
    toast('This file type cannot be edited as source.');
    return;
  }
  let tab = tabs.find((t) => t.path === path);
  if (current()) current()!.state = editor.view.state;
  if (!tab) {
    const read = await host.read(path);
    tab = {
      path,
      state: editor.state(read.text),
      version: read.version,
      saved: read.text,
      dirty: false,
      conflict: false,
    };
    tabs.push(tab);
    index(path, read.text);
  }
  active = path;
  editor.spellFile = path;
  editor.load(tab.state);
  editor.configure();
  if (pos !== undefined) editor.jump(pos);
  renderTabs();
  renderSidebar();
}
async function save() {
  const tab = current();
  if (!tab) return;
  const text = tab.state.doc.toString();
  try {
    const result = await host.write(tab.path, text, tab.version);
    tab.version = result.version;
    tab.saved = text;
    tab.dirty = tab.state.doc.toString() !== text;
    tab.conflict = false;
    await storeRecovery();
    renderTabs();
    updateStatus();
    if (config.settings.buildOnSave && !building) await build(false);
  } catch (e) {
    tab.conflict = String(e).includes('CONFLICT');
    updateStatus();
    throw e;
  }
}
async function closeFile(path = active) {
  const tab = tabs.find((t) => t.path === path);
  if (!tab) return;
  if (tab.dirty) {
    if (
      !(await confirmDialog(
        'Close unsaved file?',
        `Discard the unsaved changes in ${path}?`,
        'Discard changes',
      ))
    )
      return;
  }
  closed.push(path);
  tabs = tabs.filter((t) => t !== tab);
  if (active === path) {
    active = '';
    if (tabs.length) await openFile(tabs.at(-1)!.path);
    else {
      editor.load(editor.state(''));
      editor.lock(true);
    }
  }
  renderTabs();
  renderSidebar();
  await storeRecovery();
}
async function openProject(recent?: string) {
  if (tabs.some((t) => t.dirty)) {
    if (
      !(await confirmDialog(
        'Switch projects?',
        'Unsaved files will be kept in recovery. Continue?',
        'Keep recovery & switch',
      ))
    )
      return;
    await storeRecovery();
  }
  if (!native) {
    toast(
      'Browser demo: use Import file to try your own source. Open the desktop app for project folders.',
    );
    return;
  }
  const p = recent ? await host.openRecent(recent) : await host.openProject();
  if (p) await loadProject(p);
}
async function loadProject(p: Project) {
  stopLive();
  pdfPreview.clear();
  project = p;
  tabs = [];
  active = '';
  indexed.clear();
  versions.clear();
  symbols = [];
  $('#project-name').textContent = p.name;
  $('#folder-title').textContent = p.name;
  $('#breadcrumb-folder').textContent = p.name;
  $('#status-project').textContent =
    `${p.entries.filter((e) => !e.directory).length} project files`;
  const storedPins = localStorage.getItem('quill.pins.' + p.root);
  pinned = new Set(storedPins ? JSON.parse(storedPins) : []);
  await loadConfiguration();
  const first =
    p.entries.find((e) => e.path === 'main.tex') || p.entries.find((e) => e.path.endsWith('.tex'));
  if (first) await openFile(first.path);
  else {
    editor.load(editor.state(''));
    renderTabs();
    renderSidebar();
  }
  for (const e of p.entries)
    if (/\.(tex|bib|sty|cls)$/.test(e.path) && e.path !== active) {
      try {
        const r = await host.read(e.path);
        index(e.path, r.text);
      } catch {}
    }
  const recoverable = recovery.filter((r) => r.root === p.root);
  if (
    recoverable.length &&
    (await confirmDialog(
      'Recover unsaved writing?',
      `${recoverable.length} unsaved file(s) were found for this project.`,
      'Recover files',
    ))
  )
    for (const r of recoverable) {
      try {
        await openFile(r.path);
      } catch {
        tabs.push({
          path: r.path,
          state: editor.state(''),
          version: r.version,
          saved: '',
          dirty: true,
          conflict: false,
        });
        active = r.path;
      }
      const t = current()!;
      t.state = editor.state(r.text);
      t.dirty = r.text !== t.saved;
      editor.load(t.state);
      renderTabs();
    }
}
async function loadConfiguration() {
  try {
    const loaded = await host.loadDictionaries();
    dictionaries = {
      global: dictionaryWords(loaded.global),
      project: dictionaryWords(loaded.project),
    };
  } catch (error) {
    dictionaries = { global: [], project: [] };
    toast('Dictionary: ' + (error as Error).message);
  }
  const stored = await host.loadConfig();
  try {
    config = stored.global ? validateConfig(stored.global) : defaults();
    if (stored.project)
      config = validateConfig({
        ...config,
        ...stored.project,
        keybindingDefaultsVersion: stored.project.keybindings
          ? (stored.project.keybindingDefaultsVersion ?? 1)
          : config.keybindingDefaultsVersion,
        settings: { ...config.settings, ...stored.project.settings },
      });
  } catch (e) {
    toast('Configuration rejected: ' + (e as Error).message);
  }
  applyConfig();
}
function applyConfig() {
  setPersonalDictionary([...dictionaries.global, ...dictionaries.project, ...ignoredSpelling]);
  editor.spellFile = active || '';
  document.documentElement.dataset.wordWrap = String(config.settings.wordWrap);
  if (live.enabled) requestLive();
  applyAppearance(config.settings);
  editor.configure();
  practice.configure();
  updateStatus();
}
async function persistConfig(scope = 'global') {
  config = validateConfig(config);
  await host.saveConfig(config, scope);
  applyConfig();
}
function modal(title: string, body: string, wide = false) {
  const d = $<HTMLDialogElement>('#dialog');
  if (d.open) d.close();
  d.className = wide ? 'wide' : '';
  d.innerHTML = `<div class="dialog-header"><div>${title}</div><button id="dialog-close" class="icon-button" aria-label="Close dialog">${icon('close')}</button></div>${body}`;
  d.showModal();
  $('#dialog-close').onclick = () => d.close();
  return d;
}
function confirmDialog(title: string, text: string, yes: string): Promise<boolean> {
  return new Promise((resolve) => {
    const d = modal(
      title,
      `<div class="dialog-body"><p>${esc(text)}</p></div><div class="dialog-footer"><button id="cancel" class="secondary">Cancel</button><button id="confirm" class="primary">${esc(yes)}</button></div>`,
    );
    d.onclose = () => resolve(false);
    $('#cancel').onclick = () => d.close();
    $('#confirm').onclick = () => {
      resolve(true);
      d.close();
    };
  });
}
function promptDialog(title: string, label: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const d = modal(
      title,
      `<form id="prompt-form"><div class="dialog-body"><label class="field">${esc(label)}<input id="prompt-value" value="${esc(value)}" required autocomplete="off"></label></div><div class="dialog-footer"><button type="submit" class="primary">Continue ${icon('arrow', 14)}</button></div></form>`,
    );
    d.onclose = () => resolve(null);
    $('#prompt-form').onsubmit = (e) => {
      e.preventDefault();
      resolve($<HTMLInputElement>('#prompt-value').value.trim());
      d.close();
    };
    $<HTMLInputElement>('#prompt-value').select();
  });
}
function palette(kind: 'commands' | 'files' | 'symbols' = 'commands') {
  const titles = {
    commands: 'What would you like to do?',
    files: 'Go to file…',
    symbols: 'Go to symbol…',
  };
  const d = modal(
    `${icon('search', 18)} <input id="palette-query" placeholder="${titles[kind]}" aria-label="${titles[kind]}" autocomplete="off">`,
    `<div id="palette-results" class="palette-results"></div><div class="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> dismiss</span></div>`,
  );
  d.classList.add('palette');
  let selected = 0;
  let items: { name: string; detail: string; key: string; action: () => unknown }[] = [];
  const draw = () => {
    const query = $<HTMLInputElement>('#palette-query').value;
    const all =
      kind === 'commands'
        ? commands.map((c) => ({
            name: c.name,
            detail: c.category,
            key: config.keybindings.find((b) => b.command === c.id)?.key || '',
            action: c.run,
          }))
        : kind === 'files'
          ? project.entries
              .filter((e) => !e.directory && /\.(tex|bib|sty|cls|md|txt|json)$/.test(e.path))
              .map((e) => ({
                name: e.path.split('/').at(-1)!,
                detail: e.path,
                key: '',
                action: () => openFile(e.path),
              }))
          : symbols.map((s) => ({
              name: s.name,
              detail: `${s.kind} · ${s.path}:${s.line}`,
              key: '',
              action: () => openFile(s.path, s.from),
            }));
    items = all
      .map((i) => ({ ...i, score: fuzzy(query, i.name + ' ' + i.detail) }))
      .filter((i) => i.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
    selected = Math.min(selected, Math.max(0, items.length - 1));
    $('#palette-results').innerHTML =
      items
        .map(
          (i, n) =>
            `<button class="palette-item ${n === selected ? 'selected' : ''}" data-item="${n}">${icon(kind === 'files' ? 'file' : kind === 'symbols' ? 'book' : 'arrow', 17)}<div><strong>${esc(i.name)}</strong><small>${esc(i.detail)}</small></div>${i.key ? `<kbd>${esc(i.key.replace(/Mod/g, 'Ctrl'))}</kbd>` : ''}</button>`,
        )
        .join('') || '<div class="empty-small">No matches found</div>';
    document
      .querySelectorAll('[data-item]')
      .forEach(
        (el) =>
          ((el as HTMLElement).onclick = () => choose(Number((el as HTMLElement).dataset.item))),
      );
  };
  const choose = (i: number) => {
    if (!items[i]) return;
    d.close();
    guard(items[i].action);
  };
  $('#palette-query').oninput = () => {
    selected = 0;
    draw();
  };
  $('#palette-query').onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selected = Math.max(
        0,
        Math.min(items.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)),
      );
      draw();
      $('.palette-item.selected')?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      choose(selected);
    }
  };
  draw();
  $('#palette-query').focus();
}
async function fileMenu(path: string) {
  const d = modal(
    path,
    `<div class="menu-actions"><button id="pin-file">${icon('pin')} ${pinned.has(path) ? 'Unpin' : 'Pin'} file</button><button id="rename-file">${icon('file')} Rename file</button><button id="reload-file">${icon('refresh')} Reload from disk</button><button id="save-as">${icon('download')} Save a copy as…</button><button id="trash-file" class="danger">${icon('close')} Move to trash</button></div>`,
  );
  $('#pin-file').onclick = () => {
    pinned.has(path) ? pinned.delete(path) : pinned.add(path);
    localStorage.setItem('quill.pins.' + project.root, JSON.stringify([...pinned]));
    d.close();
    renderSidebar();
  };
  $('#rename-file').onclick = () =>
    guard(async () => {
      d.close();
      const name = await promptDialog('Rename file', 'Project-relative path', path);
      if (!name || name === path) return;
      project.entries = await host.rename(path, name);
      const t = tabs.find((t) => t.path === path);
      if (t) t.path = name;
      if (active === path) active = name;
      indexed.delete(path);
      renderTabs();
      renderSidebar();
      await storeRecovery();
    });
  $('#reload-file').onclick = () =>
    guard(async () => {
      d.close();
      const t = tabs.find((t) => t.path === path);
      if (
        t?.dirty &&
        !(await confirmDialog('Reload from disk?', 'This discards your unsaved edits.', 'Reload'))
      )
        return;
      const read = await host.read(path);
      if (t) {
        t.state = editor.state(read.text);
        t.saved = read.text;
        t.version = read.version;
        t.dirty = false;
        t.conflict = false;
      }
      await openFile(path);
      await storeRecovery();
    });
  $('#save-as').onclick = () =>
    guard(async () => {
      d.close();
      const name = await promptDialog(
        'Save a copy',
        'New project-relative filename',
        path.replace('.tex', '-copy.tex'),
      );
      if (!name) return;
      const t = tabs.find((t) => t.path === path);
      const text = t?.state.doc.toString() ?? (await host.read(path)).text;
      await host.write(name, text, null);
      project.entries = await host.list();
      await openFile(name);
    });
  $('#trash-file').onclick = () =>
    guard(async () => {
      d.close();
      if (
        !(await confirmDialog(
          'Move file to trash?',
          `${path} will be removed from the project. Unsaved edits will be discarded.`,
          'Move to trash',
        ))
      )
        return;
      project.entries = await host.trash(path);
      const t = tabs.find((t) => t.path === path);
      if (t) t.dirty = false;
      await closeFile(path);
      indexed.delete(path);
      symbols = [...indexed.values()].flat();
      renderSidebar();
    });
}
async function projectSearch() {
  const q = $<HTMLInputElement>('#project-query').value;
  if (!q) return;
  let re: RegExp;
  try {
    const expression = $<HTMLInputElement>('#search-regex').checked
      ? q
      : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(
      $<HTMLInputElement>('#search-word').checked ? '\\b(?:' + expression + ')\\b' : expression,
      $<HTMLInputElement>('#search-case').checked ? 'g' : 'gi',
    );
  } catch {
    toast('Invalid search expression');
    return;
  }
  const results: { path: string; line: number; from: number; text: string }[] = [];
  for (const e of project.entries.filter((e) => /\.(tex|bib|sty|cls|txt|md|json)$/.test(e.path))) {
    const text =
      tabs.find((t) => t.path === e.path)?.state.doc.toString() ?? (await host.read(e.path)).text;
    for (const m of text.matchAll(re)) {
      const from = m.index!;
      results.push({
        path: e.path,
        line: text.slice(0, from).split('\n').length,
        from,
        text: text.slice(
          text.lastIndexOf('\n', from) + 1,
          text.indexOf('\n', from) < 0 ? text.length : text.indexOf('\n', from),
        ),
      });
      if (results.length >= 200) break;
    }
    if (results.length >= 200) break;
  }
  $('#search-results').innerHTML =
    `<div class="search-count">${results.length}${results.length === 200 ? '+' : ''} results</div>` +
    results
      .map(
        (r) =>
          `<button class="search-result" data-path="${esc(r.path)}" data-jump="${r.from}"><strong>${esc(r.path)}:${r.line}</strong><span>${esc(r.text)}</span></button>`,
      )
      .join('');
}
function settings(tab = 'general') {
  const nav = [
    ['general', 'Editor'],
    ['appearance', 'Appearance'],
    ['highlighting', 'Delimiters'],
    ['snippets', 'Snippets'],
    ['keyboard', 'Keybindings'],
    ['spelling', 'Spelling'],
    ['profiles', 'Profiles & JSON'],
  ];
  modal(
    'Settings',
    `<div class="settings-layout"><nav>${nav.map(([id, name]) => `<button class="${id === tab ? 'selected' : ''}" data-settings="${id}">${esc(name)}</button>`).join('')}</nav><div id="settings-content"></div></div>`,
    true,
  );
  document
    .querySelectorAll('[data-settings]')
    .forEach(
      (el) => ((el as HTMLElement).onclick = () => settings((el as HTMLElement).dataset.settings)),
    );
  if (tab === 'appearance') appearanceSettings();
  else if (tab === 'snippets') snippetSettings();
  else if (tab === 'keyboard') keyboardSettings();
  else if (tab === 'highlighting') delimiterSettings();
  else if (tab === 'spelling') spellingSettings();
  else if (tab === 'profiles') profileSettings();
  else generalSettings();
}
function appearanceSettings() {
  const draft = { ...config.settings };
  $('#settings-content').innerHTML =
    `<div class="settings-heading"><h2>Appearance</h2></div><div class="accent-presets" aria-label="Accent presets">${Object.entries(
      accentPresets,
    )
      .map(
        ([name, colors]) =>
          `<button type="button" class="secondary" data-accent-preset="${name}"><span style="background:${colors.accentColor}"></span>${name}</button>`,
      )
      .join('')}</div><form id="appearance-form"><div class="color-grid">${Object.entries(
      colorRoles,
    )
      .map(
        ([key, [label]]) =>
          `<label class="color-field"><span>${label}</span><div><input type="color" data-color="${key}" aria-label="${label} picker" value="${draft[key as ColorKey]}"><input name="${key}" aria-label="${label} hex" value="${draft[key as ColorKey]}" pattern="#[0-9a-fA-F]{6}" required maxlength="7" spellcheck="false"></div></label>`,
      )
      .join(
        '',
      )}</div><p class="subtle">Six-digit hex colors. Preview changes immediately; save to keep them.</p><div class="form-footer"><button type="button" id="reset-colors" class="secondary">Reset colors</button><select name="scope" aria-label="Appearance scope"><option value="global">Global settings</option><option value="project">This project</option></select><button type="submit" class="primary">Save appearance</button></div></form>`;
  const refresh = () => {
    for (const key of Object.keys(colorRoles) as ColorKey[]) {
      $<HTMLInputElement>(`[name="${key}"]`).value = draft[key];
      $<HTMLInputElement>(`[data-color="${key}"]`).value = draft[key];
    }
    applyAppearance(draft);
  };
  for (const key of Object.keys(colorRoles) as ColorKey[]) {
    const hex = $<HTMLInputElement>(`[name="${key}"]`);
    const picker = $<HTMLInputElement>(`[data-color="${key}"]`);
    hex.oninput = () => {
      if (!validColor(hex.value)) return;
      draft[key] = hex.value;
      picker.value = hex.value;
      applyAppearance(draft);
    };
    picker.oninput = () => {
      draft[key] = picker.value;
      hex.value = picker.value;
      applyAppearance(draft);
    };
  }
  document.querySelectorAll<HTMLButtonElement>('[data-accent-preset]').forEach((el) => {
    el.onclick = () => {
      Object.assign(draft, accentPresets[el.dataset.accentPreset as keyof typeof accentPresets]);
      refresh();
    };
  });
  $('#reset-colors').onclick = () => {
    Object.assign(draft, defaultColors);
    refresh();
  };

  $('#appearance-form').onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const f = new FormData(e.target as HTMLFormElement);
      const next = structuredClone(config);
      for (const key of Object.keys(colorRoles) as ColorKey[])
        next.settings[key] = String(f.get(key));
      config = validateConfig(next);
      await persistConfig(String(f.get('scope')));
      toast('Appearance saved');
    });
  };
}

function generalSettings() {
  const s = config.settings;
  $('#settings-content').innerHTML =
    `<div class="settings-heading"><h2>Editor</h2></div><form id="settings-form"><div class="two-columns"><label class="field">Font size<input name="fontSize" type="number" min="10" max="32" value="${s.fontSize}"></label><label class="field">Line height<input name="lineHeight" type="number" step="0.05" min="1" max="3" value="${s.lineHeight}"></label><label class="field">Completion suggestions<input name="completionLimit" type="number" min="1" max="100" value="${s.completionLimit}"></label></div><div class="toggle-list">${(
      [
        ['lineNumbers', 'Show line numbers'],
        ['wordWrap', 'Wrap long lines'],
        ['spellCheck', 'Check English spelling'],
        ['spellComments', 'Check spelling in comments'],
        ['autoPairs', 'Pair braces and delimiters'],
        ['smartScripts', 'Expand ^ and _ in mathematics'],
        ['autoSnippets', 'Expand automatic snippets'],
        ['completion', 'Show completions as you type'],
        ['autoSave', 'Save after 1.2 seconds of inactivity'],
        ['buildOnSave', 'Build after saving'],
      ] as const
    )
      .map(
        ([key, label]) =>
          `<label>${label}<input name="${key}" type="checkbox" ${s[key] ? 'checked' : ''}></label>`,
      )
      .join(
        '',
      )}</div><h3>Term navigation</h3><label class="field">Term boundaries (one literal per line)<textarea name="termSeparators" rows="7" spellcheck="false" class="mono">${esc(s.termSeparators.join('\n'))}</textarea></label><label class="field">Split terms at whitespace<input name="termWhitespace" type="checkbox" ${s.termWhitespace ? 'checked' : ''}></label><p class="subtle">Alt+E/W move through expressions and cross one boundary per press. These rules also apply to term selection and cutting. Add operators or delimiters; remove a line to keep it within terms. Curly braces are included in terms by default.</p><h3>Live preview</h3><div class="two-columns"><label class="field">Pause before rendering (ms)<input name="liveDelay" type="number" min="100" max="2000" value="${s.liveDelay}"></label><label class="field">Live rendering mode<select name="liveMode"><option value="accurate" ${s.liveMode === 'accurate' ? 'selected' : ''}>Full LaTeX (resolve references)</option><option value="fast" ${s.liveMode === 'fast' ? 'selected' : ''}>Fast draft (single pass)</option></select></label></div><p class="subtle">Unsaved buffers compile in a temporary project. Fast drafts can have stale citations or references. Enable using the Live button.</p><h3>Compilation</h3><div class="two-columns"><label class="field">Compiler<select name="compiler">${['latexmk', 'pdflatex', 'xelatex', 'lualatex'].map((c) => `<option ${s.compiler === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label class="field">Root document<input name="rootFile" value="${esc(s.rootFile)}"></label></div><label class="field">Arguments (JSON array)<input name="buildArgs" value="${esc(JSON.stringify(s.buildArgs))}"></label><div class="form-footer"><select name="scope"><option value="global">Global settings</option><option value="project">This project</option></select><button class="primary" type="submit">Save settings ${icon('check', 15)}</button></div></form>`;
  $('#settings-form').onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const f = new FormData(e.target as HTMLFormElement);
      const next = structuredClone(config);
      for (const key of ['fontSize', 'lineHeight', 'completionLimit', 'liveDelay'] as const)
        next.settings[key] = Number(f.get(key));
      for (const key of [
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
        next.settings[key] = f.has(key);
      next.settings.termSeparators = String(f.get('termSeparators'))
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      next.settings.termWhitespace = f.has('termWhitespace');
      next.settings.liveMode = f.get('liveMode') as 'accurate' | 'fast';
      next.settings.theme = 'dark';
      next.settings.compiler = String(f.get('compiler'));
      next.settings.rootFile = String(f.get('rootFile'));
      next.settings.buildArgs = JSON.parse(String(f.get('buildArgs')));
      if (next.settings.compiler !== 'latexmk')
        next.settings.buildArgs = next.settings.buildArgs.filter(
          (a) => !['-pdf', '-xelatex', '-lualatex'].includes(a),
        );
      config = validateConfig(next);
      await persistConfig(String(f.get('scope')));
      toast('Settings saved');
    });
  };
}

function delimiterSettings() {
  const draft = structuredClone(config.settings.delimiterHighlight);
  const draw = () => {
    $('#settings-content').innerHTML =
      `<div class="settings-heading"><h2>Delimiter highlighting</h2></div><div class="form-footer">${Object.keys(
        delimiterPresets,
      )
        .map(
          (name) =>
            `<button type="button" class="secondary" data-delimiter-preset="${name}">${name}</button>`,
        )
        .join(
          '',
        )}</div><p class="subtle">Prism: nesting colors · Blueprint: delimiter families · Focus: active pair · Contrast: vivid colors. The innermost pair follows the cursor. Hover a delimiter for its partner’s location.</p><form id="delimiter-form"><div class="toggle-list">${[
        ['enabled', 'Enable delimiter highlighting'],
        ['showErrors', 'Mark unmatched delimiters'],
        ['highlightScope', 'Tint the active scope'],
        ['environments', 'Highlight environment pairs'],
      ]
        .map(
          ([key, label]) =>
            `<label>${label}<input type="checkbox" name="${key}" ${draft[key as keyof typeof draft] ? 'checked' : ''}></label>`,
        )
        .join(
          '',
        )}</div><div class="two-columns"><label class="field">Color mode<select name="mode">${['depth', 'kind', 'focus'].map((mode) => `<option ${draft.mode === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></label><label class="field">Active pair style<select name="activeStyle">${['outline', 'fill', 'underline'].map((style) => `<option ${draft.activeStyle === style ? 'selected' : ''}>${style}</option>`).join('')}</select></label><label class="field">Active pair color<input type="color" name="activeColor" value="${draft.activeColor}"></label><label class="field">Unmatched color<input type="color" name="errorColor" value="${draft.errorColor}"></label></div><label class="field">Palette (hex colors, comma separated)<input name="colors" value="${draft.colors.join(', ')}"></label><div class="form-footer"><select name="scope"><option value="global">Global settings</option><option value="project">This project</option></select><button class="primary">Save highlighting</button></div></form>`;
    document.querySelectorAll<HTMLButtonElement>('[data-delimiter-preset]').forEach((button) => {
      button.onclick = () => {
        Object.assign(draft, structuredClone(delimiterPresets[button.dataset.delimiterPreset!]));
        draw();
      };
    });
    $('#delimiter-form').onsubmit = (event) => {
      event.preventDefault();
      guard(async () => {
        const form = new FormData(event.target as HTMLFormElement),
          next = structuredClone(config);
        const h = next.settings.delimiterHighlight;
        for (const key of ['enabled', 'showErrors', 'highlightScope', 'environments'] as const)
          h[key] = form.has(key);
        h.mode = String(form.get('mode')) as typeof h.mode;
        h.activeStyle = String(form.get('activeStyle')) as typeof h.activeStyle;
        h.colors = String(form.get('colors'))
          .split(',')
          .map((c) => c.trim());
        h.activeColor = String(form.get('activeColor'));
        h.errorColor = String(form.get('errorColor'));
        config = validateConfig(next);
        await persistConfig(String(form.get('scope')));
        toast('Highlighting saved');
      });
    };
  };
  draw();
}
function spellingSettings() {
  $('#settings-content').innerHTML =
    `<div class="settings-heading"><h2>Spelling</h2></div><p class="subtle">English · offline. Personal words are stored separately for the application and project. One word per line.</p><form id="dictionary-form"><label class="field">Dictionary scope<select name="dictionaryScope"><option value="project">Project dictionary</option><option value="global">Global dictionary</option></select></label><label class="field">Words<textarea name="dictionaryWords" rows="12" spellcheck="false"></textarea></label><div class="form-footer"><button type="submit" class="primary">Save dictionary</button><button type="button" id="reset-ignored" class="secondary">Clear session ignores</button></div></form><p class="subtle">Use Spelling suggestions or Next spelling issue in the command palette. Enable/disable checking and comments in Editor settings.</p><label class="field">Files excluded from spell checking (project-relative paths)<textarea id="spell-excluded" rows="4">${esc(config.settings.spellDisabledFiles.join('\n'))}</textarea></label><button id="save-excluded" class="secondary">Save project exclusions</button>`;
  const scope = () =>
    $<HTMLSelectElement>('[name="dictionaryScope"]').value as 'global' | 'project';
  const draw = () => {
    $<HTMLTextAreaElement>('[name="dictionaryWords"]').value = dictionaries[scope()].join('\n');
  };
  $('[name="dictionaryScope"]').onchange = draw;
  draw();
  $('#dictionary-form').onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const target = scope();
      const words = dictionaryWords(
        $<HTMLTextAreaElement>('[name="dictionaryWords"]').value.split(/\s+/).filter(Boolean),
      );
      await host.saveDictionary(words, target);
      dictionaries[target] = words;
      applyConfig();
      toast('Dictionary saved');
    });
  };
  $('#reset-ignored').onclick = () => {
    ignoredSpelling.clear();
    applyConfig();
    toast('Session ignores cleared');
  };
  $('#save-excluded').onclick = () =>
    guard(async () => {
      const next = structuredClone(config);
      next.settings.spellDisabledFiles = $<HTMLTextAreaElement>('#spell-excluded')
        .value.split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      config = validateConfig(next);
      await persistConfig('project');
      toast('Spelling exclusions saved');
    });
}
let spellingRequest = 0;
async function spellingSuggestions() {
  const request = ++spellingRequest;
  const target = commandEditor(),
    state = target.view.state,
    checker = target.spelling();
  const pos = state.selection.main.head;
  const issue = checker?.issues.find((i) => i.from <= pos && i.to >= pos);
  if (!issue) {
    toast(checker?.error || 'Place the cursor in an underlined word, or use Next spelling issue.');
    return;
  }
  const suggestions = await checker!.suggest(issue.word);
  if (request !== spellingRequest) return;
  if (target.view.state.doc !== state.doc) {
    toast('Text changed; request suggestions again.');
    return;
  }
  const { menu, close } = spellingMenu(
    target.view,
    issue.from,
    `${suggestions.length ? suggestions.map((word, n) => `<button data-spell-replace="${n}">${esc(word)}</button>`).join('') : '<span class="spelling-empty">No suggestions</span>'}<div class="spelling-menu-divider"></div><button id="spell-ignore">Ignore for session</button><button id="spell-project">Add to project dictionary</button><button id="spell-global">Add to global dictionary</button>`,
  );

  menu.querySelectorAll<HTMLButtonElement>('[data-spell-replace]').forEach((button) => {
    button.onclick = () => {
      if (target.view.state.doc !== state.doc || target.view.state.readOnly) {
        toast('Text changed or file is read-only.');
        return;
      }
      const word = suggestions[Number(button.dataset.spellReplace)];
      target.view.dispatch({
        changes: { from: issue.from, to: issue.to, insert: word },
        selection: { anchor: issue.from + word.length },
        userEvent: 'input.spelling',
      });
      close(true);
    };
  });
  menu.querySelector<HTMLButtonElement>('#spell-ignore')!.onclick = () => {
    ignoredSpelling.add(wordKey(issue.word));
    applyConfig();
    close(true);
  };
  for (const scope of ['global', 'project'] as const)
    menu.querySelector<HTMLButtonElement>('#spell-' + scope)!.onclick = () =>
      guard(async () => {
        const words = dictionaryWords([...dictionaries[scope], issue.word]);
        await host.saveDictionary(words, scope);
        dictionaries[scope] = words;
        applyConfig();
        close(true);
      });
}
function snippetSettings() {
  const area = $('#settings-content');
  area.innerHTML = `<div class="settings-heading"><div><h2>Snippets</h2></div><button class="primary" id="new-snippet">${icon('plus', 15)} New snippet</button></div><div class="snippet-toolbar"><input id="snippet-search" placeholder="Search names, triggers, or groups…" aria-label="Search snippets"><button id="export-snippets" class="secondary">Export</button><button id="import-snippets" class="secondary">Import</button></div><div class="snippet-table-head"><span>TRIGGER / NAME</span><span>EXPANSION</span><span>CONTEXT</span></div><div id="snippet-list"></div><div class="settings-tip">${icon('spark', 16)} Use <code>\${1}</code>, <code>\${2}</code> for cursor stops and <code>$0</code> for the final position.</div>`;
  const draw = () => {
    const q = $<HTMLInputElement>('#snippet-search').value.toLowerCase();
    $('#snippet-list').innerHTML = config.snippets
      .filter((s) => (s.name + s.trigger + s.group).toLowerCase().includes(q))
      .map(
        (s) =>
          `<button class="snippet-row ${s.enabled ? '' : 'disabled'}" data-snippet="${esc(s.id)}"><span><kbd>${esc(s.trigger)}</kbd><small>${esc(s.name)}</small></span><code>${esc(s.replacement.replace(/\n/g, ' ↵ '))}</code><span class="context-pill">${s.enabled ? s.context : 'off'}</span></button>`,
      )
      .join('');
    document
      .querySelectorAll('[data-snippet]')
      .forEach(
        (el) =>
          ((el as HTMLElement).onclick = () =>
            editSnippet(
              config.snippets.find((s) => s.id === (el as HTMLElement).dataset.snippet)!,
            )),
      );
  };
  $('#snippet-search').oninput = draw;
  draw();
  $('#new-snippet').onclick = () =>
    editSnippet(
      {
        id: crypto.randomUUID(),
        name: 'New snippet',
        trigger: '',
        replacement: '\\frac{${1}}{${2}}$0',
        context: 'math',
        group: 'Mathematics',
        enabled: true,
        auto: true,
        priority: 0,
        retainTrigger: false,
        recursive: false,
        kind: 'literal',
        outsideComments: true,
      },
      true,
    );
  $('#export-snippets').onclick = () =>
    download('quill-snippets.json', JSON.stringify(config.snippets, null, 2));
  $('#import-snippets').onclick = () =>
    guard(async () => {
      const text = await upload();
      if (!text) return;
      const snippets = JSON.parse(text);
      const next = validateConfig({ ...config, snippets });
      config = next;
      await persistConfig();
      snippetSettings();
    });
}
function editSnippet(s: Snippet, isNew = false) {
  $('#settings-content').innerHTML =
    `<button id="back-snippets" class="text-button">← Snippet library</button><div class="settings-heading"><h2>${isNew ? 'Create snippet' : esc(s.name)}</h2></div><form id="snippet-form"><div class="two-columns"><label class="field">Name<input name="name" required value="${esc(s.name)}"></label><label class="field">Group<input name="group" value="${esc(s.group)}"></label><label class="field">Trigger<input name="trigger" required value="${esc(s.trigger)}" class="mono"></label><label class="field">Trigger type<select name="kind"><option value="literal" ${s.kind === 'literal' ? 'selected' : ''}>Literal text</option><option value="regex" ${s.kind === 'regex' ? 'selected' : ''}>Bounded regex</option></select></label></div><label class="field">Replacement<textarea name="replacement" rows="4" spellcheck="false" class="mono">${esc(s.replacement)}</textarea><small>Tab stops: \${1}, \${2:default}, $0. Nested snippet sessions are supported.</small></label><div class="two-columns"><label class="field">Context<select name="context">${['math', 'text', 'everywhere'].map((c) => `<option ${s.context === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label class="field">Priority<input name="priority" type="number" value="${s.priority}"></label><label class="field">Inside environment (optional)<input name="environment" value="${esc(s.environment || '')}" placeholder="align"></label><label class="field">Inside command argument<input name="argument" value="${esc(s.argument || '')}" placeholder="text"></label><label class="field">After any of these characters<input name="afterCharacters" value="${esc(s.afterCharacters || '')}"></label></div><div class="toggle-list compact">${(
      [
        ['enabled', 'Enabled'],
        ['auto', 'Expand immediately (otherwise use Tab)'],
        ['outsideComments', 'Ignore comments'],
        ['lineStart', 'Only at beginning of line'],
        ['afterWhitespace', 'Only after whitespace'],
        ['retainTrigger', 'Keep trigger text'],
        ['recursive', 'Allow recursive expansion (maximum 8)'],
      ] as const
    )
      .map(
        ([k, n]) =>
          `<label>${n}<input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}></label>`,
      )
      .join(
        '',
      )}</div><div class="form-footer">${!isNew ? '<button type="button" class="danger secondary" id="delete-snippet">Delete snippet</button>' : '<span></span>'}<button class="primary" type="submit">Save snippet</button></div></form>`;
  $('#back-snippets').onclick = snippetSettings;
  $('#snippet-form').onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const f = new FormData(e.target as HTMLFormElement);
      const n = { ...s };
      for (const k of [
        'name',
        'group',
        'trigger',
        'replacement',
        'environment',
        'argument',
        'afterCharacters',
      ] as const)
        n[k] = String(f.get(k) || '');
      n.context = f.get('context') as Snippet['context'];
      n.kind = f.get('kind') as Snippet['kind'];
      n.priority = Number(f.get('priority'));
      for (const k of [
        'enabled',
        'auto',
        'outsideComments',
        'lineStart',
        'afterWhitespace',
        'retainTrigger',
        'recursive',
      ] as const)
        n[k] = f.has(k);
      const next = structuredClone(config);
      if (isNew) next.snippets.push(n);
      else next.snippets = next.snippets.map((x) => (x.id === s.id ? n : x));
      config = validateConfig(next);
      await persistConfig();
      snippetSettings();
    });
  };
  if (!isNew)
    $('#delete-snippet').onclick = () =>
      guard(async () => {
        config.snippets = config.snippets.filter((x) => x.id !== s.id);
        await persistConfig();
        snippetSettings();
      });
}
function keyboardSettings() {
  $('#settings-content').innerHTML =
    `<div class="settings-heading"><h2>Keybindings</h2><p>Use Mod for Ctrl on Linux/Windows and Command on macOS.</p></div><input id="binding-search" placeholder="Find a command…" aria-label="Find keybinding"><div id="binding-list"></div><div id="binding-conflicts" class="settings-tip"></div><div class="form-footer"><button id="reset-bindings" class="secondary">Reset defaults</button><button id="save-bindings" class="primary">Save keybindings</button></div><p class="subtle">Chords: <code>Mod-k Mod-s</code>. Context-specific bindings take precedence. Escape dismisses a snippet session.</p>`;
  const draft = structuredClone(config.keybindings);
  const draw = () => {
    const q = $<HTMLInputElement>('#binding-search').value;
    $('#binding-list').innerHTML = commands
      .filter((c) => fuzzy(q, c.name) >= 0)
      .map((c) => {
        const b = draft.find((b) => b.command === c.id);
        return `<div class="binding-row"><label for="key-${c.id}">${esc(c.name)}</label><input id="key-${c.id}" data-bind="${c.id}" value="${esc(b?.key || '')}" placeholder="Unassigned"><select data-context="${c.id}">${['everywhere', 'math', 'text'].map((ctx) => `<option ${ctx === (b?.context || 'everywhere') ? 'selected' : ''}>${ctx}</option>`).join('')}</select></div>`;
      })
      .join('');
    document.querySelectorAll('[data-bind],[data-context]').forEach(
      (el) =>
        ((el as HTMLInputElement).onchange = () => {
          const id = (el as HTMLElement).dataset.bind || (el as HTMLElement).dataset.context!;
          const key = $<HTMLInputElement>('#key-' + id).value.trim();
          const ctx = $<HTMLSelectElement>(`[data-context="${id}"]`).value as
            'math' | 'text' | 'everywhere';
          const i = draft.findIndex((b) => b.command === id);
          if (i >= 0) draft.splice(i, 1);
          if (key) draft.push({ command: id, key, context: ctx });
          $('#binding-conflicts').textContent =
            bindingConflicts(draft).join(' · ') || 'No shortcut conflicts.';
        }),
    );
  };
  $('#binding-search').oninput = draw;
  draw();
  $('#binding-conflicts').textContent =
    bindingConflicts(draft).join(' · ') || 'No shortcut conflicts.';
  $('#save-bindings').onclick = () =>
    guard(async () => {
      config = validateConfig({ ...config, keybindings: draft });
      await persistConfig();
      toast('Keybindings saved');
    });
  $('#reset-bindings').onclick = () =>
    guard(async () => {
      config.keybindings = defaults().keybindings;
      await persistConfig();
      keyboardSettings();
    });
}
function profileSettings() {
  $('#settings-content').innerHTML =
    `<div class="settings-heading"><h2>Profiles</h2><p>Profiles include settings, snippets, keybindings, and declarative macros.</p></div><div class="profile-grid">${['Default', 'Mathematics', 'Research paper', 'Beamer', 'Minimal'].map((p) => `<button class="profile-card" data-profile="${p}">${icon(p === 'Mathematics' ? 'code' : p === 'Minimal' ? 'moon' : 'book', 22)}<strong>${p}</strong><small>Apply preset</small></button>`).join('')}</div><div class="form-footer"><button id="import-config" class="secondary">Import profile</button><button id="export-config" class="secondary">Export current profile</button></div><h3>Configuration JSON</h3><p class="subtle">Edit the same data used by the visual controls. Validate and apply without restarting.</p><textarea id="config-json" rows="12" class="mono" spellcheck="false" aria-label="Configuration JSON">${esc(JSON.stringify(config, null, 2))}</textarea><div class="form-footer"><button id="reload-config" class="secondary">Reload from disk</button><button id="apply-json" class="primary">Validate & apply</button></div>`;
  document.querySelectorAll('[data-profile]').forEach(
    (el) =>
      ((el as HTMLElement).onclick = () =>
        guard(async () => {
          const p = (el as HTMLElement).dataset.profile!;
          config = defaults();
          if (p === 'Minimal') {
            config.settings.lineNumbers = false;
            config.settings.completion = false;
            document.body.classList.add('hide-sidebar');
          }
          if (p === 'Mathematics') config.settings.fontSize = 16;
          if (p === 'Research paper') config.settings.buildOnSave = true;
          if (p === 'Beamer') {
            config.snippets.push({
              ...config.snippets[0],
              id: 'frame',
              name: 'Beamer frame',
              trigger: 'frame/',
              context: 'text',
              replacement: '\\begin{frame}{${1:Title}}\n  ${2}\n\\end{frame}$0',
            });
          }
          await persistConfig();
          $('#profile-status').textContent = p;
          profileSettings();
        })),
  );
  $('#export-config').onclick = () =>
    download('quill-profile.json', JSON.stringify(config, null, 2));
  $('#import-config').onclick = () =>
    guard(async () => {
      const value = await upload();
      if (!value) return;
      config = validateConfig(JSON.parse(value));
      await persistConfig();
      profileSettings();
    });
  $('#reload-config').onclick = () =>
    guard(async () => {
      await loadConfiguration();
      profileSettings();
    });
  $('#apply-json').onclick = () =>
    guard(async () => {
      config = validateConfig(JSON.parse($<HTMLTextAreaElement>('#config-json').value));
      await persistConfig();
      profileSettings();
      toast('Configuration applied');
    });
}
async function build(saveFirst = true) {
  if (live.enabled) stopLive();
  if (building) return;
  if (!native) {
    toast('Compilation uses a local TeX installation. Run npm run desktop to build your project.');
    return;
  }
  if (saveFirst) {
    for (const t of tabs.filter((t) => t.dirty)) {
      const source = t.state.doc.toString();
      const result = await host.write(t.path, source, t.version);
      t.version = result.version;
      t.saved = source;
      t.dirty = t.state.doc.toString() !== source;
    }
    await storeRecovery();
    renderTabs();
  }
  output = '';
  $('#build-output').textContent = '';
  $('#diagnostics').innerHTML = '';
  $('#build-panel').hidden = false;
  $('#build-result').textContent = 'Building…';
  building = true;
  document.body.classList.add('building');
  try {
    await host.build(config.settings);
  } catch (e) {
    building = false;
    document.body.classList.remove('building');
    $('#build-result').textContent = 'Could not start';
    throw e;
  }
}
async function refreshPdf() {
  if (!native) return;
  const file = config.settings.rootFile
    .split('/')
    .at(-1)!
    .replace(/\.tex$/, '.pdf');
  await pdfPreview.load(() => host.readPreview(file), project.root + ':' + file);
}
function togglePreview() {
  $('#preview').hidden = !$('#preview').hidden;
  if (!$('#preview').hidden && !pdfPreview.loaded && native)
    guard(async () => {
      try {
        await refreshPdf();
      } catch {}
    });
}
const movements: [Movement, string][] = [
  ['nextTerm', 'Jump forward to next term'],
  ['previousTerm', 'Jump back to previous term'],
  ['lineEnd', 'Jump to end of line'],
  ['lineStart', 'Jump to beginning of line'],
  ['nextPosition', 'Move to next logical position'],
  ['previousPosition', 'Move to previous logical position'],
  ['nextArgument', 'Move into next argument'],
  ['previousArgument', 'Move into previous argument'],
  ['outside', 'Move outside current braces'],
  ['inside', 'Move inside nearest braces'],
  ['matching', 'Jump to matching brace or delimiter'],
  ['nextCommand', 'Jump to next command'],
  ['previousCommand', 'Jump to previous command'],
  ['nextEnvironment', 'Jump to next environment'],
  ['mathStart', 'Jump to beginning of math expression'],
  ['mathEnd', 'Jump to end of math expression'],
  ['nextMath', 'Jump to next math expression'],
  ['previousMath', 'Jump to previous math expression'],
];
movements.forEach(([id, name]) =>
  register(id, name, 'Structural navigation', () => commandEditor().move(id)),
);
register('palette', 'Open command palette', 'Workspace', () => palette());
register('quickOpen', 'Quick open file', 'Navigation', () => palette('files'));
register('symbols', 'Go to symbol', 'Navigation', () => palette('symbols'));
register('openProject', 'Open project folder', 'Project', () => openProject());
register('save', 'Save current file', 'File', save);
register('closeFile', 'Close current file', 'File', () => closeFile());
register('reopen', 'Reopen recently closed file', 'File', () => {
  const path = closed.pop();
  if (path) return openFile(path);
  toast('No recently closed files');
});
register('nextFile', 'Switch to next file', 'Navigation', () => {
  const i = tabs.findIndex((t) => t.path === active);
  if (tabs.length) return openFile(tabs[(i + 1) % tabs.length].path);
});
register('previousFile', 'Switch to previous file', 'Navigation', () => {
  const i = tabs.findIndex((t) => t.path === active);
  if (tabs.length) return openFile(tabs[(i - 1 + tabs.length) % tabs.length].path);
});
register('practice', 'Open typing practice', 'Workspace', () => practice.open());
register('spellingSuggestions', 'Spelling suggestions', 'Spelling', spellingSuggestions);
register('nextSpelling', 'Next spelling issue', 'Spelling', () => {
  const target = commandEditor(),
    checker = target.spelling(),
    pos = target.view.state.selection.main.head;
  const issue = checker?.issues.find((i) => i.from > pos) || checker?.issues[0];
  if (!issue) {
    toast(checker?.error || 'No spelling issues found (checking runs after a typing pause).');
    return;
  }
  target.view.dispatch({ selection: { anchor: issue.from, head: issue.to }, scrollIntoView: true });
  target.view.focus();
});
register('delimiterSettings', 'Customize LaTeX delimiter highlighting', 'Preferences', () =>
  settings('highlighting'),
);
register('spellingSettings', 'Manage spelling dictionaries', 'Spelling', () =>
  settings('spelling'),
);
register(
  'toggleProjectSpelling',
  'Toggle spell checking for current project',
  'Spelling',
  async () => {
    config.settings.spellCheck = !config.settings.spellCheck;
    await persistConfig('project');
    toast(
      config.settings.spellCheck
        ? 'Project spell checking enabled'
        : 'Project spell checking disabled',
    );
  },
);
register('toggleFileSpelling', 'Toggle spell checking for current file', 'Spelling', async () => {
  const file = commandEditor().spellFile;
  const excluded = new Set(config.settings.spellDisabledFiles);
  if (excluded.has(file)) excluded.delete(file);
  else excluded.add(file);
  config.settings.spellDisabledFiles = [...excluded];
  await persistConfig('project');
  toast(
    excluded.has(file)
      ? 'Spell checking disabled for this file'
      : 'Spell checking enabled for this file',
  );
});
register('settings', 'Open editor settings', 'Preferences', () => settings());
register('appearance', 'Customize appearance and colors', 'Preferences', () =>
  settings('appearance'),
);
register('snippets', 'Edit snippets', 'Preferences', () => settings('snippets'));
register('keyboard', 'Edit keyboard shortcuts', 'Preferences', () => settings('keyboard'));
register('profiles', 'Manage configuration profiles', 'Preferences', () => settings('profiles'));
register('toggleSnippets', 'Pause / resume automatic snippets', 'Editing', async () => {
  config.settings.autoSnippets = !config.settings.autoSnippets;
  await persistConfig();
});
register('toggleSidebar', 'Toggle project sidebar', 'View', () =>
  document.body.classList.toggle('hide-sidebar'),
);
register('togglePreview', 'Toggle PDF preview', 'View', togglePreview);
register('detachPdf', 'Detach PDF window', 'View', () => pdfWorkspace.detach());
register('attachPdf', 'Reattach PDF window', 'View', () => pdfWorkspace.attach());
register('sourceToPdf', 'Show source in PDF (SyncTeX)', 'Navigation', async () => {
  if (!native) {
    toast('SyncTeX requires the desktop app and a local TeX installation.');
    return;
  }
  if (practice.isOpen) {
    toast('SyncTeX is available for project source files.');
    return;
  }
  if (!active) return;
  $('#preview').hidden = false;
  if (!pdfPreview.loaded) await refreshPdf();
  const id = pdfPreview.syncId;
  if (!id) throw new Error('No SyncTeX map for this PDF. Rebuild with -synctex=1.');
  const state = editor.view.state,
    pos = state.selection.main.head,
    line = state.doc.lineAt(pos);
  const point = await host.syncForward(
    id,
    active,
    line.number,
    pos - line.from + 1,
    state.doc.toString(),
  );
  if (pdfPreview.syncId !== id || editor.view.state.doc !== state.doc) return;
  pdfPreview.showSync(point);
});
register('refreshPdf', 'Refresh PDF preview', 'Build', refreshPdf);
register('toggleBuild', 'Toggle build output', 'View', () => {
  $('#build-panel').hidden = !$('#build-panel').hidden;
});
register('build', 'Build document', 'Build', () => build());
register('toggleLive', 'Toggle live preview', 'Build', () => {
  if (live.enabled) {
    stopLive();
    return;
  }
  if (!native || !project.root || !active) {
    toast('Open a project in the desktop app first.');
    return;
  }
  if (building) {
    toast('Wait for the manual build to finish.');
    return;
  }
  $('#preview').hidden = false;
  $('#live-status').hidden = false;
  $('#live-toggle').textContent = 'Live on';
  $('#live-toggle').setAttribute('aria-pressed', 'true');
  lastLiveEdit = performance.now();
  live.setEnabled(true);
});
register('liveDetails', 'Show live preview diagnostics', 'Build', () => {
  modal(
    'Live preview',
    `<div class="dialog-body"><p>Unsaved buffers compile in a scratch project. Your source files are not saved by live preview. A manual Build stops live mode and makes the normal saved PDF.</p><p>Latest timings: ${esc(JSON.stringify(liveSamples.at(-1) || {}))}</p><pre class="live-log">${esc(liveLog || 'No live compilation yet.')}</pre></div>`,
  );
});

register('cancelBuild', 'Stop compilation', 'Build', () => host.cancelBuild());
register('projectSearch', 'Search entire project', 'Search', () => {
  sidebarTab = 'search';
  document.body.classList.remove('hide-sidebar');
  renderSidebar();
  $('#project-query').focus();
});
for (const [id, name] of [
  ['search', 'Find / replace in current file'],
  ['nextPlaceholder', 'Next snippet placeholder'],
  ['previousPlaceholder', 'Previous snippet placeholder'],
  ['undo', 'Undo'],
  ['redo', 'Redo'],
  ['selectNext', 'Select next occurrence'],
  ['selectAllMatches', 'Select all occurrences'],
  ['complete', 'Show completions'],
])
  register(id, name, 'Editing', () => commandEditor().action(id));
// Tab must fall through to completion or indentation when no custom action handles it.
const originalRun = commands.find((c) => c.id === 'nextPlaceholder')!;
originalRun.run = () => commandEditor().action('nextPlaceholder');
for (const [id, name, cmd] of [
  ['wrapBold', 'Wrap selections in bold math', '\\mathbf'],
  ['wrapRoot', 'Wrap selections in square root', '\\sqrt'],
  ['wrapText', 'Wrap selections in text', '\\text'],
  ['wrapBraces', 'Wrap selections in braces', ''],
  ['wrapSup', 'Wrap selections in superscript', '^'],
  ['wrapSub', 'Wrap selections in subscript', '_'],
])
  register(id, name, 'Mathematics', () => commandEditor().wrap(cmd));
register('selectTerm', 'Select term / extend selection left', 'Editing', () =>
  commandEditor().selectTerm(),
);
for (const [id, name] of [
  ['cutTerm', 'Cut selection or left term'],
  ['cutBraces', 'Cut contents of enclosing braces'],
  ['pasteClipboard', 'Paste from clipboard'],
] as const)
  register(id, name, 'Editing', () => commandEditor().clipboardAction(id, host));
register('insertFraction', 'Insert a fraction', 'Mathematics', () =>
  commandEditor().insertTemplate('\\frac{${1}}{${2}}$0'),
);
register('insertEnvironment', 'Insert environment pair', 'Mathematics', async () => {
  const env = await promptDialog('Insert environment', 'Environment name', 'align');
  if (env && /^[a-zA-Z*]+$/.test(env))
    commandEditor().insertTemplate(`\\begin{${env}}\n  \${1}\n\\end{${env}}$0`);
});
register('newFile', 'Create file', 'Project', async () => {
  const path = await promptDialog('Create file', 'Project-relative filename', 'untitled.tex');
  if (!path) return;
  project.entries = await host.create(path, false);
  await openFile(path);
});
register('newFolder', 'Create folder', 'Project', async () => {
  const path = await promptDialog('Create folder', 'Project-relative folder name');
  if (path) {
    project.entries = await host.create(path, true);
    renderSidebar();
  }
});
register('fileActions', 'Current file actions', 'File', () => active && fileMenu(active));
register('renameFolder', 'Rename folder', 'Project', async () => {
  const path = await promptDialog('Rename folder', 'Existing project-relative folder');
  if (!path) return;
  if (tabs.some((t) => t.path.startsWith(path + '/') && t.dirty))
    throw Error('Save files in this folder before renaming it.');
  const next = await promptDialog('Rename folder', 'New project-relative folder');
  if (!next) return;
  project.entries = await host.rename(path, next);
  for (const t of tabs)
    if (t.path.startsWith(path + '/')) t.path = next + t.path.slice(path.length);
  if (active.startsWith(path + '/')) active = next + active.slice(path.length);
  renderTabs();
  renderSidebar();
});
register('recentProjects', 'Open a recent project', 'Project', async () => {
  const recent = await host.recent();
  const d = modal(
    'Recent projects',
    `<div class="menu-actions">${recent.map((p, i) => `<button data-recent="${i}">${icon('folder')} ${esc(p)}</button>`).join('') || '<p>No recent projects yet.</p>'}</div>`,
  );
  document.querySelectorAll('[data-recent]').forEach(
    (el) =>
      ((el as HTMLElement).onclick = () => {
        d.close();
        guard(() => openProject(recent[Number((el as HTMLElement).dataset.recent)]));
      }),
  );
});
register('exportFile', 'Download current .tex file', 'File', () => {
  if (current()) download(active.split('/').at(-1)!, editor.view.state.doc.toString());
});
register('importFile', 'Import a .tex file', 'File', async () => {
  const text = await upload('.tex,.bib,.txt');
  if (text === null) return;
  const name = await promptDialog(
    'Import file',
    'Save as project-relative filename',
    'imported.tex',
  );
  if (!name) return;
  await host.write(name, text, null);
  project.entries = await host.list();
  await openFile(name);
});
register('reloadConfig', 'Reload configuration from disk', 'Preferences', loadConfiguration);
register('runMacro', 'Run a custom macro', 'Editing', () => {
  const d = modal(
    'Custom macros',
    `<div class="menu-actions">${config.macros.map((m, i) => `<button data-macro="${i}">${esc(m.name)}</button>`).join('') || '<p>Add declarative macros in Profiles & JSON. Steps accept {"insert":"text"} or {"command":"nextArgument"}.</p>'}</div>`,
  );
  document.querySelectorAll('[data-macro]').forEach(
    (el) =>
      ((el as HTMLElement).onclick = () => {
        d.close();
        const m = config.macros[Number((el as HTMLElement).dataset.macro)];
        for (const step of m.steps) {
          if ('insert' in step) commandEditor().insertTemplate(step.insert);
          else if (step.command !== 'runMacro') run(step.command);
        }
      }),
  );
});
register('goDefinition', 'Go to definition of label or command', 'Navigation', () => {
  const pos = editor.view.state.selection.main.head;
  const text = editor.view.state.doc.toString();
  const left = text.slice(0, pos).match(/[\w:\\-]*$/)?.[0] || '';
  const right = text.slice(pos).match(/^[\w:-]*/)?.[0] || '';
  const name = left + right;
  const symbol = symbols.find((s) => s.name === name);
  if (symbol) return openFile(symbol.path, symbol.from);
  toast('No project definition found at the cursor');
});
app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!el) return;
  if (el.dataset.command) run(el.dataset.command);
  else if (el.dataset.side) {
    sidebarTab = el.dataset.side;
    document.body.classList.remove('hide-sidebar');
    renderSidebar();
  } else if (el.dataset.file) guard(() => openFile(el.dataset.file!));
  else if (el.dataset.close) guard(() => closeFile(el.dataset.close));
  else if (el.dataset.folder) {
    const p = el.dataset.folder;
    collapsed.has(p) ? collapsed.delete(p) : collapsed.add(p);
    renderSidebar();
  } else if (el.dataset.fileMenu) guard(() => fileMenu(el.dataset.fileMenu!));
  else if (el.dataset.jump) guard(() => openFile(el.dataset.path!, Number(el.dataset.jump)));
});
document.addEventListener('keydown', (e) => {
  if ($<HTMLDialogElement>('#dialog').open || practice.isOpen || editor.view.hasFocus) return;
  if ((e.ctrlKey || e.metaKey) && ['p', 'o', 's'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    run(
      e.key.toLowerCase() === 'p'
        ? e.shiftKey
          ? 'palette'
          : 'quickOpen'
        : e.key.toLowerCase() === 'o'
          ? 'openProject'
          : 'save',
    );
  }
});
host.onBuildOutput((s) => {
  output = (output + s).slice(-250000);
  $('#build-output').textContent = output;
  $('#build-output').scrollTop = $('#build-output').scrollHeight;
});
host.onBuildDone((result) => {
  building = false;
  document.body.classList.remove('building');
  $('#build-result').textContent = result.code === 0 ? 'Completed' : 'Failed';
  const errors = [...output.matchAll(/(?:^|\n)([^\n:]+\.tex):(\d+):\s*([^\n]+)/g)];
  $('#diagnostics').innerHTML = errors
    .map(
      (m) =>
        `<button class="diagnostic" data-diagnostic="${esc(m[1])}" data-line="${m[2]}">${esc(m[1])}:${m[2]} — ${esc(m[3])}</button>`,
    )
    .join('');
  document.querySelectorAll('[data-diagnostic]').forEach(
    (el) =>
      ((el as HTMLElement).onclick = () =>
        guard(async () => {
          const p = (el as HTMLElement).dataset.diagnostic!.replace(/^\.\//, '');
          await openFile(p);
          editor.jump(
            editor.view.state.doc.line(
              Math.min(editor.view.state.doc.lines, Number((el as HTMLElement).dataset.line)),
            ).from,
          );
        })),
  );
  if (result.code === 0) guard(refreshPdf);
});
let watchTimer: ReturnType<typeof setTimeout>;
host.onChange((path) => {
  if (!path.startsWith('.quill/')) requestLive();
  if (path.startsWith('.quill/')) {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => guard(loadConfiguration), 300);
    return;
  }
  guard(async () => {
    const tab = tabs.find((t) => t.path === path);
    if (tab) {
      try {
        const disk = await host.read(path);
        if (disk.version !== tab.version) {
          if (tab.dirty) {
            tab.conflict = true;
            toast(path + ' changed on disk. Use File actions to reload or save a copy.');
          } else {
            tab.state = editor.state(disk.text);
            tab.saved = disk.text;
            tab.version = disk.version;
            if (active === path) editor.load(tab.state);
          }
          updateStatus();
        }
      } catch {
        tab.conflict = true;
        toast(path + ' was removed from disk.');
      }
    }
    project.entries = await host.list();
    renderSidebar();
  });
});
host.onClosing(() =>
  guard(async () => {
    await storeRecovery();
    if (
      tabs.some((t) => t.dirty) &&
      !(await confirmDialog(
        'Close Quill?',
        'Unsaved writing has been saved to recovery and can be restored next time.',
        'Close & keep recovery',
      ))
    )
      return;
    await host.close();
  }),
);
window.addEventListener('beforeunload', () => {
  if (!native) void storeRecovery();
});
async function start() {
  recovery = await host.loadRecovery();
  if (native) {
    await loadConfiguration();
    project = { name: 'No project open', root: '', entries: [] };
    $('#project-name').textContent = 'Open a project';
    $('#folder-title').textContent = 'No project open';
    editor.load(
      editor.state(
        '% Welcome to Quill.\n% Press Ctrl+O to open a project folder.\n% Press Ctrl+Shift+P to explore commands.\n',
      ),
    );
    editor.lock(true);
    renderSidebar();
  } else await loadProject((await host.openProject())!);
  if (!native && active === 'main.tex') editor.jump(0);
}
guard(start);
