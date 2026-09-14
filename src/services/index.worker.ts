import { indexDocument } from '../core/indexer';
self.onmessage = (e: MessageEvent<{ path: string; text: string; version: number }>) => {
  const { path, text, version } = e.data;
  self.postMessage({ path, version, symbols: indexDocument(path, text) });
};
