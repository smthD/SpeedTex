/** Latest-wins scheduler: debounce edits, never overlap compiles, and discard
 * obsolete results before presentation. Incomplete syntax waits for the next edit.
 */
export class LiveScheduler<T> {
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private processed = 0;
  private running = false;
  private active = false;
  private editedAt = 0;
  private options: {
    delay: () => number;
    run: (revision: number) => Promise<T>;
    present: (result: T, isCurrent: () => boolean) => Promise<void>;
    status: (state: string) => void;
    cancel: () => void;
  };
  constructor(options: LiveScheduler<T>['options']) {
    this.options = options;
  }
  get enabled() {
    return this.active;
  }
  setEnabled(enabled: boolean) {
    if (this.active === enabled) return;
    this.active = enabled;
    if (enabled) this.changed();
    else {
      this.revision++;
      clearTimeout(this.timer);
      this.options.cancel();
      this.options.status('Live off');
    }
  }
  changed() {
    this.editedAt = Date.now();
    this.revision++;
    if (!this.active) return;
    this.options.status(this.running ? 'Editing · update queued' : 'Waiting for pause…');
    this.arm();
  }
  private arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.flush(),
      Math.max(0, this.editedAt + this.options.delay() - Date.now()),
    );
  }
  private async flush() {
    if (!this.active || this.running || this.processed === this.revision) return;
    const revision = this.revision;
    this.running = true;
    this.processed = revision;
    this.options.status('Rendering…');
    const isCurrent = () => this.active && revision === this.revision;
    try {
      const result = await this.options.run(revision);
      if (isCurrent()) await this.options.present(result, isCurrent);
    } catch (e) {
      if (isCurrent()) this.options.status('Live error: ' + (e as Error).message);
    } finally {
      this.running = false;
      if (this.active && this.processed !== this.revision) this.arm();
    }
  }
}
