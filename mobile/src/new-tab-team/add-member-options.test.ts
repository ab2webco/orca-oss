import { describe, expect, it } from 'vitest'
import type { OrchestratorGameState } from '../../../src/shared/orchestrator-game-state'
import { addMemberRosterOf } from './add-member-options'

const lead = {
  paneKey: 'p-lead',
  isLeader: true,
  isMember: false,
  state: 'idle',
  agentType: 'claude'
}
const member = {
  paneKey: 'p-1',
  isLeader: false,
  isMember: true,
  state: 'working',
  agentType: 'claude',
  displayName: 'ORCA-1',
  workItem: { identifier: 'ORCA-1', title: 'Held' }
}
const todo = (id: string) => ({
  id,
  title: `Title ${id}`,
  url: `u/${id}`,
  group: 'todo',
  prompt: `Work on ${id}`
})

function stateWith(extra: Partial<OrchestratorGameState>): OrchestratorGameState {
  return {
    role: 'lead',
    agents: [lead, member],
    lead: { autostart: false, cap: 4, agent: 'claude' },
    project: { todo: { items: [todo('ORCA-1'), todo('ORCA-2')] } },
    ...extra
  } as unknown as OrchestratorGameState
}

const capacity = (host: string, running: number, cap: number | null, status = 'ok') => ({
  host,
  running,
  cap,
  status,
  cpuCoreCount: 8,
  totalMemory: 16e9,
  availableMemory: 8e9,
  loadAverage1m: 1
})

describe('addMemberRosterOf', () => {
  it('lists the To Do no member holds, and the hosts a member can run on with their agents', () => {
    const roster = addMemberRosterOf(
      stateWith({
        hostCapacity: [
          capacity('local', 2, 5),
          capacity('imac', 0, 3),
          capacity('contabo', 0, 2, 'unreachable')
        ]
      } as Partial<OrchestratorGameState>)
    )

    expect(roster.todo.map((ticket) => ticket.identifier)).toEqual(['ORCA-2'])
    expect(roster.hosts).toEqual([
      { on: null, running: 2, cap: 5 },
      { on: 'imac', running: 0, cap: 3 }
    ])
  })

  it("keeps the lead's host alone when the host reports no capacity", () => {
    expect(addMemberRosterOf(stateWith({})).hosts).toEqual([{ on: null, running: 1, cap: 4 }])
  })
})
