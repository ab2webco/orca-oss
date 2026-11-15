import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals } from '../agent-hooks/server'
import { buildBody, PANE, postHookEvent } from '../agent-hooks/server.test-fixtures'
import { OrcaRuntimeService } from './orca-runtime'
import { gameFleetOf } from './orchestrator-game-fleet'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 2 })
}))

// Captured on Claude Code 2.1.325: its hooks up to an open Bash permission prompt, and Orca's
// terminal reads of that pane with the prompt open and after each way it ends (ORCA-1231).
const FIXTURES = join(__dirname, '..', '..', 'shared', '__fixtures__', 'claude-permission-prompt')
const HOOKS = JSON.parse(readFileSync(join(FIXTURES, 'hooks-until-prompt.json'), 'utf8')) as Record<
  string,
  unknown
>[]
const screen = (name: string): string[] =>
  readFileSync(join(FIXTURES, `${name}.txt`), 'utf8').split('\n')

beforeEach(() => _internals.resetCachesForTests())
afterEach(() => vi.restoreAllMocks())

// Why the real server: Esc, "No" and an auto-block fire no hook after PermissionRequest, so only the
// screen can tell the lead the prompt is gone.
describe('a member whose permission prompt ends with no hook (ORCA-1231)', () => {
  const withPromptOpen = async (): Promise<AgentHookServer> => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    for (const payload of HOOKS) {
      expect((await postHookEvent(server, buildBody(payload))).status).toBe(204)
    }
    return server
  }

  const hostReading = (server: AgentHookServer, tail: string[]) => {
    const runtime = new OrcaRuntimeService(null, undefined, {
      getAgentStatusSnapshot: () => server.getStatusSnapshot()
    })
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue(PANE)
    vi.spyOn(
      runtime as unknown as { getTerminalHandleForPaneKey: (paneKey: string) => string | null },
      'getTerminalHandleForPaneKey'
    ).mockReturnValue('term_member')
    vi.spyOn(runtime, 'readTerminal').mockResolvedValue({ tail } as never)
    return runtime
  }

  it('leaves the hook row waiting, which is why the screen must decide', async () => {
    const server = await withPromptOpen()
    try {
      expect(server.getStatusSnapshot()).toEqual([
        expect.objectContaining({ paneKey: PANE, state: 'waiting', toolName: 'Bash' })
      ])
    } finally {
      server.stop()
    }
  })

  it('relays the member waiting on its Bash prompt while the prompt is open', async () => {
    const server = await withPromptOpen()
    try {
      const agent = await hostReading(server, screen('dialog-pending')).getFederatedMemberAgent(
        'term_member'
      )
      expect(agent).toMatchObject({ state: 'waiting', toolName: 'Bash' })
    } finally {
      server.stop()
    }
  })

  it.each(['after-esc', 'after-no', 'after-auto-block'])(
    'relays it no longer waiting once the prompt is gone (%s)',
    async (name) => {
      const server = await withPromptOpen()
      try {
        const agent = await hostReading(server, screen(name)).getFederatedMemberAgent('term_member')
        expect(agent).toMatchObject({ state: 'done' })
        expect(agent).not.toHaveProperty('toolName')
      } finally {
        server.stop()
      }
    }
  )

  it("shows a local member the same way in the lead's fleet", async () => {
    const server = await withPromptOpen()
    try {
      const runtime = hostReading(server, screen('after-esc'))
      const [row] = server.getStatusSnapshot()
      const fleet = await gameFleetOf({
        agents: [
          {
            paneKey: PANE,
            parentPaneKey: 'tab:lead',
            state: row!.state,
            agentType: 'claude',
            displayName: 'Toadette · ORCA-1216',
            taskTitle: null,
            toolName: row!.toolName ?? null,
            toolInput: row!.toolInput
          }
        ],
        members: [],
        leaderPaneKey: 'tab:lead',
        teamHandles: null,
        terminalHandleOf: () => 'term_member',
        activityOf: () => null,
        readMemberWork: undefined,
        readLinkedStatus: undefined,
        screenStateOf: (member) => runtime.gameScreenStateFor(member)
      })
      expect(fleet[0]).toMatchObject({ state: 'done', toolName: null })
      expect(fleet[0]).not.toHaveProperty('toolInput')
    } finally {
      server.stop()
    }
  })
})
