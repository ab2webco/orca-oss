/**
 * ORCA-251 — the same content through a DOM terminal and a DOM-less one.
 *
 * The only pair that can separate "the DOM Terminal amplifies the parse" from
 * "the runner is slow": both arms are built from the class the live panes use,
 * in the same page, in the same run. A comparison against a number measured on
 * another machine or another bundle cannot decide that.
 *
 * `dom` is the bare DOM Terminal — no webgl renderer, no addons, none of the
 * scheduler's callbacks. What the product adds on top is `live` minus `dom`.
 */
import type { Page } from '@stablyai/playwright-test'
import type { XtermTerminalHandle } from './xterm-write-element-cost'

export type XtermWriteBenchConfig = {
  label: string
  mode: 'nodom' | 'dom'
  chunkChars: number
  writes: number
  budgetMs: number
  cols: number
  rows: number
  scrollback: number
}

export type XtermWriteBenchResult = {
  label: string
  mode: 'nodom' | 'dom'
  chunkChars: number
  /** Below `writes` when the wall-clock budget cut the config short. */
  writesRun: number
  writesRequested: number
  truncated: boolean
  wallMs: number
}

/** The bulk-open fixture's own line, so the bench parses what the storm parses. */
const BENCH_FILLER_CHARS = 2048

export async function runXtermWriteBench(
  page: Page,
  config: XtermWriteBenchConfig
): Promise<XtermWriteBenchResult> {
  return page.evaluate(
    async ({ config, fillerChars }): Promise<XtermWriteBenchResult> => {
      const state = window.__orcaXtermWriteCost
      if (!state?.terminalCtor) {
        throw new Error('xterm write bench ran before the probe captured the Terminal class')
      }
      let stream = ''
      let frame = 0
      while (stream.length < config.chunkChars * config.writes) {
        frame += 1
        stream += `BG:BENCH:${frame}:${'A'.repeat(fillerChars)}\r\n`
      }
      const terminal: XtermTerminalHandle = new state.terminalCtor({
        cols: config.cols,
        rows: config.rows,
        scrollback: config.scrollback,
        allowProposedApi: true
      })
      let container: HTMLDivElement | null = null
      if (config.mode === 'dom') {
        container = document.createElement('div')
        container.style.cssText = 'position:absolute;left:0;top:0;width:900px;height:600px;'
        document.body.append(container)
        terminal.open?.(container)
      }
      if (!state.instrument(terminal, config.label)) {
        throw new Error(`xterm write bench could not instrument arm ${config.label}`)
      }
      const wasRecording = state.recording
      state.recording = true
      const startedAt = performance.now()
      let written = 0
      try {
        for (let index = 0; index < config.writes; index += 1) {
          if (performance.now() - startedAt > config.budgetMs) {
            break
          }
          const chunk = stream.slice(index * config.chunkChars, (index + 1) * config.chunkChars)
          // One at a time: an empty write buffer keeps every element its own task.
          await new Promise<void>((resolve) => {
            terminal.write(chunk, () => resolve())
          })
          written += 1
        }
      } finally {
        state.recording = wasRecording
        terminal.dispose?.()
        container?.remove()
      }
      return {
        label: config.label,
        mode: config.mode,
        chunkChars: config.chunkChars,
        writesRun: written,
        writesRequested: config.writes,
        truncated: written < config.writes,
        wallMs: performance.now() - startedAt
      }
    },
    { config, fillerChars: BENCH_FILLER_CHARS }
  )
}
