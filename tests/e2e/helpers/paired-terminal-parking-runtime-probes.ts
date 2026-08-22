import type { Page } from '@stablyai/playwright-test'
import { toHostSessionTabId } from '../../../src/shared/terminal-surface-id'
import { expect } from './orca-app'

export type RemoteTab = {
  marker: string
  originalPtyId: string
  tabId: string
  terminal: string
  worktreeId: string
}

export async function callRuntime<TResult>(
  page: Page,
  method: string,
  params: unknown
): Promise<TResult> {
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

export async function expectHostTerminalsUnmounted(
  hostPage: Page | undefined,
  activeWorktreeId: string,
  remoteTabs: RemoteTab[]
): Promise<void> {
  if (!hostPage) {
    return
  }
  await expect
    .poll(
      () =>
        hostPage.evaluate(
          (tabIds) => ({
            activeWorktreeId: window.__store?.getState().activeWorktreeId,
            mountedCount: tabIds.filter((tabId) => window.__paneManagers?.has(tabId)).length
          }),
          remoteTabs.map(({ tabId }) => toHostSessionTabId(tabId))
        ),
      { timeout: 30_000 }
    )
    .toEqual({ activeWorktreeId, mountedCount: 0 })
}
