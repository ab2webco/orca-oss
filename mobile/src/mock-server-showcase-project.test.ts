import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { teamLeadViewOf } from './team-drawer/team-drawer-model'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('mock server showcase project', () => {
  it("fills the Team clip's PRs, merge queue, Hosts and buttons with invented lumen data only", async () => {
    vi.stubEnv('MOCK_SCENARIO', 'showcase')
    const { handleRequest } = await import('../scripts/mock-server-rpc-handlers')
    const { LEAD_WORKTREE_ID } = await import('../scripts/mock-server-showcase-scenario')
    const ws = { readyState: 1, OPEN: 1, once: () => {} } as unknown as WebSocket
    let state: unknown
    handleRequest(
      { id: 'state-1', method: 'game.state', params: { worktreeId: LEAD_WORKTREE_ID } },
      (response) => (state = response.result),
      ws
    )
    // Through the phone's own reader, as the PRs and Hosts tabs draw them.
    const view = teamLeadViewOf(state)!
    const { prs, queue, machines } = view.work

    expect([prs?.kind, queue?.kind, machines?.kind]).toEqual(['ready', 'ready', 'ready'])
    const shown = JSON.stringify(view)
    for (const text of ['Retry failed photo uploads', 'Dark mode tokens', 'ci-runner', 'studio']) {
      expect(shown).toContain(text)
    }
    expect(JSON.stringify(state)).toContain('"label":"Wave"')
    expect(JSON.stringify(state)).not.toMatch(/orca-oss|ab2web|acme|github\.com|\/Users\/dev/i)
  })
})
