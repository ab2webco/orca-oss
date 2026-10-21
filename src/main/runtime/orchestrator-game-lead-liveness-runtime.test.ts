import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import { makePaneKey } from '../../shared/stable-pane-id'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

import { OrcaRuntimeService } from './orca-runtime'

const WORKTREE_ID = 'repo-lead::/tmp/game-lead-liveness'
const LEAD = { tabId: 'tab-lead', leafId: '11111111-1111-4111-8111-111111111111' }
const CALLER = { tabId: 'tab-caller', leafId: '22222222-2222-4222-8222-222222222222' }

afterEach(() => {
  rmSync(userData.dir, { recursive: true, force: true })
})

// Why the casts: a real lead needs `orca game lead` from a placed Claude pane; the pane graph here is real.
function runtimeWithLeadPane(leadPtyId: string, leadConnectionId: string | null = null) {
  userData.dir = mkdtempSync(join(tmpdir(), 'orca-lead-liveness-'))
  const ptyIdOf = new Map([
    [LEAD, leadPtyId],
    [CALLER, 'pty-caller']
  ])
  const alive = new Set(ptyIdOf.values())
  const store = {
    getRepos: () => [],
    getRepo: () => undefined,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    getSettings: () => ({ workspaceDir: '/tmp/workspaces' }),
    getProjects: () => [],
    getWorkspaceSession: () => getDefaultWorkspaceSession(),
    setWorkspaceSession: () => undefined
  }
  const runtime = new OrcaRuntimeService(store as never)
  runtime.setPtyController({
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => null,
    // Why: the provider's inspection throws terminal_gone for a PTY it no longer holds.
    inspectProcess: async (ptyId) => {
      if (!alive.has(ptyId)) {
        throw new Error('terminal_gone')
      }
      return { foregroundProcess: 'claude', hasChildProcesses: true }
    }
  })
  runtime.attachWindow(1)
  for (const [pane, ptyId] of ptyIdOf) {
    runtime.registerPty(ptyId, WORKTREE_ID, pane === LEAD ? leadConnectionId : null, pane)
  }
  const syncGraph = () =>
    runtime.syncWindowGraph(1, {
      tabs: [...ptyIdOf.keys()].map((pane) => ({
        tabId: pane.tabId,
        worktreeId: WORKTREE_ID,
        title: 'Claude',
        activeLeafId: pane.leafId,
        layout: { type: 'leaf' as const, leafId: pane.leafId }
      })),
      leaves: [...ptyIdOf].map(([pane, ptyId], index) => ({
        tabId: pane.tabId,
        worktreeId: WORKTREE_ID,
        leafId: pane.leafId,
        paneRuntimeId: index + 1,
        ptyId: ptyId || null
      }))
    })
  syncGraph()
  for (const ptyId of alive) {
    runtime.onPtySpawned(ptyId)
  }
  const internals = runtime as unknown as {
    getTerminalHandleForPaneKey: (paneKey: string) => string | null
    gameBoardProjectOf: (caller: { terminalHandle?: string }) => Promise<unknown>
  }
  const handleOf = (pane: typeof LEAD) =>
    internals.getTerminalHandleForPaneKey(makePaneKey(pane.tabId, pane.leafId))!
  vi.spyOn(internals, 'gameBoardProjectOf').mockImplementation(async (args) => ({
    key: 'repo:lead',
    isMember: false,
    memberTicket: null,
    lead: { handle: args.terminalHandle!, paneKey: null }
  }))
  const leads = runtime.getGameLeads()
  return {
    lead: handleOf(LEAD),
    caller: handleOf(CALLER),
    /** The renderer drops an exited pane's ptyId from its graph, unless it has not seen the exit yet. */
    exitLead: (exitCode: number, renderer: 'dropsPtyId' | 'keepsPtyId' | 'notSynced') => {
      alive.delete(leadPtyId)
      runtime.onPtyExit(leadPtyId, exitCode)
      if (renderer === 'dropsPtyId') {
        ptyIdOf.set(LEAD, '')
      }
      if (renderer !== 'notSynced') {
        syncGraph()
      }
    },
    listed: async () => (await leads.list()).leads.map((one) => one.handle),
    claimFrom: (terminalHandle: string) =>
      leads.register({ terminalHandle, project: 'orca-oss', label: 'Alfred', claim: true })
  }
}

describe('game lead liveness, through the runtime', () => {
  it('keeps a lead whose pane runs Claude, and turns another claiming pane away', async () => {
    const game = runtimeWithLeadPane('pty-lead')
    await expect(game.claimFrom(game.lead)).resolves.toEqual({ registered: true })

    await expect(game.claimFrom(game.caller)).resolves.toEqual({
      registered: false,
      live: { handle: game.lead }
    })
    expect(await game.listed()).toEqual([game.lead])
  })

  it.each(['dropsPtyId', 'keepsPtyId', 'notSynced'] as const)(
    'drops a lead whose Claude session exited (renderer %s), so another pane claims it',
    async (renderer) => {
      const game = runtimeWithLeadPane('pty-lead')
      await game.claimFrom(game.lead)

      game.exitLead(0, renderer)

      expect(await game.listed()).toEqual([])
      await expect(game.claimFrom(game.caller)).resolves.toEqual({ registered: true })
      expect(await game.listed()).toEqual([game.caller])
    }
  )

  it.each(['dropsPtyId', 'notSynced'] as const)(
    'drops an SSH lead whose Claude session exited (renderer %s)',
    async (renderer) => {
      const game = runtimeWithLeadPane('ssh:conn-1@@relay-lead', 'conn-1')
      await game.claimFrom(game.lead)

      game.exitLead(0, renderer)

      expect(await game.listed()).toEqual([])
      await expect(game.claimFrom(game.caller)).resolves.toEqual({ registered: true })
    }
  )

  it('keeps an SSH lead through a relay drop, inside the reconnect grace', async () => {
    const game = runtimeWithLeadPane('ssh:conn-1@@relay-lead', 'conn-1')
    await game.claimFrom(game.lead)

    game.exitLead(-1, 'notSynced')

    expect(await game.listed()).toEqual([game.lead])
    await expect(game.claimFrom(game.caller)).resolves.toEqual({
      registered: false,
      live: { handle: game.lead }
    })
  })
})
