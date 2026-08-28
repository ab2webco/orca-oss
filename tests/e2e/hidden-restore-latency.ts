import { expect, type Page } from '@stablyai/playwright-test'
import { switchToWorktree } from './helpers/store'
import { tailWindowStart, type RestoreLatencySample } from './hidden-restore-tail-window'

export { describeRestoreSample } from './hidden-restore-tail-window'
export type { RestoreLatencySample } from './hidden-restore-tail-window'

// One evaluate per poll, not two: resolving the tab separately doubled the
// round trips that land inside the measurement.
async function readRestoreTail(orcaPage: Page, lineCount: number): Promise<string> {
  const read = await orcaPage.evaluate((lineCount) => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const empty = { text: '', baseY: 0, cursorY: 0, start: 0 }
    if (!state || !worktreeId) {
      return empty
    }
    const tabs = state.tabsByWorktree[worktreeId] ?? []
    const preferred =
      state.activeTabType === 'terminal'
        ? state.activeTabId
        : (state.activeTabIdByWorktree?.[worktreeId] ?? null)
    const tabId =
      preferred && tabs.some((tab) => tab.id === preferred) ? preferred : (tabs[0]?.id ?? null)
    if (!tabId) {
      return empty
    }
    const manager = window.__paneManagers?.get(tabId)
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
    if (!pane) {
      return empty
    }
    const buffer = pane.terminal.buffer.active
    const end = buffer.baseY + buffer.cursorY
    // Mirrors tailWindowStart in ./hidden-restore-tail-window, which owns the
    // contract and its tests; page.evaluate cannot import it.
    const start = Math.max(0, end - lineCount + 1)
    const lines: string[] = []
    for (let row = start; row <= end; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
    }
    return { text: lines.join('\n'), baseY: buffer.baseY, cursorY: buffer.cursorY, start }
  }, lineCount)
  if (read.text === '') {
    return ''
  }
  // Self-check: the page cannot import tailWindowStart, so assert the window it
  // used matches the contract that module owns and its tests pin.
  const expected = tailWindowStart({ baseY: read.baseY, cursorY: read.cursorY, lineCount })
  if (read.start !== expected) {
    throw new Error(`restore tail window ${read.start} disagrees with the contract ${expected}`)
  }
  return read.text
}

const RESTORE_TAIL_LINES = 200

export async function measureHiddenOutputRestoreLatency(
  orcaPage: Page,
  worktreeId: string,
  runId: string
): Promise<RestoreLatencySample> {
  const restoreStart = performance.now()
  await switchToWorktree(orcaPage, worktreeId)
  let observerMs = 0
  let polls = 0
  await expect
    .poll(
      async () => {
        const observeStart = performance.now()
        const tail = await readRestoreTail(orcaPage, RESTORE_TAIL_LINES)
        observerMs += performance.now() - observeStart
        polls += 1
        return tail
      },
      {
        intervals: [25, 50, 100],
        timeout: 20_000,
        message: 'Hidden PTY output was not restored from main buffer on return'
      }
    )
    .toContain(`OPENCODE_PRESSURE_DONE_${runId}_`)
  return { elapsedMs: performance.now() - restoreStart, observerMs, polls }
}
