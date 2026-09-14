import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface Position {
  page: number;
  fraction: number;
  left: number;
  zoom: string;
}
interface PageView {
  number: number;
  width: number;
  height: number;
  top: number;
  scale: number;
  node: HTMLElement;
  renderedScale?: number;
  toViewport: (x: number, y: number) => number[];
  fromViewport: (x: number, y: number) => number[];
}
interface DocumentView {
  pdf: PDFDocumentProxy;
  pages: PageView[];
  key: string;
  syncId: string | null;
}

/** Persistent reader: page-relative anchors survive replacement PDFs and resizing.
 * The current document stays visible until the new visible pages are rasterized.
 * Only viewport-adjacent canvases are kept, bounding memory for large documents.
 */
export class PdfPreview {
  onSync?: (id: string, page: number, x: number, y: number) => void;
  onPresented?: (id: string | null) => void;
  get syncId() {
    return this.current?.syncId ?? null;
  }
  private current?: DocumentView;
  private request = 0;
  private zoom = 'fit';
  private width = 500;
  private revision = 0;
  private pendingAnchor?: Position;
  private renderQueue: Promise<void> = Promise.resolve();
  private raf = 0;
  private persistTimer?: ReturnType<typeof setTimeout>;
  private scroll: HTMLElement;
  private pagesNode: HTMLElement;
  private status: HTMLElement;
  private pageInput: HTMLInputElement;
  private count: HTMLElement;
  private zoomInput: HTMLSelectElement;
  private placeholder: string;

  constructor(
    private container: HTMLElement,
    private onError: (message: string) => void,
  ) {
    this.placeholder = container.innerHTML;
    window.addEventListener('beforeunload', () => this.remember(true));
    container.innerHTML = `<div class="pdf-toolbar" hidden>
      <button data-pdf="previous" aria-label="Previous PDF page">‹</button>
      <input class="pdf-page-number" type="number" min="1" value="1" aria-label="PDF page">
      <span class="pdf-page-count"></span>
      <button data-pdf="next" aria-label="Next PDF page">›</button>
      <button data-pdf="zoom-out" aria-label="Zoom out">−</button><button data-pdf="zoom-in" aria-label="Zoom in">+</button>
      <select aria-label="PDF zoom"><option value="fit">Fit width</option>${[25, 50, 75, 100, 125, 150, 200, 300, 400, 600, 800].map((n) => `<option value="${n}">${n}%</option>`).join('')}</select>
      <span class="pdf-update-status" role="status"></span>
    </div><div class="pdf-scroll" tabindex="0" aria-label="PDF document"><div class="pdf-pages"></div></div>`;
    this.scroll = container.querySelector('.pdf-scroll')!;
    this.pagesNode = container.querySelector('.pdf-pages')!;
    this.pagesNode.innerHTML = this.placeholder;
    this.status = container.querySelector('.pdf-update-status')!;
    this.pageInput = container.querySelector('input')!;
    this.count = container.querySelector('.pdf-page-count')!;
    this.zoomInput = container.querySelector('select')!;
    container
      .querySelector('[data-pdf="previous"]')!
      .addEventListener('click', () => this.goTo(this.anchor().page - 1));
    container
      .querySelector('[data-pdf="next"]')!
      .addEventListener('click', () => this.goTo(this.anchor().page + 1));
    this.pageInput.addEventListener('change', () => this.goTo(Number(this.pageInput.value)));
    this.pageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.goTo(Number(this.pageInput.value));
      }
    });
    this.zoomInput.addEventListener('change', () => this.setZoom(this.zoomInput.value));
    container
      .querySelector('[data-pdf="zoom-in"]')!
      .addEventListener('click', () => this.setZoom(String(this.effectiveZoom() * 1.25)));
    container
      .querySelector('[data-pdf="zoom-out"]')!
      .addEventListener('click', () => this.setZoom(String(this.effectiveZoom() / 1.25)));
    this.scroll.title =
      'Ctrl+click: go to source · Middle-click: zoom in · Shift+middle-click: zoom out · Middle-drag: pan · Ctrl+wheel: zoom';
    this.scroll.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    this.scroll.addEventListener('click', (event) => {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return;
      const node = (event.target as HTMLElement).closest<HTMLElement>('.pdf-page');
      const page = this.current?.pages.find((p) => p.node === node);
      if (!page) return;
      event.preventDefault();
      if (!this.current?.syncId) {
        this.onError('No SyncTeX map for this PDF. Rebuild with -synctex=1.');
        return;
      }
      const rect = page.node.getBoundingClientRect();
      const [x, y] = page.fromViewport(
        (event.clientX - rect.left) / page.scale,
        (event.clientY - rect.top) / page.scale,
      );
      this.onSync?.(this.current.syncId, page.number, x, y);
    });
    let drag:
      | {
          id: number;
          x: number;
          y: number;
          zoom: number;
          left: number;
          top: number;
          moved: boolean;
        }
      | undefined;
    this.scroll.addEventListener('pointerdown', (e) => {
      if (e.button !== 1 || !this.current) return;
      e.preventDefault();
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        zoom: this.effectiveZoom(),
        left: this.scroll.scrollLeft,
        top: this.scroll.scrollTop,
        moved: false,
      };
      this.scroll.setPointerCapture(e.pointerId);
      this.scroll.classList.add('pdf-panning');
    });
    this.scroll.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.moved) {
        this.scroll.scrollLeft = drag.left - dx;
        this.scroll.scrollTop = drag.top - dy;
      }
    });
    this.scroll.addEventListener('pointerup', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (!drag.moved) this.setZoom(String(drag.zoom * (e.shiftKey ? 0.5 : 2)), drag.x, drag.y);
      this.scroll.releasePointerCapture(e.pointerId);
      drag = undefined;
      this.scroll.classList.remove('pdf-panning');
    });
    this.scroll.addEventListener('lostpointercapture', () => {
      drag = undefined;
      this.scroll.classList.remove('pdf-panning');
    });
    this.scroll.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.setZoom(
          String(this.effectiveZoom() * Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) / 300)),
          e.clientX,
          e.clientY,
        );
      },
      { passive: false },
    );
    this.scroll.addEventListener(
      'scroll',
      () => {
        this.updatePage();
        this.remember();
        this.schedule();
      },
      { passive: true },
    );
    new ResizeObserver(() => {
      if (!this.scroll.clientWidth) return;
      const width = this.scroll.clientWidth;
      if (Math.abs(width - this.width) > 1) {
        const anchor = this.anchor();
        this.width = width;
        if (this.current) {
          this.layout(this.current);
          this.restore(anchor);
        }
      }
      if (this.pendingAnchor) this.restore(this.pendingAnchor);
      this.schedule();
    }).observe(this.scroll);
  }

  capturePosition(): Position {
    return this.anchor();
  }
  restorePosition(position: Position) {
    this.zoom = position.zoom;
    this.syncZoomInput();
    this.width = this.scroll.clientWidth || this.width;
    if (this.current) this.layout(this.current);
    this.restore(position);
    this.schedule();
  }
  private effectiveZoom() {
    return this.current?.pages[this.anchor().page - 1]?.scale! * 100 || 100;
  }
  private syncZoomInput() {
    this.zoomInput.querySelector('[data-custom]')?.remove();
    if (!Array.from(this.zoomInput.options).some((o) => o.value === this.zoom)) {
      const option = document.createElement('option');
      option.value = this.zoom;
      option.textContent = this.zoom + '%';
      option.dataset.custom = 'true';
      this.zoomInput.append(option);
    }
    this.zoomInput.value = this.zoom;
  }
  private setZoom(value: string, clientX?: number, clientY?: number) {
    if (!this.current) return;
    if (value !== 'fit' && !Number.isFinite(Number(value))) return;
    const box = this.scroll.getBoundingClientRect();
    clientX ??= box.left + this.scroll.clientWidth / 2;
    clientY ??= box.top + this.scroll.clientHeight / 2;
    const page =
      this.current.pages.find((p) => {
        const rect = p.node.getBoundingClientRect();
        return rect.bottom >= clientY && rect.top <= clientY;
      }) || this.current.pages[this.anchor().page - 1];
    const before = page.node.getBoundingClientRect();
    const x = (clientX - before.left) / page.scale,
      y = (clientY - before.top) / page.scale;
    this.zoom =
      value === 'fit' ? 'fit' : String(Math.round(Math.min(800, Math.max(25, Number(value)))));
    this.syncZoomInput();
    this.layout(this.current);
    const after = page.node.getBoundingClientRect();
    this.scroll.scrollLeft += after.left + x * page.scale - clientX;
    this.scroll.scrollTop += after.top + y * page.scale - clientY;
    this.schedule();
    this.remember();
    this.updatePage();
  }
  get loaded() {
    return !!this.current;
  }
  private anchor(): Position {
    if (this.pendingAnchor) return { ...this.pendingAnchor, zoom: this.zoom };
    if (!this.current) return { page: 1, fraction: 0, left: 0, zoom: this.zoom };
    const top = this.scroll.scrollTop;
    const page =
      this.current.pages.find((p) => p.top + p.height * p.scale > top) ||
      this.current.pages.at(-1)!;
    return {
      page: page.number,
      fraction: Math.max(0, (top - page.top) / (page.height * page.scale)),
      left: this.scroll.scrollLeft,
      zoom: this.zoom,
    };
  }
  private restore(position: Position) {
    if (!this.current) return;
    if (!this.scroll.clientHeight) {
      this.pendingAnchor = position;
      return;
    }
    this.pendingAnchor = undefined;
    const p =
      this.current.pages[Math.max(0, Math.min(this.current.pages.length - 1, position.page - 1))];
    this.scroll.scrollTop = Math.max(0, p.top + position.fraction * p.height * p.scale);
    this.scroll.scrollLeft = position.left;
    this.updatePage();
  }
  private saved(key: string): Position {
    try {
      const p = JSON.parse(localStorage.getItem('quill.pdf.' + key) || 'null');
      if (
        p &&
        Number.isInteger(p.page) &&
        p.page >= 1 &&
        Number.isFinite(p.fraction) &&
        p.fraction >= 0 &&
        p.fraction <= 1 &&
        Number.isFinite(p.left) &&
        p.left >= 0 &&
        (p.zoom === 'fit' ||
          (typeof p.zoom === 'string' &&
            Number.isFinite(Number(p.zoom)) &&
            Number(p.zoom) >= 25 &&
            Number(p.zoom) <= 800))
      )
        return p;
    } catch {}
    return { page: 1, fraction: 0, left: 0, zoom: 'fit' };
  }
  private remember(immediate = false) {
    if (!this.current || !this.scroll.clientHeight) return;
    clearTimeout(this.persistTimer);
    const key = 'quill.pdf.' + this.current.key;
    const position = JSON.stringify(this.anchor());
    const save = () => {
      try {
        localStorage.setItem(key, position);
      } catch {}
    };
    if (immediate) save();
    else this.persistTimer = setTimeout(save, 150);
  }
  private layout(doc: DocumentView) {
    let top = 16;
    for (const p of doc.pages) {
      p.scale =
        this.zoom === 'fit' ? Math.max(0.1, (this.width - 32) / p.width) : Number(this.zoom) / 100;
      p.top = top;
      p.node.style.width = p.width * p.scale + 'px';
      p.node.style.height = p.height * p.scale + 'px';
      top += p.height * p.scale + 16;
    }
  }
  private visible(doc: DocumentView, top: number) {
    const margin = this.scroll.clientHeight || 600;
    return doc.pages.filter(
      (p) => p.top + p.height * p.scale >= top - margin && p.top <= top + margin * 2,
    );
  }
  private async paint(doc: DocumentView, p: PageView) {
    if (p.renderedScale === p.scale) return;
    const scale = p.scale;
    const page = await doc.pdf.getPage(p.number);
    const pixelRatio = Math.min(this.container.ownerDocument.defaultView?.devicePixelRatio || 1, 2);
    // Cap unusually large pages/zoom levels at 12 megapixels per canvas.
    const ratio = Math.min(
      pixelRatio,
      Math.sqrt(12_000_000 / (p.width * p.height * scale * scale)),
    );
    const viewport = page.getViewport({ scale: scale * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    canvas.setAttribute('aria-hidden', 'true');
    p.node.querySelector('canvas')?.remove();
    p.node.prepend(canvas);
    p.renderedScale = scale;
  }
  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const doc = this.current;
      if (!doc || !this.scroll.clientHeight) return;
      this.renderQueue = this.renderQueue
        .then(async () => {
          if (doc !== this.current) return;
          const wanted = this.visible(doc, this.scroll.scrollTop);
          for (const p of wanted) {
            if (doc !== this.current) return;
            await this.paint(doc, p);
          }
          if (doc !== this.current) return;
          for (const p of doc.pages)
            if (!wanted.includes(p) && p.renderedScale !== undefined) {
              p.node.replaceChildren();
              p.renderedScale = undefined;
            }
        })
        .catch((e) => {
          if (doc === this.current) this.onError('PDF rendering: ' + e.message);
        });
    });
  }
  private updatePage() {
    if (this.current) this.pageInput.value = String(this.anchor().page);
  }
  private goTo(page: number) {
    if (!this.current || !Number.isFinite(page)) return;
    this.restore({
      page: Math.round(page),
      fraction: 0,
      left: this.scroll.scrollLeft,
      zoom: this.zoom,
    });
    this.scroll.focus();
    this.schedule();
  }

  showSync(point: { page: number; x: number; y: number }) {
    const page = this.current?.pages[point.page - 1];
    if (!page) throw new Error('SyncTeX returned a page outside this PDF.');
    this.goTo(point.page);
    const [x, y] = page.toViewport(point.x, point.y);
    const rect = page.node.getBoundingClientRect(),
      viewport = this.scroll.getBoundingClientRect();
    this.scroll.scrollTop +=
      rect.top + y * page.scale - viewport.top - this.scroll.clientHeight * 0.35;
    this.scroll.scrollLeft +=
      rect.left + x * page.scale - viewport.left - this.scroll.clientWidth * 0.5;
    this.pagesNode.querySelectorAll('.pdf-sync-marker').forEach((n) => n.remove());
    const marker = page.node.ownerDocument.createElement('span');
    marker.className = 'pdf-sync-marker';
    marker.title = 'Source position';
    marker.style.left = `${(x / page.width) * 100}%`;
    marker.style.top = `${(y / page.height) * 100}%`;
    page.node.append(marker);
    setTimeout(() => marker.remove(), 3000);
    this.container.ownerDocument.defaultView?.focus();
    this.schedule();
  }

  async load(
    read: () => Promise<Uint8Array | { pdf: Uint8Array; syncId?: string | null }>,
    key: string,
    isCurrent: () => boolean = () => true,
  ) {
    const request = ++this.request;
    let candidate: DocumentView | undefined;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    this.status.textContent = 'Updating…';
    this.container.setAttribute('aria-busy', 'true');
    try {
      const result = await read();
      const bytes = result instanceof Uint8Array ? result : result.pdf;
      const syncId = result instanceof Uint8Array ? null : (result.syncId ?? null);
      if (request !== this.request || !isCurrent()) return;
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const assets = new URL('pdfjs/', document.baseURI).href;
      if (request !== this.request || !isCurrent()) return;
      loadingTask = pdfjs.getDocument({
        data: bytes,
        cMapUrl: assets + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: assets + 'standard_fonts/',
        wasmUrl: assets + 'wasm/',
      });
      const pdf = await loadingTask.promise;
      candidate = { pdf, key, syncId, pages: [] };
      if (request !== this.request || !isCurrent()) return;
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const node = document.createElement('div');
        node.className = 'pdf-page';
        node.dataset.page = String(number);
        node.setAttribute('role', 'img');
        node.setAttribute('aria-label', `PDF page ${number}`);
        candidate.pages.push({
          number,
          width: viewport.width,
          height: viewport.height,
          node,
          top: 0,
          scale: 1,
          toViewport: (x, y) => viewport.convertToViewportPoint(page.view[0] + x, page.view[3] - y),
          fromViewport: (x, y) => {
            const [px, py] = viewport.convertToPdfPoint(x, y);
            return [px - page.view[0], page.view[3] - py];
          },
        });
        if (request !== this.request || !isCurrent()) return;
      }
      const same = this.current?.key === key;
      const stored = this.saved(key);
      if (!same) {
        this.zoom = stored.zoom;
        this.syncZoomInput();
      }
      this.width = this.scroll.clientWidth || this.width;
      let position = same ? this.anchor() : stored;
      // Recheck the live anchor after rendering: the reader may have scrolled or
      // changed zoom while the replacement document was loading.
      while (request === this.request && isCurrent()) {
        const layoutZoom = this.zoom,
          layoutWidth = this.width;
        this.layout(candidate);
        const p = candidate.pages[Math.min(candidate.pages.length - 1, position.page - 1)];
        const top = p.top + position.fraction * p.height * p.scale;
        for (const visible of this.visible(candidate, top)) await this.paint(candidate, visible);
        if (request !== this.request || !isCurrent()) return;
        const latest = same ? this.anchor() : { ...position, zoom: this.zoom };
        const nextPage = candidate.pages[Math.min(candidate.pages.length - 1, latest.page - 1)];
        const needed = this.visible(
          candidate,
          nextPage.top + latest.fraction * nextPage.height * nextPage.scale,
        );
        position = latest;
        if (layoutZoom !== this.zoom || layoutWidth !== this.width) continue;
        if (needed.every((p) => p.renderedScale === p.scale) && latest.zoom === this.zoom) break;
      }
      if (request !== this.request || !isCurrent()) return;
      const old = this.current;
      this.current = candidate;
      this.onPresented?.(this.current.syncId);
      candidate = undefined;
      this.pagesNode.replaceChildren(...this.current.pages.map((p) => p.node));
      (this.container.querySelector('.pdf-toolbar') as HTMLElement).hidden = false;
      this.count.textContent = `/ ${pdf.numPages}`;
      this.pageInput.max = String(pdf.numPages);
      this.restore(position);
      this.remember();
      this.schedule();
      this.container.dataset.revision = String(++this.revision);
      // Do not destroy an old document until any in-flight canvas rendering finishes.
      if (old) void this.renderQueue.finally(() => old.pdf.loadingTask.destroy()).catch(() => {});
    } catch (e) {
      if (request === this.request) {
        this.status.textContent = 'Update failed';
        throw e;
      }
    } finally {
      if (loadingTask && this.current?.pdf.loadingTask !== loadingTask) await loadingTask.destroy();
      if (request === this.request) {
        this.container.removeAttribute('aria-busy');
        if (this.status.textContent !== 'Update failed') this.status.textContent = '';
      }
    }
  }
  clear() {
    this.remember(true);
    ++this.request;
    const old = this.current;
    this.current = undefined;
    this.onPresented?.(null);
    this.pendingAnchor = undefined;
    if (old) void this.renderQueue.finally(() => old.pdf.loadingTask.destroy()).catch(() => {});
    this.pagesNode.innerHTML = this.placeholder;
    (this.container.querySelector('.pdf-toolbar') as HTMLElement).hidden = true;
    this.scroll.scrollTop = 0;
    this.container.removeAttribute('aria-busy');
  }
}
