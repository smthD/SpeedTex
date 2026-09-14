const { contextBridge, ipcRenderer } = require('electron');
const call =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args);
const on = (channel, cb) => {
  const listener = (_, value) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('quill', {
  readClipboard: call('clipboard:read'),
  writeClipboard: call('clipboard:write'),
  openProject: call('project:open'),
  recent: call('project:recent'),
  openRecent: call('project:openRecent'),
  list: call('project:list'),
  read: call('file:read'),
  write: call('file:write'),
  create: call('file:create'),
  rename: call('file:rename'),
  trash: call('file:trash'),
  loadDictionaries: call('dictionary:load'),
  saveDictionary: call('dictionary:save'),
  loadConfig: call('config:load'),
  saveConfig: call('config:save'),
  loadRecovery: call('recovery:load'),
  saveRecovery: call('recovery:save'),
  build: call('build:start'),
  liveBuild: call('live:build'),
  cancelLive: call('live:cancel'),
  cancelBuild: call('build:cancel'),
  readPdf: call('pdf:read'),
  readPreview: call('sync:read'),
  retainSync: call('sync:retain'),
  syncForward: call('sync:forward'),
  syncInverse: call('sync:inverse'),
  focusEditor: call('sync:focus'),
  close: call('app:close'),
  onChange: (cb) => on('project:changed', cb),
  onBuildOutput: (cb) => on('build:output', cb),
  onBuildDone: (cb) => on('build:done', cb),
  onClosing: (cb) => on('app:closing', cb),
});
