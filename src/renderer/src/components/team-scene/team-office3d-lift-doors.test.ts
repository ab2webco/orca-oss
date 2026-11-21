import { describe, expect, it } from 'vitest'
import { office3dCab } from '../../../../shared/team-scene/team-office3d-elevator'
import { OFFICE3D_CALL, office3dLobbyOf } from '../../../../shared/team-scene/team-office3d-layout'
import { office3dLiftAt } from './team-office3d-lift-doors'

describe('the lift panels and doors', () => {
  // Review ORCA-1319, second pass: the lobby's talk spots sit on the call line's depth.
  it('leaves the lobby panel dark while two idle members talk, with the cab elsewhere', () => {
    const talk = office3dLobbyOf(14).talk
    const talkers = talk.map((s) => ({ floor: 0, at: s.at, pose: 'stand' }))
    expect(office3dLiftAt(talkers, office3dCab(2), 10, 3).lit[0]).toBe(false)
  })

  it('lights the panel for whoever presses it or waits in its line', () => {
    const line = [
      { floor: 0, at: OFFICE3D_CALL, pose: 'call' },
      { floor: 0, at: [OFFICE3D_CALL[0] + 1.2, OFFICE3D_CALL[1]] as [number, number], pose: 'idle' }
    ]
    expect(office3dLiftAt(line, office3dCab(2), 10, 3).lit).toEqual([true, false, false])
    expect(office3dLiftAt(line.slice(1), office3dCab(2), 10, 3).lit[0]).toBe(true)
  })
})
