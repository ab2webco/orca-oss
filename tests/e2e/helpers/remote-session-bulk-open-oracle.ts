import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { JSHandle, Page } from '@stablyai/playwright-test'
import { toWebTerminalSurfaceTabId } from '../../../src/shared/terminal-surface-id'
import { expect } from './orca-app'
import { createRemoteSessionBulkOpenFixture } from './remote-session-bulk-open-fixture'
import {
  formatBlockWindow,
  readRendererBlockWindow,
  startRendererMainThreadBlockProbe,
  type RendererBlockWindow
} from './renderer-main-thread-block-probe'
import { closeStreamingTerminals } from './streaming-terminal-cleanup'
import { waitForActivePanePtyId } from './terminal'

/** Multi-worktree load: several agent-like streaming terminals per worktree. */
export const BULK_OPEN_WORKTREE_COUNT = 3
export const BULK_OPEN_TABS_PER_WORKTREE = 4
/** Soft freeze signal — UI feels stuck. */
export const SOFT_FREEZE_LAG_MS = 2_000
/** Hard freeze signal — matches trusted "screen fully frozen" reports. */
export const HARD_FREEZE_LAG_MS = 5_000

export type BulkOpenSession = {
  marker: string
  tabId: string
  terminal: string
  worktreeId: string
}

export type BulkOpenFreezeReport = {
  bulkOpenMaxLagMs: number
  hiddenFloodMaxLagMs: number
  interactionProbeMs: number
  hardFreeze: boolean
  softFreeze: boolean
  sessionCount: number
  worktreeCount: number
  topology: 'paired-remote-server' | 'docker-ssh'
  versionHint: string
  /**
   * Full measurement windows behind the two scalars above. The scalars keep
   * their names so readings stay comparable with runs recorded before this
   * instrument changed; these carry what a scalar cannot — where in the window
   * the worst block landed, and how many tasks the probe serviced, without
   * which a `0` cannot be told from a probe that never ran.
   */
  probeWindows: {
    bulkOpen: RendererBlockWindow
    hiddenFlood: RendererBlockWindow
  }
  notes: string[]
}

/**
 * TEMPORARY (ORCA-199): the `setInterval(16)` probe this oracle used until now,
 * kept beside its replacement for one CI run so the ~1010ms this oracle has
 * been reporting can be attributed. It ships nothing and is removed once that
 * run is read.
 */
async function startLegacyTimerDriftProbe(
  page: Page
): Promise<JSHandle<{ stop: () => { maxDriftMs: number; tickCount: number; windowMs: number } }>> {
  return page.evaluateHandle(() => {
    const sampleMs = 16
    const startedAt = performance.now()
    let lastAt = startedAt
    let maxDriftMs = 0
    let tickCount = 0
    const timer = window.setInterval(() => {
      const now = performance.now()
      tickCount += 1
      maxDriftMs = Math.max(maxDriftMs, now - lastAt - sampleMs)
      lastAt = now
    }, sampleMs)
    return {
      stop: () => {
        window.clearInterval(timer)
        return { maxDriftMs, tickCount, windowMs: performance.now() - startedAt }
      }
    }
  })
}

async function callRuntime<TResult>(page: Page, method: string, params: unknown): Promise<TResult> {
  return page.evaluate(
    async ({ method, params }) => {
      const response = await window.api.runtime.call({ method, params })
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      return response.result
    },
    { method, params }
  ) as Promise<TResult>
}

/**
 * How long the renderer takes to service one queued task.
 *
 * Why not requestAnimationFrame: the E2E window is never shown, so Chromium
 * produces no compositor frames for it and rAF fires at ~1Hz or not at all.
 * A double-rAF probe then reports ~2000ms of "freeze" on a perfectly
 * responsive renderer — measured at 1914ms and 2012ms against this spec's
 * 2000ms threshold, which is what made it flake. MessagePort tasks carry no
 * frame or timer-throttling dependency, so this measures the main thread.
 */
export async function measureRendererInteractionMs(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const started = performance.now()
    if (!window.__store) {
      throw new Error('store unavailable for interaction probe')
    }
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve()
      }
      channel.port2.postMessage(0)
    })
    return performance.now() - started
  })
}

export async function seedBulkOpenRemoteSessions(
  page: Page,
  seed: { repoId: string }
): Promise<{ sessions: BulkOpenSession[]; dispose: () => Promise<void> }> {
  const fixture = createRemoteSessionBulkOpenFixture()
  const sessions: BulkOpenSession[] = []
  const closeSessions = async (): Promise<void> => {
    try {
      await closeStreamingTerminals(
        sessions.map((session) => session.terminal),
        (method, terminal) => callRuntime(page, method, { terminal })
      )
    } finally {
      fixture.dispose()
    }
  }
  try {
    for (let w = 0; w < BULK_OPEN_WORKTREE_COUNT; w += 1) {
      const marker = `BULK_WT_${w}_T0`
      const created = await callRuntime<{
        startupTerminal?: { handle?: string; tabId?: string }
        worktree: { id: string }
      }>(page, 'worktree.create', {
        repo: seed.repoId,
        name: `bulk-open-wt-${w}-${Date.now()}`,
        setupDecision: 'skip',
        activate: false,
        noParent: true,
        startupCommand: fixture.command(marker)
      })
      if (!created.startupTerminal?.handle || !created.startupTerminal.tabId) {
        throw new Error(`Bulk-open worktree ${w} missing startup terminal`)
      }
      const worktreeId = created.worktree.id
      sessions.push({
        marker,
        tabId: toWebTerminalSurfaceTabId(created.startupTerminal.tabId),
        terminal: created.startupTerminal.handle,
        worktreeId
      })

      for (let t = 1; t < BULK_OPEN_TABS_PER_WORKTREE; t += 1) {
        const tabMarker = `BULK_WT_${w}_T${t}`
        const result = await callRuntime<{
          tab: { parentTabId: string; terminal: string | null }
        }>(page, 'session.tabs.createTerminal', {
          worktree: `id:${worktreeId}`,
          command: fixture.command(tabMarker),
          activate: false,
          select: false,
          navigation: 'caller'
        })
        if (!result.tab.terminal) {
          throw new Error(`Bulk-open terminal ${tabMarker} was not created`)
        }
        sessions.push({
          marker: tabMarker,
          tabId: toWebTerminalSurfaceTabId(result.tab.parentTabId),
          terminal: result.tab.terminal,
          worktreeId
        })
      }
    }

    // Ensure fixtures started and are streaming on the host.
    await expect
      .poll(
        async () => {
          const ready = await Promise.all(
            sessions.map(async (session) => {
              const result = await callRuntime<{ terminal: { tail: string[] } }>(
                page,
                'terminal.read',
                { terminal: session.terminal, limit: 200 }
              )
              const text = result.terminal.tail.join('\n')
              return text.includes(`BG:${session.marker}:`)
            })
          )
          return ready.every(Boolean)
        },
        { timeout: 60_000 }
      )
      .toBe(true)

    return {
      sessions,
      dispose: closeSessions
    }
  } catch (error) {
    await closeSessions().catch((cleanupError) => {
      throw new AggregateError(
        [error, cleanupError],
        'Bulk-open session seeding and cleanup failed'
      )
    })
    throw error
  }
}

/**
 * Repro R1 core: leave remotes streaming hidden, then burst-open sessions
 * (reopening remote sessions after agents have been writing in the background).
 */
export async function runBulkOpenFreezeOracle(
  page: Page,
  sessions: BulkOpenSession[],
  opts: {
    topology: BulkOpenFreezeReport['topology']
    versionHint?: string
    reportDir?: string
  }
): Promise<BulkOpenFreezeReport> {
  const notes: string[] = []
  const worktreeIds = [...new Set(sessions.map((s) => s.worktreeId))]

  // Leave terminal view so panes can park / go inactive while flooding.
  await page.evaluate(() => window.__store?.getState().setActiveView('tasks'))
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  // Accumulate remote flood for several seconds (agent backlog).
  await page.waitForTimeout(4_000)

  // Same instrument, same page, no bulk open inside it: the control for the
  // measured window below, and the only thing that makes a large bulk-open
  // reading attributable to the bulk open.
  const hiddenProbe = await startRendererMainThreadBlockProbe(page)
  const hiddenLegacyProbe = await startLegacyTimerDriftProbe(page)
  await page.waitForTimeout(2_000)
  const hiddenFlood = await readRendererBlockWindow(hiddenProbe, 'hidden streaming')
  await hiddenProbe.dispose()
  const hiddenLegacy = await hiddenLegacyProbe.evaluate((probe) => probe.stop())
  await hiddenLegacyProbe.dispose()
  const hiddenFloodMaxLagMs = hiddenFlood.maxBlockMs
  notes.push(formatBlockWindow(hiddenFlood, 'hidden streaming'))
  notes.push(`AB hidden legacy=${JSON.stringify(hiddenLegacy)}`)

  // Burst open remote sessions (worktree + tab activate).
  const openProbe = await startRendererMainThreadBlockProbe(page)
  const openLegacyProbe = await startLegacyTimerDriftProbe(page)
  const openStarted = Date.now()
  for (const worktreeId of worktreeIds) {
    const tabs = sessions.filter((session) => session.worktreeId === worktreeId)
    for (const tab of tabs) {
      await page.evaluate(
        ({ targetWorktreeId, tabId }) => {
          const state = window.__store?.getState()
          state?.setActiveView('terminal')
          state?.setActiveWorktree(targetWorktreeId)
          state?.setActiveTabForWorktree(targetWorktreeId, tabId)
        },
        { targetWorktreeId: worktreeId, tabId: tab.tabId }
      )
    }
  }
  // One more full pass clicking visible tabs if present.
  for (const session of sessions) {
    const locator = page.locator(`[data-testid="sortable-tab"][data-tab-id="${session.tabId}"]`)
    if (await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout: 2_000 }).catch(() => undefined)
    }
  }
  // Let the storm settle enough to measure residual lag.
  await page.waitForTimeout(3_000)
  const bulkOpen = await readRendererBlockWindow(openProbe, 'bulk open')
  await openProbe.dispose()
  const openLegacy = await openLegacyProbe.evaluate((probe) => probe.stop())
  await openLegacyProbe.dispose()
  const bulkOpenMaxLagMs = bulkOpen.maxBlockMs
  notes.push(`bulk open wall=${Date.now() - openStarted}ms`)
  notes.push(formatBlockWindow(bulkOpen, 'bulk open'))
  notes.push(`AB open legacy=${JSON.stringify(openLegacy)}`)

  // Confirm last session is live after the storm (host PTYs survived).
  const last = sessions.at(-1)
  if (!last) {
    throw new Error('bulk-open freeze oracle requires at least one session')
  }
  await page.evaluate(
    ({ targetWorktreeId, tabId }) => {
      const state = window.__store?.getState()
      state?.setActiveView('terminal')
      state?.setActiveWorktree(targetWorktreeId)
      state?.setActiveTabForWorktree(targetWorktreeId, tabId)
    },
    { targetWorktreeId: last.worktreeId, tabId: last.tabId }
  )
  await waitForActivePanePtyId(page, 30_000).catch(() => {
    notes.push('active pane PTY id not ready after bulk open (possible re-attach failure)')
  })

  const interactionProbeMs = await measureRendererInteractionMs(page)
  notes.push(`post-storm renderer interaction=${interactionProbeMs.toFixed(0)}ms`)

  const report: BulkOpenFreezeReport = {
    bulkOpenMaxLagMs,
    hiddenFloodMaxLagMs,
    interactionProbeMs,
    hardFreeze: bulkOpenMaxLagMs >= HARD_FREEZE_LAG_MS || interactionProbeMs >= HARD_FREEZE_LAG_MS,
    softFreeze: bulkOpenMaxLagMs >= SOFT_FREEZE_LAG_MS || interactionProbeMs >= SOFT_FREEZE_LAG_MS,
    sessionCount: sessions.length,
    worktreeCount: worktreeIds.length,
    topology: opts.topology,
    versionHint: opts.versionHint ?? process.env.ORCA_VERSION ?? 'unknown',
    probeWindows: { bulkOpen, hiddenFlood },
    notes
  }

  if (opts.reportDir) {
    mkdirSync(opts.reportDir, { recursive: true })
    const outPath = path.join(opts.reportDir, `bulk-open-freeze-${opts.topology}.json`)
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
    notes.push(`wrote ${outPath}`)
  }

  return report
}
