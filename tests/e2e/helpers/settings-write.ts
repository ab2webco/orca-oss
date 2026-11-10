import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import type { GlobalSettings } from '../../../src/shared/global-settings-types'

type WriteFlag = { __e2eSettingsIssued?: number; __e2eSettingsWrite?: number }

/**
 * Applies a settings update through the store and waits until it has landed.
 * Why not `await updateSettings` inside an evaluate: on Electron 43 the V8 inspector holds that
 * answer only weakly, so a GC can turn a write that succeeded into "Execution context was
 * destroyed" (ORCA-895). The evaluate starts the write and returns a plain value; a poll reads a
 * counter the write bumps once it settles, as `readElectronResolvedHome` does for main.
 */
export async function writeSettings(page: Page, updates: Partial<GlobalSettings>): Promise<void> {
  const ticket = await page.evaluate((next) => {
    const flag = window as unknown as WriteFlag
    const mine = (flag.__e2eSettingsIssued ?? 0) + 1
    flag.__e2eSettingsIssued = mine
    void window
      .__store!.getState()
      .updateSettings(next)
      .then(() => {
        flag.__e2eSettingsWrite = Math.max(flag.__e2eSettingsWrite ?? 0, mine)
      })
    return mine
  }, updates)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as WriteFlag).__e2eSettingsWrite ?? 0))
    .toBeGreaterThanOrEqual(ticket)
}
