import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import {
  markClaudePtyExited,
  markClaudePtySpawned,
  markInjectedClaudePtySpawned
} from '../claude-accounts/live-pty-gate'
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
afterEach(() => markClaudePtyExited('pty-lead'))

type LeadDeps = {
  sessionOf: (handle: string) => Promise<GameLeadSession | null>
  resume: (session: GameLeadSession) => Promise<string>
}

// Why the cast: the lead's wiring is private, and the real panes need live PTYs and hook events.
const leadDepsOf = (runtime: OrcaRuntimeService): LeadDeps =>
  (runtime as unknown as { gameLeads: { deps: LeadDeps } }).gameLeads.deps

// Why real accounts: without them every account read fails, and a shared lead would pass for no account.
function runtimeWithAccounts(): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService(null)
  const accounts = [{ id: 'acct-lead', email: 'lead@example.com', authMethod: 'oauth' }]
  Object.assign(runtime, {
    accountServices: { claudeAccounts: { listAccounts: () => ({ accounts }) } }
  })
  return runtime
}

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
}

const STORED: GameLeadSession = {
  sessionId: 'sess-lead',
  agentArgs: '--teammate-mode auto',
  worktreeId: 'wt-lead',
  accountId: 'acct-lead'
}

describe('a game lead reopened on claim', () => {
  it("records the managed account whose vault holds the lead's conversation", async () => {
    const runtime = runtimeWithAccounts()
    leadPane(runtime, null)
    markInjectedClaudePtySpawned('pty-lead', 'acct-lead')

    expect(await leadDepsOf(runtime).sessionOf('term_lead')).toEqual(STORED)
  })

  it('records no account for a lead in the shared home, which is where its conversation is', async () => {
    const runtime = runtimeWithAccounts()
    leadPane(runtime, null)
    markClaudePtySpawned('pty-lead', 'acct-lead')

    expect(await leadDepsOf(runtime).sessionOf('term_lead')).toEqual({
      ...STORED,
      accountId: null
    })
  })

  it('records no host account for an SSH lead, whose Claude runs on the remote host', async () => {
    const runtime = runtimeWithAccounts()
    leadPane(runtime, 'ssh-1')
    markInjectedClaudePtySpawned('pty-lead', 'acct-lead')

    expect(await leadDepsOf(runtime).sessionOf('term_lead')).toEqual({
      ...STORED,
      accountId: null
    })
  })

  it('reopens the conversation on the account it ran on', async () => {
    const runtime = runtimeWithAccounts()
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

  const LEAD_TRANSCRIPT =
    '/home/me/orca/claude-accounts/acct-lead/auth/projects/-repo/sess-lead.jsonl'

  it("records where the lead's conversation lives, which names its account", async () => {
    const runtime = runtimeWithAccounts()
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
      remoteConnectionId: null,
      providerSession: { agent: 'claude', id: 'sess-lead', transcriptPath: LEAD_TRANSCRIPT }
    })

    expect(await leadDepsOf(runtime).sessionOf('term_lead')).toEqual({
      ...STORED,
      accountId: null,
      transcriptPath: LEAD_TRANSCRIPT
    })
  })

  // ORCA-718: a lead whose pane binding was gone at registration reopened on the global login.
  it('reopens a lead with no recorded account on the account its transcript lives under', async () => {
    const runtime = runtimeWithAccounts()
    const ensure = vi
      .spyOn(runtime, 'ensureAgentSession')
      .mockResolvedValue({ terminal: { handle: 'term_new' }, disposition: 'created' } as never)
    vi.spyOn(runtime, 'getExactWorkerProviderSessionIdentity').mockReturnValue({
      providerSession: { key: 'session_id', id: 'sess-lead' }
    } as never)

    await leadDepsOf(runtime).resume({
      ...STORED,
      accountId: null,
      transcriptPath: LEAD_TRANSCRIPT
    })

    expect(ensure).toHaveBeenCalledWith(expect.anything(), {}, { claudeAccountId: 'acct-lead' })
  })

  // Why: the shared transcript store lets any account resume it, so the spawn picks what a new
  // launch would get instead of naming an account that no longer exists.
  for (const [label, stored] of [
    [
      'whose transcript names a removed account',
      {
        ...STORED,
        accountId: null,
        transcriptPath: LEAD_TRANSCRIPT.replace('acct-lead', 'acct-gone')
      }
    ],
    ['whose recorded account was removed', { ...STORED, accountId: 'acct-gone' }]
  ] as const) {
    it(`reopens a lead ${label} with no account of its own, for the spawn to choose`, async () => {
      const runtime = runtimeWithAccounts()
      const ensure = vi
        .spyOn(runtime, 'ensureAgentSession')
        .mockResolvedValue({ terminal: { handle: 'term_new' }, disposition: 'created' } as never)
      vi.spyOn(runtime, 'getExactWorkerProviderSessionIdentity').mockReturnValue({
        providerSession: { key: 'session_id', id: 'sess-lead' }
      } as never)

      expect(await leadDepsOf(runtime).resume(stored)).toBe('term_new')
      expect(ensure).toHaveBeenCalledWith(expect.anything(), {}, {})
    })
  }

  it("keeps the pane's last words in the error before it closes the pane Claude left", async () => {
    const runtime = runtimeWithAccounts()
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
      'Claude exited instead of reopening the conversation on account lead@example.com: No conversation found with session ID: sess-lead'
    )
    expect(read.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0] ?? 0)
  })
})
