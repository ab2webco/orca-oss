/**
 * Invariant: the launch-time read of Electron's home answers even when main is
 * busy and a GC lands before it yields.
 * Needs E2E: the failure is in the V8 inspector of the shipped Electron's main
 * process, which Vitest never runs.
 *
 * Below Electron 44 a sync evaluate result is a settled promise the inspector
 * holds weakly, so that GC answers `Promise was collected`, which Playwright
 * rewords as `Execution context was destroyed` (ORCA-895, ORCA-1031).
 */

import type { ElectronApplication } from '@stablyai/playwright-test'
import { readElectronResolvedHome } from './helpers/electron-home-isolation'
import { expect, test } from './helpers/orca-app'

const FIXED_ELECTRON_MAJOR = 44
const MAIN_BUSY_MS = 2_000
const MAIN_BUSY_MARKER = 'orca-1031-main-busy'

test.use({ orcaAppExtraArgs: ['--js-flags=--expose-gc'] })

// Why the marker: main is the only one who knows the loop began, and an
// evaluate that arrives first answers normally and tests nothing.
async function keepMainBusyCollecting(electronApp: ElectronApplication): Promise<void> {
  const stderr = electronApp.process().stderr
  if (!stderr) {
    throw new Error('Electron stderr is not piped')
  }
  const busy = new Promise<void>((resolve) => {
    const onData = (chunk: Buffer): void => {
      if (chunk.toString().includes(MAIN_BUSY_MARKER)) {
        stderr.off('data', onData)
        resolve()
      }
    }
    stderr.on('data', onData)
  })
  await electronApp.evaluate(
    (_electron, { busyMs, marker }) => {
      const collect = (globalThis as { gc?: () => void }).gc
      if (!collect) {
        throw new Error('gc is not exposed')
      }
      setImmediate(() => {
        process.stderr.write(`${marker}\n`)
        const end = Date.now() + busyMs
        while (Date.now() < end) {
          collect()
        }
      })
    },
    { busyMs: MAIN_BUSY_MS, marker: MAIN_BUSY_MARKER }
  )
  await busy
}

async function hasV8Fix(electronApp: ElectronApplication): Promise<boolean> {
  const version = await electronApp.evaluate(() => process.versions.electron)
  return Number(version.split('.')[0]) >= FIXED_ELECTRON_MAJOR
}

// Why two launches: main dispatches only its first evaluate inside a busy
// stretch; later ones wait for it to yield, so one launch can test one read.
test('a settled evaluate loses its answer to a GC while main is busy', async ({ electronApp }) => {
  const fixed = await hasV8Fix(electronApp)
  await keepMainBusyCollecting(electronApp)
  const read = await electronApp
    .evaluate(({ app }) => app.getPath('home'))
    .then(
      () => 'answered',
      (error: Error) => error.message
    )
  if (fixed) {
    expect(read).toBe('answered')
  } else {
    expect(read).toContain('Execution context was destroyed, most likely because of a navigation.')
  }
})

test('the launch read of the home answers through the same GC', async ({ electronApp }) => {
  const home = await electronApp.evaluate(() => process.env.HOME)
  await keepMainBusyCollecting(electronApp)
  expect(await readElectronResolvedHome(electronApp)).toBe(home)
})
