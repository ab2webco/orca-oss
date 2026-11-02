import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { fakeClient, launch, stateWith } from './orchestrator-game-launch-test-fixtures'

describe('orca game launch on a paired host', () => {
  const saved = { ...process.env }
  let output: string[] = []

  beforeEach(() => {
    output = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      output.push(line)
    })
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    process.env.ORCA_PANE_KEY = 'tab:leaf'
    // Why: an Orca pane exports the host's ORCA_GAME_LOCALE; the names must not follow it.
    delete process.env.ORCA_GAME_LOCALE
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('starts the member on a paired host with the same roster name and game as a local one (ORCA-794)', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launch(client, 'CIN-12', [
      ['on', 'imac'],
      ['repo', 'name:cineco']
    ])

    expect(calls.map(([method]) => method)).not.toContain('worktree.list')
    expect(calls.find(([method]) => method === 'orchestration.taskCreate')?.[1]).toEqual(
      expect.objectContaining({ taskTitle: 'Arthur · CIN-12 Cartelera page' })
    )
    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({
        on: 'imac',
        worktree: 'new-top-level',
        repo: 'name:cineco',
        name: 'cin-12',
        displayName: 'Arthur · CIN-12 Cartelera page',
        game: true
      })
    )
    expect(JSON.parse(output.join('')).result).toEqual(
      expect.objectContaining({ ticket: 'CIN-12', name: 'Arthur' })
    )
  })

  it('refuses --on without the host repo before any call (ORCA-794)', async () => {
    const { client, calls } = fakeClient(stateWith())

    await expect(launch(client, 'CIN-12', [['on', 'imac']])).rejects.toThrow(
      /--on imac needs --repo <selector of the repo on imac>/
    )
    expect(calls).toEqual([])
  })

  it('hands accounts: auto to the host instead of pinning a local account (ORCA-798)', async () => {
    const { client, calls } = fakeClient(
      stateWith({
        lead: { autostart: false, cap: 2, agent: 'claude', accounts: 'auto' }
      })
    )

    await launch(client, 'CIN-12', [
      ['on', 'imac'],
      ['repo', 'name:cineco']
    ])

    expect(calls.map(([method]) => method)).not.toContain('accounts.snapshot')
    const started = calls.find(([method]) => method === 'orchestration.workerStart')?.[1]
    expect(started).toEqual(expect.objectContaining({ remoteAccount: 'auto' }))
    expect(started).not.toHaveProperty('claudeAccountId')
  })

  it('sends a typed account for the host to resolve and shows the email it used (ORCA-798)', async () => {
    const { client, calls } = fakeClient(stateWith(), undefined, {
      'orchestration.workerStart': {
        runId: 'run_1',
        taskId: 'task_1',
        dispatchId: 'dispatch_1',
        state: 'ready',
        account: { provider: 'claude', email: 'ana@koombea.com' }
      }
    })

    await launch(client, 'CIN-12', [
      ['on', 'imac'],
      ['repo', 'name:cineco'],
      ['account', 'ana@koombea.com']
    ])

    expect(calls.map(([method]) => method)).not.toContain('accounts.snapshot')
    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ on: 'imac', remoteAccount: 'ana@koombea.com' })
    )
    const result = JSON.parse(output.join('')).result
    expect(result).toEqual(expect.objectContaining({ account: 'ana@koombea.com' }))
    expect(result).not.toHaveProperty('accountId')
  })

  it('on a paired host, sends only an account the project allows, and never its global login (ORCA-896)', async () => {
    const lead = { autostart: false, cap: 2, agent: 'claude', accounts: ['ana@koombea.com'] }
    const remote: [string, string][] = [
      ['on', 'imac'],
      ['repo', 'name:cineco']
    ]
    const allowed = fakeClient(stateWith({ lead }))
    await launch(allowed.client, 'CIN-12', [...remote, ['account', 'ANA@koombea.com']])
    expect(allowed.calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ remoteAccount: 'ANA@koombea.com' })
    )

    const refused = fakeClient(stateWith({ lead }))
    await expect(
      launch(refused.client, 'CIN-12', [...remote, ['account', 'cy@koombea.com']])
    ).rejects.toThrow(/this project allows only ana@koombea\.com.*--account/)
    expect(refused.calls.map(([method]) => method)).not.toContain('orchestration.workerStart')
  })

  it("on a paired host, hands auto the project's list for the host to pick from (ORCA-891)", async () => {
    const lead = { autostart: false, cap: 2, agent: 'claude', accounts: ['ana@koombea.com'] }
    const status = {
      'status.get': {
        capabilities: [
          ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY,
          'orchestration.federation-member-account-allowed.v1'
        ]
      }
    }
    for (const extra of [[], [['account', 'auto']]] as [string, string][][]) {
      const { client, calls } = fakeClient(stateWith({ lead }), { id: 'run_1' }, status)
      await launch(client, 'CIN-12', [['on', 'imac'], ['repo', 'name:cineco'], ...extra])
      const start = calls.find(([method]) => method === 'orchestration.workerStart')?.[1]
      expect(start).toEqual(
        expect.objectContaining({
          remoteAccount: 'auto',
          remoteAllowedAccounts: ['ana@koombea.com']
        })
      )
      expect(start).not.toHaveProperty('remoteAccountByDefault')
    }
  })

  it('refuses the list before any start when this Orca cannot hand it to a host (ORCA-891)', async () => {
    const lead = { autostart: false, cap: 2, agent: 'claude', accounts: ['ana@koombea.com'] }
    const { client, calls } = fakeClient(stateWith({ lead }))

    await expect(
      launch(client, 'CIN-12', [
        ['on', 'imac'],
        ['repo', 'name:cineco']
      ])
    ).rejects.toThrow(/this project allows only ana@koombea\.com.*--account/)
    expect(calls.map(([method]) => method)).not.toContain('orchestration.workerStart')
  })
})
