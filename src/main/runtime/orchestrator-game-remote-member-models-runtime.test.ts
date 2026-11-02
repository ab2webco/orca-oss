import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'

const hook = (extra: Record<string, unknown> = {}) => ({
  paneKey: 'tab:933',
  state: 'working' as const,
  prompt: '',
  agentType: 'claude',
  connectionId: null,
  receivedAt: 42,
  stateStartedAt: 40,
  ...extra
})

describe("a host's reading of a federated member's activity and model (ORCA-933)", () => {
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const database of databases) {
      database.close()
    }
    databases.length = 0
  })

  function hostWith(rows: ReturnType<typeof hook>[]): OrcaRuntimeService {
    const runtime = new OrcaRuntimeService(null, undefined, { getAgentStatusSnapshot: () => rows })
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    runtime.setOrchestrationDb(db)
    vi.spyOn(runtime, 'getTerminalPaneKey').mockReturnValue('tab:933')
    vi.spyOn(
      runtime as unknown as { getTerminalHandleForPaneKey: () => string | null },
      'getTerminalHandleForPaneKey'
    ).mockReturnValue('term_933')
    vi.spyOn(
      runtime as unknown as { gameMemberLimitFor: () => Promise<unknown> },
      'gameMemberLimitFor'
    ).mockResolvedValue(null)
    return runtime
  }

  it('relays the running tool and the Jev report its member pane posted', async () => {
    const runtime = hostWith([hook({ toolName: 'Bash' })])
    await runtime
      .getOrchestratorGameState({
        paneKey: 'tab:933',
        advisor: {
          version: 1,
          model: 'Opus 5.5',
          effort: 'medium',
          pinned: { model: false, effort: false }
        }
      })
      .catch(() => null)

    const agent = await runtime.getFederatedMemberAgent('term_933')

    expect(agent?.toolName).toBe('Bash')
    expect(agent?.advisor).toMatchObject({ model: 'Opus 5.5', effort: 'medium' })
  })

  it("relays the model a Jev-less member's hooks named, labelled as its session", async () => {
    const runtime = hostWith([hook({ model: 'claude-sonnet-5-5', effort: 'low' })])

    const agent = await runtime.getFederatedMemberAgent('term_933')

    expect(agent).not.toHaveProperty('advisor')
    expect(agent?.launch).toEqual({ model: 'Sonnet 5.5', effort: 'low', source: 'session' })
  })

  it('relays nothing about a model when neither Jev nor its hooks named one', async () => {
    const agent = await hostWith([hook()]).getFederatedMemberAgent('term_933')

    expect(agent).not.toHaveProperty('advisor')
    expect(agent).not.toHaveProperty('launch')
  })
})
