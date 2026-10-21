import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { GameLeadSession } from './orchestrator-game-leads'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

import { OrcaRuntimeService } from './orca-runtime'

userData.dir = mkdtempSync(join(tmpdir(), 'orca-lead-resume-runtime-'))
afterAll(() => rmSync(userData.dir, { recursive: true, force: true }))

type LeadDeps = {
  sessionOf: (handle: string) => Promise<GameLeadSession | null>
  resume: (session: GameLeadSession) => Promise<string>
}

// Why the cast: the lead's wiring is private, and the real panes need live PTYs and hook events.
const leadDepsOf = (runtime: OrcaRuntimeService): LeadDeps =>
  (runtime as unknown as { gameLeads: { deps: LeadDeps } }).gameLeads.deps

function leadPane(runtime: OrcaRuntimeService, remoteConnectionId: string | null): void {
  vi.spyOn(runtime, 'snapshotClaudeTerminalSwitchTarget').mockResolvedValue({
    ok: true,
    terminal: 'term_lead',
    ptyId: 'pty-lead',
    paneKey: 'tab-1:lead',
    worktreeId: 'wt-lead',
    cwd: userData.dir,
    launchConfig: { agentCommand: 'claude --teammate-mode auto', agentArgs: '' } as never,
    isWsl: false,
    wslDistro: null,
    remoteConnectionId,
    providerSession: { agent: 'claude', id: 'sess-lead' }
  })
  vi.spyOn(runtime, 'getManagedPtyAccountOwner').mockReturnValue({
    known: true,
    accountId: 'acct-lead',
    customEndpoint: false
  })
}

const STORED: GameLeadSession = {
  sessionId: 'sess-lead',
  agentArgs: '--teammate-mode auto',
  worktreeId: 'wt-lead',
  accountId: 'acct-lead'
}

describe('a game lead reopened on claim', () => {
  it('records the managed account its pane runs on', async () => {
    const runtime = new OrcaRuntimeService(null)
    leadPane(runtime, null)

    expect(await leadDepsOf(runtime).sessionOf('term_lead')).toEqual(STORED)
  })

  it('records no host account for an SSH lead, whose Claude runs on the remote host', async () => {
    const runtime = new OrcaRuntimeService(null)
    leadPane(runtime, 'ssh-1')

    expect(await leadDepsOf(runtime).sessionOf('term_lead')).toEqual({
      ...STORED,
      accountId: null
    })
  })

  it('reopens the conversation on the account it ran on', async () => {
    const runtime = new OrcaRuntimeService(null)
    const ensure = vi
      .spyOn(runtime, 'ensureAgentSession')
      .mockResolvedValue({ terminal: { handle: 'term_new' }, disposition: 'created' } as never)
    vi.spyOn(runtime, 'getExactWorkerProviderSessionIdentity').mockReturnValue({
      providerSession: { key: 'session_id', id: 'sess-lead' }
    } as never)

    expect(await leadDepsOf(runtime).resume(STORED)).toBe('term_new')
    expect(ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        worktree: 'id:wt-lead',
        agent: 'claude',
        providerSession: { key: 'session_id', id: 'sess-lead' }
      }),
      {},
      { claudeAccountId: 'acct-lead' }
    )
  })

  it("keeps the pane's last words in the error before it closes the pane Claude left", async () => {
    const runtime = new OrcaRuntimeService(null)
    vi.spyOn(runtime, 'ensureAgentSession').mockResolvedValue({
      terminal: { handle: 'term_new' },
      disposition: 'created'
    } as never)
    vi.spyOn(runtime, 'getExactWorkerProviderSessionIdentity').mockReturnValue(null)
    const foreground = ['claude', 'zsh']
    vi.spyOn(runtime, 'inspectTerminalProcess').mockImplementation(
      async () => ({ foregroundProcess: foreground.shift() ?? 'zsh' }) as never
    )
    const read = vi.spyOn(runtime, 'readTerminal').mockResolvedValue({
      tail: [
        "% claude --resume 'sess-lead'",
        'No conversation found with session ID: sess-lead',
        '% '
      ]
    } as never)
    const close = vi.spyOn(runtime, 'closeTerminal').mockResolvedValue({} as never)

    await expect(leadDepsOf(runtime).resume(STORED)).rejects.toThrow(
      'Claude exited instead of reopening the conversation on account acct-lead: No conversation found with session ID: sess-lead'
    )
    expect(read.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0] ?? 0)
  })
})
