import { WritingEditor } from '../editor/editor';
import type { Config } from '../core/config';
import type { SymbolEntry } from '../core/indexer';
import {
  createChallengeGenerator,
  equationBody,
  normalizeEquation,
  makeScore,
  addScore,
  readScores,
  SCORE_KEY,
  type Challenge,
  type PracticeStyle,
  type Difficulty,
} from '../core/practice';
import { EquationPreview } from '../services/equation-preview';
import { escape as esc, icon } from '../ui';

export class PracticeWorkspace {
  editor!: WritingEditor;
  private dialog = document.createElement('dialog');
  private renderer = new EquationPreview();
  private challenge!: Challenge;
  private generateChallenge = createChallengeGenerator();
  private targetFingerprint = '';
  private generation = 0;
  private revision = 0;
  private started = 0;
  private lastEdit = 0;
  private finished = false;
  private assisted = false;
  private disposed = true;
  private timer?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private scores = readScores(this.stored(SCORE_KEY));
  private style: PracticeStyle = 'physics';
  private difficulty: Difficulty = 'standard';
  constructor(
    private config: () => Config,
    private symbols: () => SymbolEntry[],
    private files: () => string[],
    private run: (id: string) => boolean,
    private restoreFocus: () => void,
  ) {
    this.dialog.id = 'practice-dialog';
    document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => this.dispose());
    this.dialog.addEventListener('cancel', (e) => {
      if (document.querySelector('#dialog[open]')) e.preventDefault();
    });
  }
  get isOpen() {
    return this.dialog.open;
  }
  private stored(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) {
    return this.dialog.querySelector<T>('#' + id)!;
  }
  open() {
    if (this.isOpen) {
      this.editor.view.focus();
      return;
    }
    this.disposed = false;
    this.dialog.className = 'practice-dialog';
    this.dialog.innerHTML = `<div class="dialog-header"><span>PRACTICE <span class="practice-tag">EQUATION DRILLS</span></span><button id="practice-close" class="icon-button" aria-label="Close practice">${icon('close')}</button></div><div class="practice-body"><div class="practice-controls"><label>Style<select id="practice-style"><option value="physics">Physics</option><option value="mathematics">Mathematics</option></select></label><label>Length<select id="practice-difficulty"><option value="short">Short</option><option value="standard">Standard</option><option value="extended">Extended</option></select></label><button id="practice-next" class="secondary">Next equation</button><button id="practice-reveal" class="text-button">Show source</button></div><div class="practice-section-label"><span>TARGET</span><span id="practice-topic"></span></div><div id="practice-target" class="practice-math" aria-label="Target equation">Loading renderer…</div><pre id="practice-source" hidden></pre><div class="practice-section-label"><span>INPUT</span><span>Current snippets · keybindings · completion</span></div><div id="practice-editor"></div><div class="practice-section-label"><span>YOUR EQUATION</span><span id="practice-render-status" role="status"></span></div><div id="practice-output" class="practice-math" aria-label="Your rendered equation"></div><div class="practice-metrics"><div><strong id="practice-speed">0</strong><span>LaTeX chars / min</span></div><div><strong id="practice-time">0.0s</strong><span>Elapsed</span></div><div><strong id="practice-best">—</strong><span>Personal best</span></div><p id="practice-result" role="status">Timer starts on your first edit.</p></div><details class="practice-records"><summary>Local records</summary><div id="practice-scores"></div><p>Speed = target LaTeX characters / elapsed minute. Snippets count. Source hints and pasted or dropped text are unranked. Equivalent notation is accepted; algebraic equivalence is not checked.</p></details></div>`;
    this.dialog.showModal();
    this.editor = new WritingEditor(
      this.el('practice-editor'),
      this.config,
      this.symbols,
      this.files,
      this.run,
      (text) => this.changed(text),
      () => {},
    );
    this.el<HTMLSelectElement>('practice-style').value = this.style;
    this.el<HTMLSelectElement>('practice-difficulty').value = this.difficulty;
    this.el('practice-close').onclick = () => this.dialog.close();
    this.el('practice-next').onclick = () => void this.next();
    for (const id of ['practice-style', 'practice-difficulty'])
      this.el(id).onchange = () => {
        this.style = this.el<HTMLSelectElement>('practice-style').value as PracticeStyle;
        this.difficulty = this.el<HTMLSelectElement>('practice-difficulty').value as Difficulty;
        void this.next();
      };
    this.el('practice-reveal').onclick = () => {
      this.assisted = true;
      this.el('practice-source').hidden = false;
      this.el('practice-source').textContent = this.challenge.tex;
      this.el('practice-result').textContent = 'Source shown · unranked attempt';
      this.editor.view.focus();
    };
    for (const type of ['paste', 'drop', 'quill-paste'])
      this.editor.view.dom.addEventListener(
        type,
        () => {
          this.assisted = true;
          this.el('practice-result').textContent = 'Pasted or dropped text · unranked attempt';
        },
        { capture: true },
      );
    this.timer = setInterval(() => this.metrics(), 100);
    void this.next();
  }
  configure() {
    if (this.isOpen) this.editor.configure();
  }
  private async next() {
    const generation = ++this.generation;
    ++this.revision;
    clearTimeout(this.debounce);
    this.challenge = this.generateChallenge(this.style, this.difficulty);
    this.started = 0;
    this.finished = false;
    this.assisted = false;
    this.targetFingerprint = '';
    this.el('practice-source').hidden = true;
    this.el('practice-source').textContent = '';
    this.el('practice-target').textContent = 'Rendering…';
    this.el('practice-output').replaceChildren();
    this.el('practice-topic').textContent = this.challenge.topic;
    this.el('practice-render-status').textContent = '';
    this.el('practice-result').textContent = 'Timer starts on your first edit.';
    this.editor.load(this.editor.state('\\[\n\n\\]'));
    this.editor.jump(3);
    this.editor.lock(true);
    this.metrics();
    this.records();
    try {
      const result = await this.renderer.render(this.challenge.tex);
      if (this.disposed || generation !== this.generation) return;
      this.targetFingerprint = result.fingerprint;
      this.el('practice-target').innerHTML = result.svg;
      this.editor.lock(false);
      this.editor.view.focus();
    } catch (e) {
      if (this.disposed || generation !== this.generation) return;
      this.el('practice-target').textContent = 'Renderer unavailable';
      this.el('practice-result').textContent =
        (e as Error).message + ' · choose Next equation to retry.';
    }
  }
  private changed(text: string) {
    if (this.finished || !this.targetFingerprint) return;
    const now = performance.now();
    if (!this.started) this.started = now;
    this.lastEdit = now;
    const revision = ++this.revision,
      generation = this.generation;
    clearTimeout(this.debounce);
    this.el('practice-render-status').textContent = 'Updating…';
    this.debounce = setTimeout(async () => {
      try {
        const result = await this.renderer.render(equationBody(text));
        if (this.disposed || revision !== this.revision || generation !== this.generation) return;
        this.el('practice-output').innerHTML = result.svg;
        this.el('practice-render-status').textContent = '';
        if (
          normalizeEquation(text) === normalizeEquation(this.challenge.tex) ||
          result.fingerprint === this.targetFingerprint
        )
          this.complete();
      } catch {
        if (!this.disposed && revision === this.revision && generation === this.generation)
          this.el('practice-render-status').textContent =
            'Incomplete or unsupported LaTeX · previous render retained';
      }
    }, 65);
  }
  private complete() {
    if (this.finished) return;
    this.finished = true;
    this.editor.lock(true);
    const elapsed = this.lastEdit - this.started;
    const score = makeScore(this.challenge, elapsed, this.assisted);
    let message = 'Matched · ' + (score ? `${score.cpm} chars/min` : 'unranked attempt');
    if (score) {
      this.scores = addScore(this.scores, score);
      try {
        localStorage.setItem(SCORE_KEY, JSON.stringify(this.scores));
      } catch {
        message += ' · record could not be saved';
      }
    }
    this.el('practice-result').textContent = message;
    this.metrics();
    this.records();
    this.el('practice-next').focus();
  }
  private metrics() {
    const elapsed = this.started
      ? (this.finished ? this.lastEdit : performance.now()) - this.started
      : 0;
    this.el('practice-time').textContent = (elapsed / 1000).toFixed(1) + 's';
    const length = this.finished
      ? this.challenge.tex.replace(/\s/g, '').length
      : equationBody(this.editor?.view.state.doc.toString() || '').replace(/\s/g, '').length;
    this.el('practice-speed').textContent =
      elapsed >= 1000 ? String(Math.round((length * 60000) / elapsed)) : '0';
  }
  private records() {
    const scores = this.scores
      .filter((s) => s.style === this.style && s.difficulty === this.difficulty)
      .sort((a, b) => b.cpm - a.cpm);
    this.el('practice-best').textContent = scores[0] ? String(scores[0].cpm) : '—';
    this.el('practice-scores').innerHTML = scores.length
      ? `<table><thead><tr><th>Rank</th><th>Chars/min</th><th>Time</th><th>Date</th></tr></thead><tbody>${scores.map((s, i) => `<tr><td>${i + 1}</td><td>${s.cpm}</td><td>${s.seconds.toFixed(1)}s</td><td>${esc(s.date.slice(0, 10))}</td></tr>`).join('')}</tbody></table>`
      : '<p>No records for this style and length.</p>';
  }
  private dispose() {
    this.disposed = true;
    ++this.generation;
    ++this.revision;
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.renderer.dispose();
    this.editor?.view.destroy();
    this.restoreFocus();
  }
}
