import { describe, expect, it } from 'vitest'
import { teamLeadViewOf } from './team-drawer-model'

const actions = [
  { id: 'lead:wave', label: 'Wave', command: 'wave', prompt: '/orca-game:wave' },
  { id: 'lead:status', label: 'Status', command: 'status', prompt: '/orca-game:status' },
  { id: 'lead:stop', label: 'Stop', command: 'stop', prompt: '/orca-game:stop' },
  { id: 'action-0', label: 'Ship', icon: 'ship', pin: true, prompt: 'ship the release' }
]
const member = (paneKey: string, state: string) => ({
  paneKey,
  displayName: paneKey,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true
})
const controlOf = (over: Record<string, unknown> = {}) =>
  teamLeadViewOf({
    role: 'lead',
    lead: { autostart: false, cap: 4, agent: 'claude' },
    agents: [member('a', 'working'), member('b', 'idle')],
    actions,
    ...over
  })?.control

describe('the Team sheet control', () => {
  it("reads the lead's actions with the desktop's builder, Stop included", () => {
    const control = controlOf()
    expect(control?.actions.map((one) => one.id)).toEqual([
      'lead:wave',
      'lead:status',
      'lead:stop',
      'action-0'
    ])
    expect(control?.actions.find((one) => one.orca === 'stop')?.send).toBe('/orca-game:stop')
    expect(control?.stopped).toBeNull()
  })

  it('says who stopped the team and how many members still run', () => {
    const control = controlOf({ stopped: { since: '2026-11-15T10:00:00Z', by: 'lead' } })
    expect(control?.stopped).toEqual({ by: 'lead', membersRunning: 1 })
    expect(control?.actions.find((one) => one.orca === 'wave')?.off).toBe('stopped')
  })

  it('has no actions from an older host that sends none', () => {
    expect(controlOf({ actions: undefined })?.actions).toEqual([])
  })
})
