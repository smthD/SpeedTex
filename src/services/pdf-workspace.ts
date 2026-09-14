import { PdfPreview, type Position } from './pdf-preview';

/** Move the actual reader DOM between windows; keep its PDF and render queue alive. */
export class PdfWorkspace {
  private popup?: Window;
  private popupWatch?: ReturnType<typeof setInterval>;
  private detachedPosition?: Position;
  private placeholder = document.createElement('div');
  private splitter = document.createElement('div');
  private ratio = 0.45;
  constructor(
    private pane: HTMLElement,
    private content: HTMLElement,
    private reader: PdfPreview,
    private run: (id: string) => boolean,
    private error: (message: string) => void,
  ) {
    try {
      const ratio = Number(localStorage.getItem('quill.pdf.split'));
      if (ratio >= 0.2 && ratio <= 0.8) this.ratio = ratio;
    } catch {}
    this.splitter.className = 'pdf-splitter';
    this.splitter.tabIndex = 0;
    this.splitter.setAttribute('role', 'separator');
    this.splitter.setAttribute('aria-label', 'Resize PDF pane');
    this.splitter.setAttribute('aria-orientation', 'vertical');
    pane.before(this.splitter);
    let dragging = false;
    this.splitter.onpointerdown = (e) => {
      if (e.button !== 0) return;
      dragging = true;
      this.splitter.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    this.splitter.onpointermove = (e) => {
      if (!dragging) return;
      const rect = pane.parentElement!.getBoundingClientRect();
      this.ratio = (rect.right - e.clientX) / rect.width;
      this.resize();
    };
    this.splitter.onpointerup = (e) => {
      dragging = false;
      this.splitter.releasePointerCapture(e.pointerId);
      this.save();
    };
    this.splitter.onlostpointercapture = () => {
      dragging = false;
    };
    this.splitter.onkeydown = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      this.ratio =
        e.key === 'Home'
          ? 0.2
          : e.key === 'End'
            ? 0.8
            : this.ratio + (e.key === 'ArrowLeft' ? 0.025 : -0.025);
      this.resize();
      this.save();
    };
    this.splitter.ondblclick = () => {
      this.ratio = 0.45;
      this.resize();
      this.save();
    };
    new ResizeObserver(() => this.resize()).observe(pane.parentElement!);
    new MutationObserver(() => {
      this.splitter.hidden = pane.hidden || !!this.popup;
    }).observe(pane, { attributes: true, attributeFilter: ['hidden'] });
    this.placeholder.className = 'pdf-detached-placeholder';
    this.placeholder.innerHTML =
      '<span>PDF detached</span><button class="secondary" data-focus-pdf>Show window</button><button class="secondary" data-attach-pdf>Reattach</button>';
    this.placeholder.querySelector<HTMLButtonElement>('[data-focus-pdf]')!.onclick = () =>
      this.popup?.focus();
    this.placeholder.querySelector<HTMLButtonElement>('[data-attach-pdf]')!.onclick = () =>
      this.attach();
    new MutationObserver(() => this.syncColors()).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme'],
    });
    window.addEventListener('beforeunload', () => {
      clearInterval(this.popupWatch);
      const popup = this.popup;
      this.popup = undefined;
      popup?.close();
    });
    this.resize();
  }
  private save() {
    try {
      localStorage.setItem('quill.pdf.split', String(this.ratio));
    } catch {}
  }
  private resize() {
    this.ratio = Math.min(0.8, Math.max(0.2, this.ratio));
    const available = this.pane.parentElement!.clientWidth;
    const width = Math.max(260, Math.min(available - 220, available * this.ratio));
    this.pane.style.width = width + 'px';
    this.splitter.setAttribute('aria-valuenow', String(Math.round(this.ratio * 100)));
    this.splitter.setAttribute('aria-valuemin', '20');
    this.splitter.setAttribute('aria-valuemax', '80');
    this.splitter.hidden = this.pane.hidden || !!this.popup;
  }
  private syncColors() {
    if (!this.popup || this.popup.closed) return;
    this.popup.document.documentElement.style.cssText = document.documentElement.style.cssText;
    this.popup.document.documentElement.dataset.theme = 'dark';
  }
  detach() {
    if (this.popup && !this.popup.closed) {
      this.popup.focus();
      return;
    }
    const popup = window.open(
      'about:blank',
      'quill-pdf',
      'popup,width=800,height=900,resizable=yes',
    );
    if (!popup) {
      this.error('Allow the PDF popup to detach the viewer.');
      return;
    }
    const position = this.reader.capturePosition();
    this.popup = popup;
    this.detachedPosition = position;
    this.popupWatch = setInterval(() => {
      if (this.popup !== popup) return;
      if (popup.closed) this.attach(false);
      else this.detachedPosition = this.reader.capturePosition();
    }, 250);
    popup.document.title = 'Quill — PDF';
    const style = popup.document.createElement('style');
    style.textContent = Array.from(document.styleSheets)
      .map((sheet) => {
        try {
          return Array.from(sheet.cssRules)
            .map((rule) => rule.cssText)
            .join('\n');
        } catch {
          return '';
        }
      })
      .join('\n');
    popup.document.head.append(style);
    popup.document.body.innerHTML =
      '<main class="pdf-detached-root"><header class="preview-header"><strong>PDF PREVIEW</strong><div><button class="secondary" data-attach>Reattach</button></div></header></main>';
    this.syncColors();
    this.pane.append(this.placeholder);
    popup.document.querySelector('main')!.append(this.content);
    popup.document.querySelector<HTMLButtonElement>('[data-attach]')!.onclick = () => this.attach();
    popup.document.addEventListener('click', (e) => {
      const button = (e.target as Element).closest<HTMLElement>('[data-command]');
      if (button?.dataset.command) this.run(button.dataset.command);
    });
    popup.addEventListener('beforeunload', () => {
      if (this.popup === popup) this.attach(false);
    });
    this.splitter.hidden = true;
    this.pane.classList.add('pdf-is-detached');
    this.reader.restorePosition(position);
    popup.focus();
  }
  attach(close = true) {
    const popup = this.popup;
    if (!popup) return;
    const position =
      popup.closed && this.detachedPosition ? this.detachedPosition : this.reader.capturePosition();
    clearInterval(this.popupWatch);
    this.popup = undefined;
    this.pane.append(this.content);
    this.placeholder.remove();
    this.pane.classList.remove('pdf-is-detached');
    this.pane.hidden = false;
    this.resize();
    this.reader.restorePosition(position);
    if (close && !popup.closed) popup.close();
  }
}
