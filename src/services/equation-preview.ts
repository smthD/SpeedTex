export interface EquationResult {
  svg: string;
  fingerprint: string;
}
export class EquationPreview {
  private worker?: Worker;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (r: EquationResult) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  render(tex: string): Promise<EquationResult> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./equation.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = ({ data }) => {
        const p = this.pending.get(data.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(data.id);
        if (data.error) p.reject(new Error(data.error));
        else p.resolve(data);
      };
      this.worker.onerror = () => this.dispose('Equation renderer could not load');
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.dispose('Rendering timed out; simplify the equation'),
        5000,
      );
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, tex });
    });
  }
  dispose(message = 'Practice closed') {
    this.worker?.terminate();
    this.worker = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
  }
}
