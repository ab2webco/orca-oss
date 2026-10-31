/**
 * Invariant: an awaited `window.api.settings.set` always settles, and a CDP
 * `awaitPromise` evaluation that awaits it gets its answer — even when a GC
 * lands between the reply and the inspector delivering it.
 * Needs E2E: the chain is the real preload, contextBridge, `ipcRenderer.invoke`
 * and the V8 inspector of the shipped Electron; none of it runs under Vitest.
 *
 * Electron 43.x ships V8 15.0, whose inspector holds the awaited promise only
 * weakly. Once it settles, its reaction jobs no longer reference it, so a GC
 * before the inspector's job runs answers `Promise was collected` for a call
 * that succeeded (ORCA-895). Fixed upstream in V8 5177b10891 (crbug 536271637,
 * V8 15.2, Electron 44); this spec pins both sides of that boundary.
 */

import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const FIXED_ELECTRON_MAJOR = 44

test.use({ orcaAppExtraArgs: ['--js-flags=--expose-gc'] })

async function electronMajor(electronApp: ElectronApplication): Promise<number> {
  const version = await electronApp.evaluate(() => process.versions.electron)
  return Number(version.split('.')[0])
}

async function persistedTheme(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const settings = (await window.api.settings.get()) as { theme?: unknown }
    return settings.theme
  })
}

test('keeps a pending settings.set alive through a full GC', async ({ orcaPage }) => {
  // Why: the preload, contextBridge proxy and native invoke must hold the
  // resolver while main has not replied; a dropped link would be collected here.
  const theme = await orcaPage.evaluate(async () => {
    const collect = (globalThis as { gc?: () => void }).gc
    if (!collect) {
      throw new Error('gc is not exposed')
    }
    const pending = window.api.settings.set({ theme: 'dark' })
    collect()
    collect()
    const settings = (await pending) as { theme?: unknown }
    return settings.theme
  })
  expect(theme).toBe('dark')
})

test('answers an awaited settings.set when a GC lands after it settles', async ({
  orcaPage,
  electronApp
}) => {
  const fixed = (await electronMajor(electronApp)) >= FIXED_ELECTRON_MAJOR

  // Raw CDP: one microtask hop puts the GC between settling and the
  // inspector's reaction job.
  const cdp = await orcaPage.context().newCDPSession(orcaPage)
  const raw = await cdp
    .send('Runtime.evaluate', {
      expression: `(async () => {
        const settings = await window.api.settings.set({ theme: 'light' })
        queueMicrotask(() => gc())
        return settings.theme
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
    .then(
      (response) => ({ value: response.result.value as unknown, error: null }),
      (error: Error) => ({ value: undefined, error: error.message })
    )
  await cdp.detach()
  expect(await persistedTheme(orcaPage)).toBe('light')
  if (fixed) {
    expect(raw).toEqual({ value: 'light', error: null })
  } else {
    expect(raw.error).toContain('Promise was collected')
  }

  // page.evaluate: Playwright's utility script wraps the page function in one
  // more async step, so the GC needs a second hop; Playwright 1.59 rewords the
  // CDP error with a trailing period (renderer-recovery-reload.md).
  const viaPage = await orcaPage
    .evaluate(async () => {
      const settings = (await window.api.settings.set({ theme: 'dark' })) as { theme?: unknown }
      const collect = (globalThis as { gc?: () => void }).gc
      queueMicrotask(() => queueMicrotask(() => collect?.()))
      return settings.theme
    })
    .then(
      (value) => ({ value, error: null }),
      (error: Error) => ({ value: undefined, error: error.message })
    )
  expect(await persistedTheme(orcaPage)).toBe('dark')
  if (fixed) {
    expect(viaPage).toEqual({ value: 'dark', error: null })
  } else {
    expect(viaPage.error).toContain(
      'Execution context was destroyed, most likely because of a navigation.'
    )
  }
})
