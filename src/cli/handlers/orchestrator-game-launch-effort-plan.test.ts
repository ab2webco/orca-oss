import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, launch, stateWith } from './orchestrator-game-launch-test-fixtures'
import type { RuntimeClient } from '../runtime-client'
import { gameKindEffortPlanOf } from '../../shared/orchestrator-game-effort-plan'
import {
  ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY,
  ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY
} from '../../shared/protocol-version'

// Why its own client: the shared fake advertises no capability, so no launch there picks a model.
function capableClient(): { client: RuntimeClient; firstRecord: () => unknown } {
  const fake = fakeClient(stateWith())
  const call = fake.client.call.bind(fake.client)
  fake.client.call = (async (method: string, params: unknown) =>
    method === 'status.get'
      ? {
          ok: true,
          result: {
            capabilities: [
              ORCHESTRATION_WORKER_LAUNCH_PREFERENCES_RUNTIME_CAPABILITY,
              ORCHESTRATION_WORKER_LAUNCH_CHOSEN_BY_RUNTIME_CAPABILITY
            ]
          }
        }
      : call(method, params as Record<string, unknown>)) as RuntimeClient['call']
  return {
    client: fake.client,
    firstRecord: () =>
      (fake.calls.find(([method]) => method === 'game.memberRecord')?.[1] as { member: unknown })
        ?.member
  }
}

describe("game launch seeds the ticket's effort plan (ORCA-1242)", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.ORCA_WORKTREE_ID = 'wt1'
    process.env.ORCA_TERMINAL_HANDLE = 'h1'
    delete process.env.ORCA_GAME_LOCALE
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.env = { ...saved }
    process.exitCode = undefined
  })

  it('saves the kind plan with the member when the kind picked its model', async () => {
    const { client, firstRecord } = capableClient()
    await launch(client, 'cin-12', [['kind', 'review']])
    expect(firstRecord()).toEqual(
      expect.objectContaining({ ticket: 'CIN-12', effortPlan: gameKindEffortPlanOf('review') })
    )
  })

  it('saves no plan when --model pinned the member', async () => {
    const { client, firstRecord } = capableClient()
    await launch(client, 'cin-12', [['model', 'claude-haiku-5-5']])
    expect(firstRecord()).not.toHaveProperty('effortPlan')
  })
})
