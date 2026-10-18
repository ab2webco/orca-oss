import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_LAUNCH_HANDLERS } from './orchestrator-game-launch'
import { RuntimeClientError, type RuntimeClient } from '../runtime-client'
import { ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY } from '../../shared/protocol-version'

const TODO_ITEM = {
  id: 'CIN-12',
  title: 'Cartelera page',
  url: 'https://jira.example/browse/CIN-12',
  status: 'To Do'
}

function stateWith(overrides: Record<string, unknown> = {}) {
  return {
    config: { mode: 'on' },
    agents: [],
    worktree: { id: 'wt1', path: '/repo', branch: 'main', displayName: 'cineco' },
    project: { reviews: null, todo: { provider: 'jira', total: 1, url: null, items: [TODO_ITEM] } },
    lead: { autostart: false, cap: 2, agent: 'claude', launchPrompt: 'Implement {id}: {title}' },
    ...overrides
  }
}

const ACCOUNTS = {
  claude: {
    accounts: [{ id: 'acct_ana', email: 'ana@example.com' }],
    activeAccountId: 'acct_ana'
  },
  codex: { accounts: [{ id: 'acct_bo', email: 'bo@example.com' }], activeAccountId: null },
  rateLimits: { claude: null, codex: null, inactiveClaudeAccounts: [], inactiveCodexAccounts: [] }
}

function fakeClient(state: unknown, run: { id: string } | null = { id: 'run_1' }) {
  const calls: [string, unknown][] = []
  const results: Record<string, unknown> = {
    'game.state': state,
    'terminal.show': { terminal: { handle: 'h1' } },
    'status.get': { capabilities: [ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY] },
    'orchestration.runCurrent': { run },
    'accounts.snapshot': ACCOUNTS,
    'orchestration.runCreate': { run: { id: 'run_new', objective: 'x' } },
    'orchestration.taskCreate': { task: { id: 'task_1', status: 'ready' } },
    'orchestration.workerStart': {
      runId: 'run_1',
      taskId: 'task_1',
      dispatchId: 'dispatch_1',
      state: 'ready',
      effects: [],
      residualResources: []
    }
  }
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      return { ok: true, result: results[method] }
    }
  } as unknown as RuntimeClient
  return { client, calls }
}

const launch = (client: RuntimeClient, ticket = 'cin-12', extra: [string, string][] = []) =>
  ORCHESTRATOR_GAME_LAUNCH_HANDLERS['game launch']({
    flags: new Map([['ticket', ticket], ...extra]),
    client,
    cwd: '/repo',
    json: true
  })

describe('orca game launch', () => {
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('starts one member for a To Do ticket in its own child worktree, with the project prompt', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launch(client)

    expect(calls.map(([method]) => method)).toEqual([
      'game.state',
      'terminal.show',
      'orchestration.runCurrent',
      'orchestration.taskCreate',
      'orchestration.workerStart',
      'game.eventPost'
    ])
    expect(calls[3]?.[1]).toEqual({
      spec: 'Implement CIN-12: Cartelera page',
      taskTitle: 'Arthur · CIN-12 Cartelera page',
      callerTerminalHandle: 'h1'
    })
    expect(calls[4]?.[1]).toEqual(
      expect.objectContaining({
        task: 'task_1',
        worktree: 'new-child',
        name: 'cin-12',
        displayName: 'Arthur · CIN-12 Cartelera page',
        agent: 'claude',
        run: 'run_1',
        from: 'h1'
      })
    )
    expect(JSON.parse(output.join(''))).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          ticket: 'CIN-12',
          dispatchId: 'dispatch_1',
          state: 'ready'
        })
      })
    )
  })

  it("names the member after the scene's next free character, the ticket kept beside it", async () => {
    const holder = { paneKey: 'm', state: 'idle', displayName: 'Arthur · CIN-1 Home' }
    const { client, calls } = fakeClient(
      stateWith({ config: { mode: 'on', scene: 'quest' }, agents: [holder] })
    )

    await launch(client)

    expect(calls.find(([method]) => method === 'orchestration.taskCreate')?.[1]).toEqual(
      expect.objectContaining({ taskTitle: 'Merlin · CIN-12 Cartelera page' })
    )
    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ name: 'cin-12', displayName: 'Merlin · CIN-12 Cartelera page' })
    )
    expect(JSON.parse(output.join('')).result).toEqual(
      expect.objectContaining({ ticket: 'CIN-12', name: 'Merlin' })
    )
  })

  it("takes the character's name in the pane's UI language", async () => {
    process.env.ORCA_GAME_LOCALE = 'es'
    const { client, calls } = fakeClient(stateWith({ config: { mode: 'on', scene: 'quest' } }))

    await launch(client)

    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ displayName: 'Arturo · CIN-12 Cartelera page' })
    )
  })

  it("names the member from the project's memberNames over the scene's roster", async () => {
    const lead = { autostart: false, cap: 2, agent: 'claude', memberNames: ['Mario', 'Luigi'] }
    const holder = { paneKey: 'm', state: 'idle', displayName: 'Mario · CIN-1 Home' }
    const { client, calls } = fakeClient(
      stateWith({ config: { mode: 'on', scene: 'quest' }, lead, agents: [holder] })
    )

    await launch(client)

    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ displayName: 'Luigi · CIN-12 Cartelera page' })
    )
  })

  it('names the member after its ticket alone when the scene has no roster', async () => {
    const bare = { id: 'me/bare', pluginId: 'me', definition: {} }
    const { client, calls } = fakeClient(
      stateWith({ config: { mode: 'on', scene: 'me/bare' }, extensions: { scenes: [bare] } })
    )

    await launch(client)

    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ displayName: 'CIN-12 Cartelera page' })
    )
    expect(JSON.parse(output.join('')).result.name).toBeUndefined()
  })

  it('binds a new Run named after the lead when the terminal has none', async () => {
    const { client, calls } = fakeClient(stateWith(), null)

    await launch(client)

    expect(calls.find(([method]) => method === 'orchestration.runCreate')?.[1]).toEqual({
      objective: 'Lead of cineco: one member per ticket',
      from: 'h1'
    })
    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ run: 'run_new' })
    )
  })

  it('passes the model and effort only after the runtime says it supports them', async () => {
    const { client, calls } = fakeClient(
      stateWith({
        lead: { autostart: false, cap: 2, agent: 'claude', model: 'opus', effort: 'high' }
      })
    )

    await launch(client)

    expect(calls.map(([method]) => method)).toContain('status.get')
    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ model: 'opus', effort: 'high' })
    )
  })

  it('refuses a launch past the cap without touching orchestration', async () => {
    const member = { paneKey: 'm', state: 'working', isMember: true }
    const { client, calls } = fakeClient(
      stateWith({ agents: [member, { ...member, paneKey: 'n' }, { paneKey: 'l', state: 'idle' }] })
    )

    await expect(launch(client)).rejects.toThrow(/2 of 2 members are running/)
    expect(calls.map(([method]) => method)).toEqual(['game.state'])
  })

  it('counts a member whose turn ended as running until its PR is merged', async () => {
    const member = { paneKey: 'm', state: 'done', isMember: true }
    const { client, calls } = fakeClient(
      stateWith({ agents: [member, { ...member, paneKey: 'n', state: 'working' }] })
    )

    await expect(launch(client)).rejects.toThrow(/2 of 2 members are running/)
    expect(calls.map(([method]) => method)).toEqual(['game.state'])
  })

  it('keeps the project prompt for a ticket outside the To Do, its unknown values left empty', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launch(client, 'CIN-99')

    expect(calls.find(([method]) => method === 'orchestration.taskCreate')?.[1]).toEqual(
      expect.objectContaining({ spec: 'Implement CIN-99:', taskTitle: 'Arthur · CIN-99' })
    )
  })

  it('gives the member the --prompt task instead of the project prompt, placeholders filled', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launch(client, 'CIN-12', [
      ['prompt', '  Run the Tambora test run of {id} ({title}) and report pass/fail  ']
    ])

    expect(calls.find(([method]) => method === 'orchestration.taskCreate')?.[1]).toEqual(
      expect.objectContaining({
        spec: 'Run the Tambora test run of CIN-12 (Cartelera page) and report pass/fail'
      })
    )
  })

  it('refuses an empty or unknown-placeholder --prompt before touching orchestration', async () => {
    for (const prompt of ['   ', 'Check {ticket}']) {
      const { client, calls } = fakeClient(stateWith())

      await expect(launch(client, 'CIN-12', [['prompt', prompt]])).rejects.toThrow(/--prompt/)
      expect(calls).toEqual([])
    }
  })

  it('starts the member in another repo of the project in its own top-level worktree', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launch(client, 'CIN-12', [['repo', 'name:cineco-frontend']])

    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ worktree: 'new-top-level', repo: 'name:cineco-frontend' })
    )
  })

  it('runs the member on another agent, model and effort for this launch only', async () => {
    const { client, calls } = fakeClient(
      stateWith({
        lead: { autostart: false, cap: 2, agent: 'claude', model: 'opus', effort: 'max' }
      })
    )

    await launch(client, 'CIN-12', [
      ['agent', 'codex'],
      ['model', 'gpt-5.5'],
      ['effort', 'high']
    ])

    expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
      expect.objectContaining({ agent: 'codex', model: 'gpt-5.5', effort: 'high' })
    )
  })

  it("never hands another agent the lead's model", async () => {
    const { client, calls } = fakeClient(
      stateWith({
        lead: { autostart: false, cap: 2, agent: 'claude', model: 'opus', effort: 'max' }
      })
    )

    await launch(client, 'CIN-12', [['agent', 'codex']])

    const start = calls.find(([method]) => method === 'orchestration.workerStart')?.[1]
    expect(start).toEqual(expect.objectContaining({ agent: 'codex' }))
    expect(start).not.toHaveProperty('model')
    expect(start).not.toHaveProperty('effort')
  })

  it('refuses an agent Orca does not know and a malformed model before any call', async () => {
    const cases: [[string, string], RegExp][] = [
      [['agent', 'cobol'], /Unknown agent "cobol"/],
      [['model', 'not a model!'], /--model must be a provider model id/]
    ]
    for (const [flag, refusal] of cases) {
      const { client, calls } = fakeClient(stateWith())

      await expect(launch(client, 'CIN-12', [flag])).rejects.toThrow(refusal)
      expect(calls).toEqual([])
    }
  })

  it('refuses an effort when neither the flags nor the lead name a model', async () => {
    const { client, calls } = fakeClient(stateWith())

    await expect(launch(client, 'CIN-12', [['effort', 'high']])).rejects.toThrow(
      /--effort needs a model/
    )
    expect(calls.map(([method]) => method)).toEqual(['game.state'])
  })

  it('pins a Claude member to the named account by email or id', async () => {
    for (const selector of ['ANA@example.com', 'acct_ana']) {
      const { client, calls } = fakeClient(stateWith())

      await launch(client, 'CIN-12', [['account', selector]])

      expect(calls.find(([method]) => method === 'orchestration.workerStart')?.[1]).toEqual(
        expect.objectContaining({ agent: 'claude', claudeAccountId: 'acct_ana' })
      )
    }
  })

  it('pins a Codex member to a Codex account', async () => {
    const { client, calls } = fakeClient(stateWith())

    await launch(client, 'CIN-12', [
      ['agent', 'codex'],
      ['account', 'bo@example.com']
    ])

    const start = calls.find(([method]) => method === 'orchestration.workerStart')?.[1]
    expect(start).toEqual(expect.objectContaining({ agent: 'codex', codexAccountId: 'acct_bo' }))
    expect(start).not.toHaveProperty('claudeAccountId')
  })

  it("refuses another provider's account, and an account for an agent with none", async () => {
    const codexForClaude = fakeClient(stateWith())
    await expect(
      launch(codexForClaude.client, 'CIN-12', [['account', 'bo@example.com']])
    ).rejects.toThrow(/bo@example.com is a Codex account; a claude member needs a Claude account/)
    expect(codexForClaude.calls.map(([method]) => method)).not.toContain('orchestration.taskCreate')

    const gemini = fakeClient(stateWith())
    await expect(
      launch(gemini.client, 'CIN-12', [
        ['agent', 'gemini'],
        ['account', 'ana@example.com']
      ])
    ).rejects.toThrow(/gemini has no Orca-managed accounts/)
    expect(gemini.calls.map(([method]) => method)).toEqual(['game.state'])
  })

  it('retries a launch the network dropped once, with the same request id', async () => {
    const { client, calls } = fakeClient(stateWith())
    const options: unknown[] = []
    let failed = false
    const flaky = {
      call: async (method: string, params: unknown, option?: unknown) => {
        if (method === 'orchestration.workerStart') {
          options.push(option)
          if (!failed) {
            failed = true
            calls.push([method, params])
            throw new RuntimeClientError('runtime_unavailable', 'dropped', {
              orchestrationRequestId: 'rq_1'
            })
          }
        }
        return client.call(method, params)
      }
    } as unknown as RuntimeClient

    await launch(flaky)

    expect(calls.filter(([method]) => method === 'orchestration.workerStart')).toHaveLength(2)
    expect(options).toEqual([undefined, { orchestrationRequestId: 'rq_1' }])
    expect(JSON.parse(output.join('')).result).toEqual(
      expect.objectContaining({ dispatchId: 'dispatch_1', state: 'ready' })
    )
  })
})
