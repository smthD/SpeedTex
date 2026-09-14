# Live LaTeX rendering: feasibility experiment

**Status (2026-09-11):** The implementation has been promoted into the main Quill 0.2 project at the user’s request. The snapshot and isolated lab remain intact. Measurements below describe the original experiment.

**Finding:** a PDF that updates automatically roughly half a second to one second after a short typing pause is feasible for the tested mathematical notes. Full-document rendering on every keystroke with imperceptible delay is not supported by these measurements. Graphics-heavy documents remain much slower. Live preview remains opt-in in the promoted version.

## Backup and isolation

- Original: `/home/david/Documents/ChatGPT/Editor`
- Complete baseline copy: `/home/david/Documents/ChatGPT/Editor/snapshots/before-live-20260910-183948/project`
- Experiment: `/home/david/Documents/ChatGPT/Editor/experiments/live-rendering`

The baseline includes source, lockfile, dependencies, built assets, and Git metadata. Source checksums match the original for all 37 captured files. See [backup verification](backup-verification.json) and the snapshot's `source-sha256.json` / `RESTORE.md`. The captured baseline can be restored independently of the promoted version. External LaTeX folders and user configuration are not included in the workspace snapshot.

The experimental package is named `quilltex-live-lab`, giving it a separate Electron user-data directory. Its browser demo uses port 5174, so it does not share the original demo's local storage. Dependencies are copied, not symlinked into the original.

## Measured results

Measured on Linux x64, AMD Ryzen 7 PRO 6850H, local TeX Live 2026 / pdfTeX and latexmk 4.87. Each warm case has seven samples. These are medians and observed ranges, not population p95s or promises for other machines. “Cold” means a clean build directory, not flushed OS or TeX caches.

### Complete edit-to-preview pipeline

Real Electron app at 1440 × 950, using sample notes plus two explicit added pages (four output pages with the test's title/version placement). Edits change a macro value used in the document. The clock starts at the editor document-change callback and stops after visible PDF canvases have been rendered, swapped, and position restored. It does not measure physical display/compositor latency or OS keyboard input latency.

| Mode                 | Typing pause | Median TeX time | Median PDF loading/rendering | Median edit → preview | Observed range |
| -------------------- | -----------: | --------------: | ---------------------------: | --------------------: | -------------: |
| Full LaTeX / latexmk |       350 ms |          429 ms |                       129 ms |            **914 ms** |     909–924 ms |
| Single-pass draft    |       350 ms |          255 ms |                       137 ms |            **747 ms** |     731–748 ms |
| Single-pass draft    |       100 ms |          260 ms |                       134 ms |            **499 ms** |     483–514 ms |

Scratch synchronization took 1–2 ms for this small project. The first full render took **1,754 ms** including the pause. Draft tests reuse intermediates produced by the preceding full build; this does not establish correct citations/references for a cold draft. Reducing the pause increases compilation frequency and CPU use. The scheduler limits execution to one live build at a time.

Raw data: [complete pipeline samples](live-e2e.json), [initial run](live-e2e-initial.json). Reproduce with `npm run test:live:desktop` after building the experiment. The test asserts unsaved source preservation, silent updates, reading-position retention, incomplete-syntax recovery, and stopping live mode.

### Compiler-only comparison

This separates compilation from idle delay, copying, IPC, and PDF rendering. Both paths render the entire document; “fast” does not mean incremental TeX.

| Project                                | Full latexmk warm median | Direct pdflatex warm median | Full cold build |
| -------------------------------------- | -----------------------: | --------------------------: | --------------: |
| Included sample notes                  |                   420 ms |                      246 ms |        1,368 ms |
| Generated 30-page mathematics document |                   272 ms |                      189 ms |          485 ms |
| Generated 5-page TikZ plots            |                 2,355 ms |                    2,241 ms |        4,552 ms |

The 30-page fixture is synthetically simple; packages, bibliographies, graphics, and cross-reference work matter more than page count alone. The TikZ fixture has repeated sampled curves. Single-pass compilation saves little when drawing work dominates. No claim is made about a large real thesis, network-mounted projects, or other machines.

Raw data: [compiler samples and environment](compile-benchmark.json). Reproduce with `npm run benchmark:live`. Both benchmark scripts use temporary project directories and clean them up after a normal run.

## What the prototype does

1. The **Live off / Live on** button enables automatic preview for the current project. It is deliberately off at startup.
2. The scheduler waits for a configurable 100–2,000 ms pause (350 ms default), combines rapid edits, and runs one build at a time. Continued edits invalidate obsolete results. The PDF renderer checks that validity again before committing pages, so an old build cannot replace a newer editor state.
3. A reusable temporary project mirrors ordinary project files/assets. Current editor buffers overwrite files **only in that temporary copy**. Closed buffers are restored from disk, deleted files are removed, and auxiliary data stays warm between builds. Live preview does not save source or PDF output into the user's project.
4. **Full LaTeX** uses latexmk to resolve required passes. **Fast draft** runs the selected TeX engine once; citations, references, page numbers, and table-of-contents information can be stale or unresolved. The preview labels this mode as a draft.
5. The previous good PDF stays visible during compilation and incomplete syntax. The build log pane does not open on each edit. A small status shows elapsed time; click it for diagnostics and stage timings.
6. Position and zoom survive swaps. Stopping live mode cancels pending work. A normal **Build** stops live mode and uses the original saved-project compilation workflow.

Global settings are isolated by the lab's app name. If the user independently enables ordinary auto-save or explicitly uses Save/Build, those commands still write source as designed; the live path itself does not.

## Why not just use a watcher or another renderer?

[latexmk already supports continuous preview](https://www.ctan.org/pkg/latexmk/?lang=en), watching source dependencies and rerunning the necessary tools. A watcher is a valid orchestration option. Based on the measured subprocess costs, my inference is that replacing our scheduler with `latexmk -pvc` alone would not eliminate the actual TeX/typesetting time. It would also need a buffer-to-scratch strategy to avoid forcing users to save every edit.

[Tectonic has a watch command](https://tectonic-typesetting.github.io/book/latest/v2cli/watch.html) and [automatically reruns TeX until output stabilizes](https://tectonic-typesetting.github.io/book/latest/getting-started/first-document.html). It was not installed or benchmarked here. Switching engines is a separate compatibility/performance experiment, not an established speedup.

A separate immediate math-expression preview could use KaTeX. Its [supported-function documentation](https://katex.org/docs/supported) and [support table](https://katex.org/docs/support_table) describe a bounded set of mathematical commands. That could complement the real PDF, but would not reproduce arbitrary packages, page layout, bibliography processing, or full LaTeX semantics. This path was researched, not implemented or timed in this experiment.

## Recommendation

Keep the current stable editor and try this lab on a representative real project. Full LaTeX with the default pause provides the safest near-live PDF. Choose the 100 ms single-pass option only if approximately half-second draft feedback is more useful than immediately correct references. Use normal Build for final verification.

If the target is feedback below roughly 100 ms while typing mathematics continuously, investigate a two-level interface: an immediate expression preview plus the authoritative PDF updating in the background. The current measurements do not support that latency target for the entire PDF. Potential follow-up experiments include rendering only currently visible pages before prefetching neighbors, caching suitable preamble work, and isolating expensive figures. None has been benchmarked here, so their benefit is unknown.

## Experimental boundaries

- Only local Linux / pdfTeX was exercised end-to-end. Other engine adapters and platforms need validation.
- Scratch mirroring skips symlinks and common dependency/build directories; projects relying on external paths, custom latexmk rc files, or arbitrary build recipes need additional design. Shell escape is disabled; scratch copying is not a security sandbox for untrusted TeX.
- The first snapshot copies project assets. Large asset trees can add latency that the small end-to-end fixture does not expose.
- Jobs time out after 15 seconds. Warm intermediates are reused only during the app session. On a forced crash a temporary scratch directory can remain.
- Incomplete TeX retains the last valid PDF; sustained typing can therefore temporarily leave the PDF behind the buffer. Results deliberately do not publish while known to be obsolete.
- Page-relative position preservation is not SyncTeX; substantial repagination can move the text under the saved position.

Validation: 19 inherited core/filesystem tests, 3 live scheduler/compiler tests, production TypeScript/Vite build, and real Electron live-rendering/latency tests. Original and baseline source hashes were rechecked after the experiment.
