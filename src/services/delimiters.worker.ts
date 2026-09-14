import { indexDelimiters } from '../core/delimiter-highlighting';
self.onmessage = ({ data }: MessageEvent<{ id: number; text: string }>) =>
  self.postMessage({ id: data.id, index: indexDelimiters(data.text) });
