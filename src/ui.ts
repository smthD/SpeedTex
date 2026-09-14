export const escape = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const paths: Record<string, string> = {
  practice: 'M9 3h6m-3 0v3m7 1 2 2M12 7a7 7 0 1 0 0 14 7 7 0 0 0 0-14m0 3v4l3 2',
  folder: 'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3Z',
  file: 'M6 3h8l4 4v14H6Z M14 3v5h4',
  search: 'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
  chevron: 'm9 5 7 7-7 7',
  down: 'm5 9 7 7 7-7',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  play: 'm7 4 14 8-14 8Z',
  panel: 'M3 4h18v16H3ZM14 4v16',
  book: 'M12 5v16M12 5C9 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-4-2-7-1-10 1Z',
  spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z',
  check: 'm5 12 4 4L19 6',
  terminal: 'm4 6 6 6-6 6m9 0h7',
  keyboard: 'M2 5h20v14H2ZM5 9h1m3 0h1m3 0h1m3 0h1M5 13h1m3 0h1m3 0h1m3 0h1M7 16h10',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  pin: 'm8 3 8 0-1 6 4 4H5l4-4Zm4 10v8',
  refresh: 'M20 10a8 8 0 1 0 0 5M20 3v7h-7',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  moon: 'M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12',
};
export function icon(name: string, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
}
export function button(id: string, label: string, ic?: string, cls = '') {
  return `<button data-command="${id}" class="${cls}" aria-label="${escape(label)}" title="${escape(label)}">${ic ? icon(ic) : ''}<span>${escape(label)}</span></button>`;
}
export function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function upload(accept = '.json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
