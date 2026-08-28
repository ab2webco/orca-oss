/**
 * App-level complement to the deterministic subsystem P95 test: alternate
 * real Electron launches with zero and twenty approved plugins, then compare
 * startup milestones and prove no worker entry executed before a trigger.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type TestInfo } from '@stablyai/playwright-test'
import { fingerprintPluginConsent } from '../../src/shared/plugins/plugin-consent-fingerprint'
import { pluginManifestSchema } from '../../src/shared/plugins/plugin-manifest'
import { createRestartSession } from './helpers/orca-restart'
import { evaluateStartupBudget } from './plugin-startup-budget-verdict'

const PLUGIN_COUNT = 20
// Why 16 and not 3: a single launch carries ~64ms of run-to-run spread, so at
// three samples a side the 50ms budget sits one standard error from zero — it
// fires on noise and still misses most real regressions. 16 keeps the loop
// inside the existing 240s timeout at the ~4.0s launch cadence CI sustains.
const SAMPLE_COUNT = 16
// The first Electron launch of a session pays cold-start cost the rest do not,
// and it would otherwise always land on the baseline side and flatter it.
const WARMUP_LAUNCHES = 1
const STARTUP_BUDGET_MS = 50

type StartupSample = {
  readyToShowMs: number
  pluginDurationMs: number
  installedPlugins: number
}

function updateProfile(userDataDir: string, pluginConsents: Record<string, string>): void {
  const profilePath = join(userDataDir, 'orca-data.json')
  const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
    settings?: Record<string, unknown>
  }
  profile.settings = {
    ...profile.settings,
    pluginSystemEnabled: true,
    pluginConsents,
    disabledPlugins: [],
    devPluginPaths: []
  }
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`)
}

function seedPlugins(userDataDir: string, count: number): string[] {
  const pluginsDir = join(userDataDir, 'plugins')
  rmSync(pluginsDir, { recursive: true, force: true })
  mkdirSync(pluginsDir, { recursive: true })
  const pluginConsents: Record<string, string> = {}
  const markerPaths: string[] = []
  for (let index = 0; index < count; index += 1) {
    const manifest = pluginManifestSchema.parse({
      manifestVersion: 1,
      id: `startup-${index}`,
      publisher: 'budget',
      name: `Startup ${index}`,
      version: '1.0.0',
      engines: { orca: '>=1.0.0' },
      pluginApi: 1,
      main: 'main.mjs',
      contributes: { panels: [], commands: [], events: [] },
      capabilities: []
    })
    const pluginKey = `${manifest.publisher}.${manifest.id}`
    const contentHash = (index + 1).toString(16).padStart(64, '0')
    const versionDir = join(pluginsDir, pluginKey, contentHash)
    const markerPath = join(userDataDir, `plugin-startup-marker-${index}`)
    mkdirSync(versionDir, { recursive: true })
    writeFileSync(join(pluginsDir, pluginKey, 'current'), contentHash)
    writeFileSync(join(versionDir, 'orca-plugin.json'), JSON.stringify(manifest))
    writeFileSync(
      join(versionDir, 'main.mjs'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(markerPath)}, 'executed')`
    )
    pluginConsents[pluginKey] = fingerprintPluginConsent(manifest)
    markerPaths.push(markerPath)
  }
  updateProfile(userDataDir, pluginConsents)
  return markerPaths
}

function parseMetric(output: string, event: string, key: string): number | null {
  const line = output.split('\n').find((candidate) => candidate.startsWith(`[startup] ${event} `))
  const value = line?.match(new RegExp(`(?:^| )${key}=([0-9.]+)(?: |$)`))?.[1]
  return value === undefined ? null : Number(value)
}

async function launchSample(
  session: ReturnType<typeof createRestartSession>,
  expectedPlugins: number,
  testInfo: TestInfo
): Promise<StartupSample> {
  let output = ''
  const launched = await session.launch({
    onStderr: (chunk) => {
      output += chunk
    }
  })
  try {
    await expect
      .poll(
        () => ({
          ready: parseMetric(output, 'ready-to-show', 't'),
          duration: parseMetric(output, 'plugin-system-initialized', 'durationMs'),
          count: parseMetric(output, 'plugin-system-initialized', 'installedPlugins')
        }),
        { timeout: 30_000 }
      )
      .toMatchObject({
        ready: expect.any(Number),
        duration: expect.any(Number),
        count: expectedPlugins
      })
    await testInfo.attach(`plugin-startup-${expectedPlugins}-${Date.now()}.log`, {
      body: Buffer.from(output),
      contentType: 'text/plain'
    })
    return {
      readyToShowMs: parseMetric(output, 'ready-to-show', 't')!,
      pluginDurationMs: parseMetric(output, 'plugin-system-initialized', 'durationMs')!,
      installedPlugins: parseMetric(output, 'plugin-system-initialized', 'installedPlugins')!
    }
  } finally {
    await session.close(launched.app)
  }
}

// oxlint-disable-next-line no-empty-pattern -- Playwright passes fixtures before testInfo.
test('keeps real Electron launch stable with 20 approved inert plugins', async ({}, testInfo) => {
  test.setTimeout(240_000)
  const session = createRestartSession(testInfo, { ORCA_STARTUP_DIAGNOSTICS: '1' })
  const baseline: StartupSample[] = []
  const populated: StartupSample[] = []
  let markerPaths: string[] = []
  try {
    for (let warmup = 0; warmup < WARMUP_LAUNCHES; warmup += 1) {
      seedPlugins(session.userDataDir, 0)
      await launchSample(session, 0, testInfo)
    }
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      seedPlugins(session.userDataDir, 0)
      baseline.push(await launchSample(session, 0, testInfo))
      markerPaths = seedPlugins(session.userDataDir, PLUGIN_COUNT)
      populated.push(await launchSample(session, PLUGIN_COUNT, testInfo))
    }

    // The isolated 20-sample unit gate owns the ≤50 ms P95. This app-level
    // complement measures the user-visible launch delta because background
    // discovery completion overlaps unrelated main-process startup work.
    expect(populated.every((sample) => Number.isFinite(sample.pluginDurationMs))).toBe(true)
    const verdict = evaluateStartupBudget({
      baselineMs: baseline.map((sample) => sample.readyToShowMs),
      populatedMs: populated.map((sample) => sample.readyToShowMs),
      budgetMs: STARTUP_BUDGET_MS
    })
    // Why annotated on green too: without the value in the run, the only way to
    // tell a real regression from a slow runner is to re-run and watch by hand.
    testInfo.annotations.push({ type: 'plugin-startup-budget', description: verdict.description })
    expect(verdict.withinBudget, verdict.description).toBe(true)
    expect(markerPaths.every((markerPath) => !existsSync(markerPath))).toBe(true)
  } finally {
    await session.dispose()
  }
})
