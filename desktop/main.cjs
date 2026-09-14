const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const fs = require('node:fs/promises');
const nodefs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const files = require('./files.cjs');
const { LiveCompiler } = require('./live-compiler.cjs');
const { SyncTexStore } = require('./synctex.cjs');
const syncTex = new SyncTexStore();
const liveCompiler = new LiveCompiler();
liveCompiler.capture = (root, cwd, pdfPath) => syncTex.capture(root, cwd, pdfPath);
let win,
  root = null,
  watcher = null,
  building = null,
  allowClose = false;
const writes = new Map();
function cancelBuild() {
  if (!building) return;
  try {
    if (process.platform !== 'win32') process.kill(-building.pid, 'SIGTERM');
    else building.kill('SIGTERM');
  } catch {}
}
const data = () => app.getPath('userData');
const configDir = () => path.join(data(), 'configuration');
async function jsonRead(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}
async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify(value, null, 2));
  await fs.rename(file + '.tmp', file);
}
function requireRoot() {
  if (!root) throw Error('Open a project first.');
  return root;
}
async function openProject(selected) {
  if (!selected) {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled) return null;
    selected = result.filePaths[0];
  }
  liveCompiler.cancel();
  root = await fs.realpath(selected);
  watcher?.close();
  try {
    watcher = nodefs.watch(root, { recursive: true }, (_, name) => {
      if (
        name &&
        !String(name).includes('.quill-') &&
        (/\.(tex|bib|sty|cls|md|txt|json)$/.test(String(name)) || !path.extname(String(name)))
      )
        win.webContents.send('project:changed', String(name));
    });
  } catch {}
  const recent = await jsonRead(path.join(data(), 'recent.json'), []);
  await atomic(
    path.join(data(), 'recent.json'),
    [root, ...recent.filter((x) => x !== root)].slice(0, 12),
  );
  return { name: path.basename(root), root, entries: await files.list(root) };
}
const handle = (name, fn) =>
  ipcMain.handle(name, async (e, ...args) => {
    if (e.sender !== win.webContents) throw Error('Invalid sender');
    return fn(...args);
  });
app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#141817',
    title: 'Quill',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '../dist/index.html'));
  win.webContents.setWindowOpenHandler(({ url, frameName }) =>
    url === 'about:blank' && frameName === 'quill-pdf'
      ? {
          action: 'allow',
          overrideBrowserWindowOptions: {
            title: 'Quill — PDF',
            width: 800,
            height: 900,
            minWidth: 360,
            minHeight: 300,
            autoHideMenuBar: true,
            backgroundColor: '#090a0c',
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
          },
        }
      : { action: 'deny' },
  );
  win.webContents.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false);
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setBackgroundThrottling(false);
    const closeChild = () => {
      if (!child.isDestroyed()) child.destroy();
    };
    child.on('closed', () => {
      win.removeListener('closed', closeChild);
      if (!win.isDestroyed()) win.webContents.setBackgroundThrottling(true);
    });
    win.once('closed', closeChild);
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!allowClose) {
      e.preventDefault();
      win.webContents.send('app:closing');
    }
  });
  handle('clipboard:read', () => clipboard.readText());
  handle('clipboard:write', (text) => {
    if (typeof text !== 'string') throw Error('Clipboard content must be text');
    return clipboard.writeText(text);
  });
  handle('app:close', () => {
    allowClose = true;
    win.close();
  });
  handle('project:open', () => openProject());
  handle('project:recent', () => jsonRead(path.join(data(), 'recent.json'), []));
  handle('project:openRecent', async (p) => {
    const recent = await jsonRead(path.join(data(), 'recent.json'), []);
    if (!recent.includes(p)) throw Error('Unknown recent project');
    return openProject(p);
  });
  handle('project:list', () => files.list(requireRoot()));
  handle('file:read', (p) => files.read(requireRoot(), p));
  handle('file:write', async (p, text, version) => {
    const r = requireRoot(),
      key = r + '/' + p;
    const previous = writes.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => files.write(r, p, text, version));
    writes.set(key, next);
    try {
      return await next;
    } finally {
      if (writes.get(key) === next) writes.delete(key);
    }
  });
  handle('file:create', async (p, directory) => {
    const target = await files.resolveInside(requireRoot(), p, true);
    if (directory) await fs.mkdir(target);
    else await fs.writeFile(target, '', { flag: 'wx' });
    return files.list(root);
  });
  handle('file:rename', async (a, b) => {
    const r = requireRoot(),
      src = await files.resolveInside(r, a),
      dest = await files.resolveInside(r, b, true);
    if (src === r) throw Error('Cannot rename project root');
    try {
      await fs.access(dest);
      throw Error('Destination already exists');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    await fs.rename(src, dest);
    return files.list(r);
  });
  handle('file:trash', async (p) => {
    const target = await files.resolveInside(requireRoot(), p);
    if (target === root) throw Error('Cannot delete project root');
    await shell.trashItem(target);
    return files.list(root);
  });
  handle('dictionary:load', async () => ({
    global: await jsonRead(path.join(configDir(), 'dictionary.json'), []),
    project: await (async () => {
      if (!root) return [];
      try {
        return await jsonRead(await files.resolveInside(root, '.quill/dictionary.json', true), []);
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    })(),
  }));
  handle('dictionary:save', async (words, scope) => {
    if (
      !['global', 'project'].includes(scope) ||
      !Array.isArray(words) ||
      words.length > 10000 ||
      words.some((w) => typeof w !== 'string' || !/^[\p{L}][\p{L}'’\-]{0,79}$/u.test(w))
    )
      throw Error('Invalid dictionary.');
    if (scope === 'project') {
      const r = requireRoot();
      await files.resolveInside(r, '.quill', true);
      await fs.mkdir(path.join(r, '.quill'), { recursive: true });
      await atomic(await files.resolveInside(r, '.quill/dictionary.json', true), words);
    } else await atomic(path.join(configDir(), 'dictionary.json'), words);
  });
  handle('config:load', async () => {
    const dir = configDir();
    const global = await jsonRead(path.join(dir, 'settings.json'), null);
    if (global) {
      global.snippets = await jsonRead(path.join(dir, 'snippets.json'), []);
      global.keybindings = await jsonRead(path.join(dir, 'keybindings.json'), []);
    }
    const project = root ? await jsonRead(path.join(root, '.quill/settings.json'), null) : null;
    return { global, project };
  });
  handle('config:save', async (config, scope) => {
    if (scope === 'project') {
      const r = requireRoot();
      await files.resolveInside(r, '.quill', true);
      await fs.mkdir(path.join(r, '.quill'), { recursive: true });
      const target = await files.resolveInside(r, '.quill/settings.json', true);
      await atomic(target, config);
      return;
    }
    const { snippets, keybindings, ...settings } = config;
    await atomic(path.join(configDir(), 'settings.json'), settings);
    await atomic(path.join(configDir(), 'snippets.json'), snippets);
    await atomic(path.join(configDir(), 'keybindings.json'), keybindings);
  });
  handle('recovery:load', () => jsonRead(path.join(data(), 'recovery.json'), []));
  handle('recovery:save', (records) => atomic(path.join(data(), 'recovery.json'), records));
  handle('live:build', (request) => liveCompiler.build(requireRoot(), request));
  handle('live:cancel', () => liveCompiler.cancel());
  handle('build:start', async (settings) => {
    if (building) throw Error('A build is already running.');
    const r = requireRoot();
    await files.resolveInside(r, settings.rootFile);
    if (!['latexmk', 'pdflatex', 'xelatex', 'lualatex'].includes(settings.compiler))
      throw Error('Supported compilers: latexmk, pdflatex, xelatex, lualatex');
    if (
      !Array.isArray(settings.buildArgs) ||
      settings.buildArgs.some(
        (a) =>
          typeof a !== 'string' ||
          !/^-(?:pdf|xelatex|lualatex|interaction=(?:nonstopmode|batchmode|errorstopmode)|file-line-error|synctex=[01]|no-shell-escape|halt-on-error|quiet|silent|verbose|g|gg)$/.test(
            a,
          ),
      )
    )
      throw Error('Unsupported build argument');
    const args = [
      ...(settings.compiler === 'latexmk' ? ['-norc'] : []),
      ...settings.buildArgs,
      '-no-shell-escape',
      settings.rootFile,
    ];
    const child = spawn(settings.compiler, args, {
      cwd: r,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    building = child;
    child.stdout.on('data', (b) => win.webContents.send('build:output', b.toString()));
    child.stderr.on('data', (b) => win.webContents.send('build:output', b.toString()));
    child.on('error', (e) => win.webContents.send('build:output', e.message));
    child.on('close', (code) => {
      building = null;
      win.webContents.send('build:done', { code });
    });
    return { started: true };
  });
  handle('build:cancel', () => {
    cancelBuild();
  });
  handle('sync:read', async (p) => {
    if (typeof p !== 'string' || !p.endsWith('.pdf')) throw Error('Expected PDF');
    const r = requireRoot(),
      target = await files.resolveInside(r, p);
    try {
      return await syncTex.capture(r, r, target);
    } catch {
      return { pdf: new Uint8Array(await fs.readFile(target)), syncId: null };
    }
  });
  handle('sync:retain', (id) => syncTex.retain(requireRoot(), id));
  handle('sync:forward', (id, file, line, column, text) =>
    syncTex.forward(requireRoot(), id, file, line, column, text),
  );
  handle('sync:inverse', (id, page, x, y) => syncTex.inverse(requireRoot(), id, page, x, y));
  handle('sync:focus', () => {
    win.show();
    win.focus();
  });
  handle('pdf:read', async (p) => {
    if (!p.endsWith('.pdf')) throw Error('Expected PDF');
    return new Uint8Array(await fs.readFile(await files.resolveInside(requireRoot(), p)));
  });
});
app.on('window-all-closed', async () => {
  cancelBuild();
  await liveCompiler.dispose();
  await syncTex.dispose();
  app.quit();
});
