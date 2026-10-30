import { describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import type { GameAgent, OrchestratorGameState } from '../../shared/orchestrator-game-state'
import type { GameLaunchResult } from './orchestrator-game-launch'
import { moveMemberToHost } from './orchestrator-game-move-host'

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)
const RESET = NOW + 90 * 60_000

const remoteMember: GameAgent = {
  paneKey: 'remote:ctx_a',
  displayName: 'Merlin · CIN-1631',
  agentType: 'claude',
  state: 'done',
  toolName: null,
  isLeader: false,
  isMember: true,
  terminalHandle: 'term_imac',
  worktree: { id: 'repo::/imac/cin-1631', branch: 'cin-1631', displayName: 'CIN-1631' },
  account: { provider: 'claude', id: 'remote:env_imac:ops@netsat.co', email: 'ops@netsat.co' },
  limit: { resetsAt: RESET },
  remote: { host: 'imac', stateKnown: true }
}

const state = { agents: [remoteMember] } as unknown as OrchestratorGameState

function fakeClient(workerState = 'ready') {
  const calls: [string, unknown][] = []
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push([method, params])
      if (method === 'orchestration.workerList') {
        return {
          ok: true,
          result: {
            workers: [{ dispatchId: 'ctx_a', workerState, agentTerminalHandle: 'term_imac' }]
          }
        }
      }
      return { ok: true, result: { dispatchId: 'ctx_a', state: 'stopped' } }
    }
  } as unknown as RuntimeClient
  return { client, methods: () => calls.map(([method]) => method), calls }
}

const launched = (overrides: Partial<GameLaunchResult & { refusal: unknown }> = {}) =>
  vi.fn(
    async () =>
      ({
        ticket: 'CIN-1631',
        agent: 'claude',
        account: 'ana@koombea.com',
        runId: 'run_1',
        taskId: 'task_b',
        dispatchId: 'ctx_b',
        state: 'ready',
        ...overrides
      }) as GameLaunchResult
  )

const moveWith = (client: RuntimeClient, launch: ReturnType<typeof launched>) =>
  moveMemberToHost({
    client,
    state,
    member: remoteMember,
    ticket: 'CIN-1631',
    placement: { on: 'm1', repo: 'name:cineco-backend' },
    account: 'ana@koombea.com',
    flags: new Map(),
    cwd: '/repo',
    now: NOW,
    launch
  })

describe('moving a member to another paired host (ORCA-798)', () => {
  it('starts it as a new member on the other host, then stops the old dispatch and keeps its worktree', async () => {
    const { client, methods, calls } = fakeClient()
    const launch = launched()

    const moved = await moveWith(client, launch)

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket: 'CIN-1631',
        repo: 'name:cineco-backend',
        remote: { on: 'm1', repo: 'name:cineco-backend' },
        overrides: { agent: 'claude', account: 'ana@koombea.com' }
      })
    )
    expect(calls.find(([method]) => method === 'orchestration.workerStop')?.[1]).toEqual({
      dispatch: 'ctx_a'
    })
    // Why: release would remove the old host's worktree and the work it holds.
    expect(methods()).not.toContain('orchestration.workerRelease')
    expect(moved).toEqual({
      ticket: 'CIN-1631',
      moved: true,
      via: 'host',
      from: 'imac · ops@netsat.co',
      to: 'm1 · ana@koombea.com',
      dispatchId: 'ctx_b',
      state: 'ready',
      kept: 'imac ⎇cin-1631'
    })
  })

  it('leaves the old member alone and names the earliest reset when the other host has no free account', async () => {
    const { client, methods } = fakeClient()
    const launch = launched({
      state: 'failed',
      lastError: 'Every Claude account on this host is at or near its limit.',
      refusal: { code: 'accounts_limited', data: { resetsAt: RESET } }
    })

    const moved = await moveWith(client, launch)

    expect(methods()).not.toContain('orchestration.workerStop')
    expect(moved).toMatchObject({ ticket: 'CIN-1631', moved: false, from: 'imac · ops@netsat.co' })
    expect(moved.wait).toContain('m1')
    expect(moved.wait).toContain(new Date(RESET).toISOString())
  })

  it('refuses by name when the other host cannot start it, and stops nothing', async () => {
    const { client, methods } = fakeClient()
    const launch = launched({
      state: 'failed',
      lastError: 'nobody@koombea.com is not a Claude account on this host',
      refusal: { code: 'invalid_argument' }
    })

    await expect(moveWith(client, launch)).rejects.toThrow(
      /CIN-1631 could not start on m1: nobody@koombea.com is not a Claude account/
    )
    expect(methods()).not.toContain('orchestration.workerStop')
  })

  it('does not stop a dispatch that already settled', async () => {
    const { client, methods } = fakeClient('stopped')

    await moveWith(client, launched())

    expect(methods()).not.toContain('orchestration.workerStop')
  })
})
