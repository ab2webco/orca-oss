import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import type { OrcaEvent } from '../../shared/orca-events'
import { makePaneKey } from '../../shared/stable-pane-id'
import type { AgentStatusEventSource } from '../plugins/plugin-agent-status-event'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const TAB_ID = 'events-tab'
const WORKTREE_ID = 'wt-1'
const PANE_KEY = makePaneKey(TAB_ID, LEAF_ID)

async function createRuntime(
  subscribeAgentStatusEvents?: (listener: (event: AgentStatusEventSource) => void) => () => void
): Promise<{ runtime: OrcaRuntimeService; handle: string }> {
  const runtime = new OrcaRuntimeService(null, undefined, { subscribeAgentStatusEvents })
  const internals = runtime as unknown as {
    resolveTerminalWorkspaceLaunchScope: (selector: string) => Promise<unknown>
  }
  vi.spyOn(internals, 'resolveTerminalWorkspaceLaunchScope').mockResolvedValue({
    id: WORKTREE_ID,
    path: '/repo/app',
    connectionId: null,
    repo: null,
    folderWorkspace: null
  })
  runtime.setPtyController({
    spawn: vi.fn().mockResolvedValue({ id: 'pty-events' }),
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => null
  })
  const created = await runtime.createTerminal(`id:${WORKTREE_ID}`, {
    tabId: TAB_ID,
    leafId: LEAF_ID,
    title: 'Terminal'
  })
  return { runtime, handle: created.handle }
}

describe('OrcaRuntimeService.subscribeOrcaEvents', () => {
  it('streams hook status with the handle `orca terminal` commands accept', async () => {
    const listeners = new Set<(event: AgentStatusEventSource) => void>()
    const { runtime, handle } = await createRuntime((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    })
    const events: OrcaEvent[] = []
    const unsubscribe = await runtime.subscribeOrcaEvents({ names: ['agent.*'] }, (event) =>
      events.push(event)
    )

    listeners.forEach((listener) =>
      listener({
        worktreeId: WORKTREE_ID,
        paneKey: PANE_KEY,
        receivedAt: 5,
        payload: { state: 'waiting', agentType: 'claude' }
      })
    )

    expect(events).toEqual([
      {
        name: 'agent.status.changed',
        at: 5,
        worktreeId: WORKTREE_ID,
        terminal: handle,
        payload: { paneKey: PANE_KEY, state: 'waiting', agentType: 'claude' }
      }
    ])
    unsubscribe()
    expect(listeners.size).toBe(0)
  })

  it('still subscribes when no hook source is wired, e.g. a bare headless host', async () => {
    const { runtime } = await createRuntime()
    const unsubscribe = await runtime.subscribeOrcaEvents({ names: [] }, () => {})
    expect(() => unsubscribe()).not.toThrow()
  })
})
