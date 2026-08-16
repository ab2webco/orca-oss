/**
 * Freeze repro R1 — bulk-open remote sessions under multi-worktree flood load.
 *
 * Trigger: reopening many remote sessions on Remote Server / SSH with agents.
 *
 * Topology under test:
 *   R1: headless Remote Orca host + paired desktop web client (paired-remote-server)
 *
 * Measurement:
 *   main-thread task boundaries during hidden flood + bulk worktree/tab open.
 *   Soft freeze is one task >= 600ms, hard freeze one task >= 1500ms; the busy
 *   run carries only a 4500ms hang ceiling because it is throughput, not a
 *   stall. All four derived in remote-session-bulk-open-oracle.ts.
 *
 * Run:
 *   SKIP_BUILD=1 pnpm exec playwright test \
 *     tests/e2e/remote-session-bulk-open-freeze-repro.spec.ts \
 *     --config tests/playwright.config.ts \
 *     --project electron-headless --workers=1
 *
 * Or:
 *   pnpm run test:e2e:remote-bulk-open-freeze
 */
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedElectronClient,
  launchPairedWebClient,
  type PairedElectronClient,
  type PairedWebClient
} from './helpers/paired-electron-client'
import {
  CATASTROPHIC_BUSY_RUN_MS,
  HARD_FREEZE_TASK_MS,
  runBulkOpenFreezeOracle,
  seedBulkOpenRemoteSessions,
  SOFT_FREEZE_TASK_MS
} from './helpers/remote-session-bulk-open-oracle'
import {
  runHostFocusStorm,
  seedHostFocusStormSessions
} from './helpers/terminal-host-focus-storm-oracle'

const REPORT_DIR = path.join(process.cwd(), 'test-results', 'freeze-repro')
const USE_DESKTOP_PAIR = process.env.ORCA_E2E_FREEZE_DESKTOP_PAIR === '1'

test('paired client host-focus storm keeps the latest terminal @freeze-repro', async ({
  orcaPage
}, testInfo) => {
  test.setTimeout(180_000)
  const offer = await createRuntimeDesktopPairingOffer(orcaPage)
  const client = await launchPairedElectronClient(offer, testInfo, 'focus-storm')
  let disposeSessions: (() => Promise<void>) | null = null
  try {
    const worktreeId = await orcaPage.evaluate(() => {
      const id = window.__store?.getState().activeWorktreeId
      if (!id) {
        throw new Error('headed host has no active worktree')
      }
      return id
    })
    const environmentId = await client.page.evaluate(async () => {
      const environment = (await window.api.runtimeEnvironments.list())[0]
      if (!environment) {
        throw new Error('paired client has no runtime environment')
      }
      return environment.id
    })
    await expect
      .poll(
        () =>
          client.page.evaluate(
            (id) =>
              window.__store
                ?.getState()
                .allWorktrees()
                .some((worktree) => worktree.id === id) ?? false,
            worktreeId
          ),
        { timeout: 30_000 }
      )
      .toBe(true)
    const seeded = await seedHostFocusStormSessions(client.page, worktreeId, 6, environmentId)
    disposeSessions = seeded.dispose
    const results = await runHostFocusStorm(client.page, seeded.sessions, environmentId)
    const latest = results.at(-1)
    const expected = seeded.sessions.at(-1)
    expect(latest).toMatchObject({
      handle: expected?.terminal,
      worktreeId,
      navigated: true
    })
    expect(results.slice(0, -1).some((result) => result.navigated === false)).toBe(true)
    await expect
      .poll(
        () =>
          orcaPage.evaluate((id) => {
            const state = window.__store?.getState()
            return {
              worktreeId: state?.activeWorktreeId ?? null,
              tabId: state?.activeTabIdByWorktree[id] ?? state?.activeTabId ?? null
            }
          }, worktreeId),
        { timeout: 30_000 }
      )
      .toEqual({ worktreeId, tabId: latest?.tabId })
  } finally {
    await disposeSessions?.()
    await client.dispose()
  }
})

test('R1 paired remote bulk-open freeze oracle @freeze-repro', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(420_000)
  const host = await launchHeadlessPairedRuntimeHost()
  let webClient: PairedWebClient | null = null
  let desktopClient: PairedElectronClient | null = null
  let disposeSessions: (() => Promise<void>) | null = null
  try {
    const added = await host.client.call<{ repo: { id: string } }>('repo.add', {
      path: testRepoPath,
      kind: 'git'
    })
    await expect
      .poll(
        async () => {
          const listed = await host.client.call<{ totalCount: number }>('worktree.list', {
            repo: `id:${added.result.repo.id}`
          })
          return listed.result.totalCount
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0)

    // Prefer full desktop pair when web-client store hydration is flaky in this env.
    const page = await (async () => {
      if (USE_DESKTOP_PAIR) {
        desktopClient = await launchPairedElectronClient(host.offer, testInfo, 'freeze-r1')
        return desktopClient.page
      }
      // Shown on purpose (ORCA-230): a never-shown window makes two ~1017ms
      // compositor commits per storm that no user can hit, and they were eating
      // half of this oracle's budget. remote-session-bulk-open-block-shape.spec.ts
      // is the control that keeps that attribution honest.
      webClient = await launchPairedWebClient(host.app, host.offer, {
        showWindow: true,
        terminalParkingDelayMs: 500
      })
      return webClient.page
    })()

    await page.waitForFunction(() => Boolean(window.__store), null, { timeout: 60_000 })
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().allWorktrees().length ?? 0), {
        timeout: 90_000
      })
      .toBeGreaterThan(0)

    const seeded = await seedBulkOpenRemoteSessions(page, {
      repoId: added.result.repo.id
    })
    disposeSessions = seeded.dispose

    const report = await runBulkOpenFreezeOracle(page, seeded.sessions, {
      topology: 'paired-remote-server',
      versionHint: process.env.npm_package_version ?? '1.4.163-rc.3',
      reportDir: REPORT_DIR
    })

    console.log('[freeze-repro R1]', JSON.stringify(report, null, 2))

    if (report.hardFreeze) {
      throw new Error(
        `HARD FREEZE signal: bulkOpenMaxLagMs=${report.bulkOpenMaxLagMs.toFixed(0)} ` +
          `bulkOpenMaxTaskMs=${report.bulkOpenMaxTaskMs.toFixed(0)} ` +
          `interactionProbeMs=${report.interactionProbeMs.toFixed(0)} ` +
          `(task ceiling ${HARD_FREEZE_TASK_MS}ms, busy-run ceiling ${CATASTROPHIC_BUSY_RUN_MS}ms). ` +
          `notes=${report.notes.join('; ')}`
      )
    }
    if (report.softFreeze) {
      throw new Error(
        `SOFT FREEZE signal: bulkOpenMaxLagMs=${report.bulkOpenMaxLagMs.toFixed(0)} ` +
          `bulkOpenMaxTaskMs=${report.bulkOpenMaxTaskMs.toFixed(0)} ` +
          `interactionProbeMs=${report.interactionProbeMs.toFixed(0)} ` +
          `(task ceiling ${SOFT_FREEZE_TASK_MS}ms). notes=${report.notes.join('; ')}`
      )
    }

    expect(report.sessionCount).toBeGreaterThanOrEqual(8)
    expect(report.worktreeCount).toBe(3)
  } finally {
    await disposeSessions?.()
    await webClient?.dispose()
    await desktopClient?.dispose()
    await host.dispose()
  }
})
