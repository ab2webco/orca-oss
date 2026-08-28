import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Why @ondemand: this answers "what does the dashboard window cost" for ORCA-308,
// it does not guard a regression, and it carries four sampling phases of load.
//
// Why it exists at all: the popout's open/closed state has no runtime-RPC or CLI
// surface (ORCA-324), so measuring it against a running app needs a person to
// click. The harness does not — `orcaPage` is the trusted UI renderer the
// preload already answers to.
const SAMPLES_PER_PHASE = 5
const SAMPLE_INTERVAL_MS = 1_000
// Why: a fresh BrowserWindow keeps allocating past its first paint, so an
// immediate sample reads the window half-built.
const POPOUT_SETTLE_MS = 3_000
// Why a settle gate before the first phase: the app keeps shedding launch-time
// memory for tens of seconds, and a baseline taken inside that decay made the
// popout look like it *freed* 67 MB on the first run of this spec.
const LAUNCH_SETTLE_TIMEOUT_MS = 90_000
const LAUNCH_SETTLE_INTERVAL_MS = 2_000
const LAUNCH_SETTLE_TOLERANCE = 0.04
// Why three and not two: two consecutive reads agreeing is a coin flip while the
// app is still shedding, and one run that "settled" on its second read then drifted
// 243 MB between the two closed phases — more than either delta it reported.
const LAUNCH_SETTLE_STABLE_READS = 3

type PopoutPhase = 'closed-1' | 'open-1' | 'closed-2' | 'open-2'

type PopoutMemorySample = {
  phase: PopoutPhase
  rendererProcesses: number
  sessionCount: number
  appRendererBytes: number
  appTotalBytes: number
}

async function countRendererProcesses(electronApp: ElectronApplication): Promise<number> {
  return electronApp.evaluate(
    ({ app }) =>
      app.getAppMetrics().filter((metric) => {
        const type = typeof metric.type === 'string' ? metric.type.toLowerCase() : ''
        return type === 'renderer' || type === 'tab'
      }).length
  )
}

async function sampleAppMemory(
  page: Page,
  electronApp: ElectronApplication,
  phase: PopoutPhase
): Promise<PopoutMemorySample> {
  // The same collector `orca diagnostics memory` runs, so these numbers compare
  // directly against a series taken against a real app.
  const snapshot = await page.evaluate(() => window.api.memory.getSnapshot())
  return {
    phase,
    rendererProcesses: await countRendererProcesses(electronApp),
    sessionCount: snapshot.worktrees.reduce(
      (total, worktree) => total + worktree.sessions.length,
      0
    ),
    appRendererBytes: snapshot.app.renderer.memory,
    appTotalBytes: snapshot.app.memory
  }
}

async function samplePhase(
  page: Page,
  electronApp: ElectronApplication,
  phase: PopoutPhase
): Promise<PopoutMemorySample[]> {
  const samples: PopoutMemorySample[] = []
  for (let index = 0; index < SAMPLES_PER_PHASE; index += 1) {
    if (index > 0) {
      await page.waitForTimeout(SAMPLE_INTERVAL_MS)
    }
    samples.push(await sampleAppMemory(page, electronApp, phase))
  }
  return samples
}

async function waitForLaunchMemoryToSettle(page: Page): Promise<number[]> {
  const trace: number[] = []
  const deadline = Date.now() + LAUNCH_SETTLE_TIMEOUT_MS
  let stable = 0
  let previous: number | null = null
  while (Date.now() < deadline) {
    const total = await page.evaluate(
      async () => (await window.api.memory.getSnapshot()).app.memory
    )
    trace.push(total)
    stable =
      previous !== null && Math.abs(total - previous) <= previous * LAUNCH_SETTLE_TOLERANCE
        ? stable + 1
        : 0
    if (stable >= LAUNCH_SETTLE_STABLE_READS - 1) {
      return trace
    }
    previous = total
    await page.waitForTimeout(LAUNCH_SETTLE_INTERVAL_MS)
  }
  return trace
}

function median(values: number[]): number {
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0
}

function medianOf(
  samples: PopoutMemorySample[],
  key: 'appRendererBytes' | 'appTotalBytes'
): number {
  return median(samples.map((sample) => sample[key]))
}

function toMb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024)
}

test('@ondemand measures what the Agent Dashboard popout costs, with the session count held constant', async ({
  electronApp,
  orcaPage
}) => {
  test.setTimeout(300_000)
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is unavailable')
    }
    // Why OrThrow: `dashboardPopout:open` bails silently when the setting is off,
    // and a silent bail here reads as "the popout costs nothing".
    await store.getState().updateSettingsOrThrow({ experimentalAgentDashboardPopout: true })
  })
  const settleTrace = await waitForLaunchMemoryToSettle(orcaPage)

  const baselineWindowIds = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((candidate) => candidate.id)
  )
  const openPopout = async (): Promise<void> => {
    await orcaPage.evaluate(() => window.api.dashboard.openPopout('board'))
    await expect
      .poll(() => orcaPage.evaluate(() => window.api.dashboard.getPopoutOpen()), {
        timeout: 30_000,
        message: 'dashboard popout never reported itself open'
      })
      .toBe(true)
    await orcaPage.waitForTimeout(POPOUT_SETTLE_MS)
  }
  const closePopout = async (): Promise<void> => {
    await electronApp.evaluate(({ BrowserWindow }, knownIds) => {
      for (const candidate of BrowserWindow.getAllWindows()) {
        if (!knownIds.includes(candidate.id) && !candidate.isDestroyed()) {
          candidate.close()
        }
      }
    }, baselineWindowIds)
    await expect
      .poll(() => orcaPage.evaluate(() => window.api.dashboard.getPopoutOpen()), {
        timeout: 30_000,
        message: 'dashboard popout never reported itself closed'
      })
      .toBe(false)
    await orcaPage.waitForTimeout(POPOUT_SETTLE_MS)
  }

  // Why two closed/open pairs: one pair cannot tell a popout's cost from
  // whatever the app was doing anyway. Two give a second delta, and the gap
  // between the two closed phases measures the drift that would forge one.
  expect(await orcaPage.evaluate(() => window.api.dashboard.getPopoutOpen())).toBe(false)
  const closed1 = await samplePhase(orcaPage, electronApp, 'closed-1')
  await openPopout()
  const open1 = await samplePhase(orcaPage, electronApp, 'open-1')
  await closePopout()
  const closed2 = await samplePhase(orcaPage, electronApp, 'closed-2')
  await openPopout()
  const open2 = await samplePhase(orcaPage, electronApp, 'open-2')
  await closePopout()

  const all = [...closed1, ...open1, ...closed2, ...open2]
  // Why asserted and not assumed: a moved session count makes every byte below
  // uncomparable, and it is the one variable this spec claims to hold.
  expect(new Set(all.map((sample) => sample.sessionCount)).size).toBe(1)
  // Why on process count and not on bytes: this is the measurement's own
  // validity check — bytes are the finding, and a threshold on them would be a
  // budget nobody measured.
  const closedProcesses = median(closed1.map((sample) => sample.rendererProcesses))
  for (const phase of [closed2]) {
    expect(median(phase.map((sample) => sample.rendererProcesses))).toBe(closedProcesses)
  }
  for (const phase of [open1, open2]) {
    expect(median(phase.map((sample) => sample.rendererProcesses))).toBe(closedProcesses + 1)
  }

  // Why the renderer bucket and not the app total: the popout is its own
  // renderer process, so its cost lands here, while the app total also carries
  // main and utility movement that kept drifting hundreds of MB after the
  // settle gate and swamped the signal.
  const pairDeltas = [
    medianOf(open1, 'appRendererBytes') - medianOf(closed1, 'appRendererBytes'),
    medianOf(open2, 'appRendererBytes') - medianOf(closed2, 'appRendererBytes')
  ]
  const driftBytes = medianOf(closed2, 'appRendererBytes') - medianOf(closed1, 'appRendererBytes')
  console.log(
    `[dashboard-popout-cost] ${JSON.stringify({
      sessionCount: all[0]?.sessionCount ?? null,
      settleTraceMb: settleTrace.map(toMb),
      pairDeltaMb: pairDeltas.map(toMb),
      // Drift across the two closed phases. If it is the size of the deltas, the
      // deltas are drift and the run says nothing about the popout.
      closedDriftMb: toMb(driftBytes),
      appTotalDeltaMb: [
        toMb(medianOf(open1, 'appTotalBytes') - medianOf(closed1, 'appTotalBytes')),
        toMb(medianOf(open2, 'appTotalBytes') - medianOf(closed2, 'appTotalBytes'))
      ],
      medianRendererMb: {
        closed1: toMb(medianOf(closed1, 'appRendererBytes')),
        open1: toMb(medianOf(open1, 'appRendererBytes')),
        closed2: toMb(medianOf(closed2, 'appRendererBytes')),
        open2: toMb(medianOf(open2, 'appRendererBytes'))
      },
      medianTotalMb: {
        closed1: toMb(medianOf(closed1, 'appTotalBytes')),
        open1: toMb(medianOf(open1, 'appTotalBytes')),
        closed2: toMb(medianOf(closed2, 'appTotalBytes')),
        open2: toMb(medianOf(open2, 'appTotalBytes'))
      },
      samples: all
    })}`
  )
  // Why this fails the run instead of annotating it: drift at or above the
  // smallest delta means the deltas are drift, and a measurement that cannot
  // answer its question has to say so rather than print a number that reads as
  // an answer.
  expect(
    Math.abs(driftBytes),
    `closed-phase drift ${toMb(driftBytes)}MB is not smaller than the deltas ${pairDeltas
      .map(toMb)
      .join('/')}MB — this run cannot separate the popout from the app's own movement`
  ).toBeLessThan(Math.min(...pairDeltas.map((delta) => Math.abs(delta))))
})
