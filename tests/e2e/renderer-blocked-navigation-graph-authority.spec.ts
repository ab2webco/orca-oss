import { test, expect } from './helpers/orca-app'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeStatus } from '../../src/shared/runtime-types'
import { waitForSessionReady } from './helpers/store'

declare global {
  var __blockedNavigationStartedLoading: boolean | undefined
}

test('blocked navigation preserves the renderer document and graph authority', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)

  await electronApp.evaluate(({ BrowserWindow, shell }) => {
    shell.openExternal = async () => undefined
    const contents = BrowserWindow.getAllWindows()[0]!.webContents
    contents.on('did-start-loading', () => {
      globalThis.__blockedNavigationStartedLoading = true
    })
  })
  await orcaPage.evaluate(() => {
    ;(window as unknown as { __blockedNavigationCanary: string }).__blockedNavigationCanary =
      'alive'
    const anchor = document.createElement('a')
    anchor.href = 'https://example.invalid/blocked'
    document.body.append(anchor)
    anchor.click()
  })

  await expect
    .poll(() => electronApp.evaluate(() => globalThis.__blockedNavigationStartedLoading))
    .toBe(true)
  expect(
    await orcaPage.evaluate(
      () => (window as unknown as { __blockedNavigationCanary?: string }).__blockedNavigationCanary
    )
  ).toBe('alive')
  await expect
    .poll(async () => {
      const status = (await client.call<RuntimeStatus>('status.get')).result
      return {
        authoritativeWindowId: status.authoritativeWindowId,
        graphStatus: status.graphStatus,
        rendererGraphEpoch: status.rendererGraphEpoch
      }
    })
    .toEqual({ authoritativeWindowId: 1, graphStatus: 'ready', rendererGraphEpoch: 0 })
})
