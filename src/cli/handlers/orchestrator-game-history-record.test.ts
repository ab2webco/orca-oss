import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recordFreedMember } from './orchestrator-game-history-record'
import type { GameStopWorker } from './orchestrator-game-stop'
import type { GameAgent } from '../../shared/orchestrator-game-state'
import type { GameHistoryRecord } from '../../shared/orchestrator-game-history'

type Mail = { to_handle: string; from_handle: string; type: string; body: string; sequence: number }
type Client = Parameters<typeof recordFreedMember>[0]['client']

const LEAD = 'term_lead'
const RUN = 'run_1'

const member = (over: Partial<GameAgent> = {}): GameAgent =>
  ({
    paneKey: 'tab:leaf',
    displayName: 'Arthur · E2E-1',
    agentType: 'codex',
    state: 'idle',
    isLeader: false,
    isMember: true,
    terminalHandle: 'term_member',
    worktree: { id: 'wt_member', branch: 'e2e-1', displayName: 'e2e-1' },
    ...over
  }) as GameAgent

const worker = (over: Partial<GameStopWorker>): GameStopWorker => ({
  dispatchId: 'ctx_1',
  runId: RUN,
  agentTerminalHandle: 'term_member',
  workerState: 'failed',
  terminalState: 'reclaimable',
  ...over
})

/** Answers each RPC as the runtime does: mail by the address it was sent to. */
function clientWith(mail: Mail[]) {
  const recorded: GameHistoryRecord[] = []
  const client = {
    call: async (method: string, params: Record<string, unknown>) => {
      if (method === 'orchestration.inbox') {
        const to = mail
          .filter((one) => one.to_handle === params.terminal)
          .sort((a, b) => b.sequence - a.sequence)
        return { result: { messages: to, count: to.length } }
      }
      if (method === 'orchestration.workerShow') {
        return { result: { worker: { created_at: `launched ${params.dispatch}` } } }
      }
      if (method === 'game.historyRecord') {
        recorded.push(params.record as GameHistoryRecord)
        return { result: { recorded: true } }
      }
      throw new Error(`unexpected ${method}`)
    }
  } as unknown as Client
  return { client, recorded }
}

async function recordOf(
  agent: GameAgent,
  workers: GameStopWorker[],
  mail: Mail[]
): Promise<GameHistoryRecord> {
  const { client, recorded } = clientWith(mail)
  const failure = await recordFreedMember({
    client,
    member: agent,
    freedBy: 'stop',
    workers,
    roster: []
  })
  expect(failure).toBeNull()
  return recorded[0]!
}

describe('recordFreedMember (ORCA-1005)', () => {
  const saved = process.env.ORCA_TERMINAL_HANDLE
  beforeEach(() => {
    process.env.ORCA_TERMINAL_HANDLE = LEAD
  })
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.ORCA_TERMINAL_HANDLE
    } else {
      process.env.ORCA_TERMINAL_HANDLE = saved
    }
  })

  it("keeps a member's worker_done that was addressed to its run", async () => {
    const record = await recordOf(
      member(),
      [worker({})],
      [
        {
          to_handle: `run:${RUN}`,
          from_handle: 'term_member',
          type: 'worker_done',
          body: 'CI red',
          sequence: 4
        }
      ]
    )
    expect(record.lastReport).toBe('CI red')
  })

  it("keeps a remote member's report, which arrives from its dispatch", async () => {
    const remote = member({
      paneKey: 'remote:ctx_r',
      terminalHandle: undefined,
      remote: { host: 'box', stateKnown: true }
    })
    const record = await recordOf(
      remote,
      [worker({ dispatchId: 'ctx_r', agentTerminalHandle: null })],
      [
        {
          to_handle: LEAD,
          from_handle: 'dispatch:ctx_r',
          type: 'escalation',
          body: 'Blocked on box',
          sequence: 2
        }
      ]
    )
    expect(record.lastReport).toBe('Blocked on box')
    expect(record.launchedAt).toBe('launched ctx_r')
  })

  it('records a member whose dispatch already failed as failed, with its launch', async () => {
    const record = await recordOf(member(), [worker({ workerState: 'failed' })], [])
    expect(record).toMatchObject({ outcome: 'failed', launchedAt: 'launched ctx_1' })
  })

  it("takes the newest report across the lead's and the run's mail, and only this member's", async () => {
    const record = await recordOf(
      member(),
      [worker({ workerState: 'succeeded' })],
      [
        {
          to_handle: LEAD,
          from_handle: 'term_member',
          type: 'escalation',
          body: 'old',
          sequence: 1
        },
        {
          to_handle: `run:${RUN}`,
          from_handle: 'term_member',
          type: 'worker_done',
          body: 'new',
          sequence: 7
        },
        {
          to_handle: `run:${RUN}`,
          from_handle: 'term_other',
          type: 'worker_done',
          body: 'other',
          sequence: 9
        },
        {
          to_handle: `run:${RUN}`,
          from_handle: 'term_member',
          type: 'heartbeat',
          body: 'alive',
          sequence: 8
        }
      ]
    )
    expect(record).toMatchObject({ lastReport: 'new', outcome: 'stopped' })
  })
})
