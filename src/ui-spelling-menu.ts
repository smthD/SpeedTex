import type { EditorView } from '@codemirror/view';

let closeCurrent: (() => void) | undefined;
/** Native popover stays above the practice dialog without blocking the editor. */
export function spellingMenu(view: EditorView, from: number, content: string) {
  closeCurrent?.();
  const menu = document.createElement('div');
  menu.className = 'spelling-menu';
  // Native auto-popover dismissal can interpret the opening right-button
  // release as an outside click. Dismiss on a new pointer press instead.
  menu.setAttribute('popover', 'manual');
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Spelling suggestions');
  menu.innerHTML = content;
  const owner = view.dom.closest('dialog');
  (owner || document.body).append(menu);
  const controller = new AbortController();
  const close = (restoreFocus = false) => {
    controller.abort();
    if (menu.matches(':popover-open')) menu.hidePopover();
    menu.remove();
    if (closeCurrent === dismiss) closeCurrent = undefined;
    if (restoreFocus && view.dom.isConnected) view.focus();
  };
  const dismiss = () => close();
  closeCurrent = dismiss;
  const buttons = () =>
    Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  menu.addEventListener('keydown', (event) => {
    if (['Escape', 'Tab'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = buttons();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  });
  menu.addEventListener('toggle', () => {
    if (!menu.matches(':popover-open')) close();
  });
  menu.showPopover();
  const anchor = view.coordsAtPos(from);
  if (!anchor) {
    close();
    return { menu, close };
  }
  const box = menu.getBoundingClientRect();
  const top =
    anchor.bottom + box.height + 6 <= window.innerHeight
      ? anchor.bottom + 5
      : anchor.top - box.height - 5;
  menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  buttons()[0]?.focus({ preventScroll: true });
  document.addEventListener(
    'scroll',
    (event) => {
      if (!(event.target instanceof Node) || !menu.contains(event.target)) close();
    },
    { capture: true, signal: controller.signal },
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.composedPath().includes(menu)) close();
    },
    { capture: true, signal: controller.signal },
  );
  window.addEventListener('resize', dismiss, { signal: controller.signal });
  owner?.addEventListener('close', dismiss, { signal: controller.signal });
  return { menu, close };
}
