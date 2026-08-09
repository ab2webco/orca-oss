/**
 * Which PTY session a mounted pane is actually bound to.
 *
 * The store's `ptyIdsByTabId` and the pane's `data-pty-id` converge, but not
 * instantly: a cold restore re-spawns the session and rebinds the pane, so a
 * store id read before the rebind names a dead session. Resolving the target
 * from the pane itself keeps input probes off corpses.
 */

import type { Page } from '@stablyai/playwright-test'

export type PaneBindingDiagnostics = {
  /** `data-pty-id` on every mounted pane container — the id the renderer actually writes to. */
  paneDomPtyIds: string[]
  /** Session ids main reports as live, or null when the listing itself failed. */
  liveSessionIds: string[] | null
}

/**
 * The id the ACTIVE pane is currently writing to, or null while unbound.
 * `data-pty-id` is set by the same chokepoint that registers the binding with
 * main (pty-connection.ts → setPanePtyFitBinding), so it is the renderer's
 * authoritative write target.
 */
async function readActivePanePtyId(page: Page): Promise<string | null> {
  return page
    .evaluate(() => {
      for (const manager of window.__paneManagers?.values() ?? []) {
        const pane = manager.getActivePane?.() ?? manager.getPanes?.()[0]
        return (pane?.container as HTMLElement | undefined)?.dataset?.ptyId ?? null
      }
      return null
    })
    .catch(() => null)
}

/**
 * Why: a cold restore replaces the dead session with a freshly spawned one, so
 * the pane's PTY id CHANGES mid-restore. Snapshotting the store once and
 * probing that id races the rebind and addresses a corpse. Wait for the pane's
 * own binding to name a session main reports live, and probe that.
 */
export async function waitForLiveBoundPanePtyId(
  page: Page,
  timeoutMs = 30_000
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  let lastBound: string | null = null
  while (Date.now() < deadline) {
    const bound = await readActivePanePtyId(page)
    if (bound) {
      lastBound = bound
      const live = await page
        .evaluate(async () => (await window.api.pty.listSessions()).map((session) => session.id))
        .catch(() => null)
      if (live?.includes(bound)) {
        return bound
      }
    }
    await page.waitForTimeout(Math.min(200, Math.max(0, deadline - Date.now())))
  }
  return lastBound
}

/**
 * Why: every probe in this module keys off the STORE's ptyId. When a report
 * shows all three probes dead, that is ambiguous between "the pane is frozen"
 * and "the pane rebound to a different id and the probes addressed a corpse".
 * The pane's own `data-pty-id` plus main's live listing separate the two.
 */
export async function collectPaneBindingDiagnostics(page: Page): Promise<PaneBindingDiagnostics> {
  const paneDomPtyIds = await page
    .evaluate(() => {
      const ids: string[] = []
      for (const manager of window.__paneManagers?.values() ?? []) {
        for (const pane of manager.getPanes?.() ?? []) {
          const id = (pane.container as HTMLElement | undefined)?.dataset?.ptyId
          if (id) {
            ids.push(id)
          }
        }
      }
      return ids
    })
    .catch(() => [])
  const liveSessionIds = await page
    .evaluate(async () => (await window.api.pty.listSessions()).map((session) => session.id))
    .catch(() => null)
  return { paneDomPtyIds, liveSessionIds }
}
