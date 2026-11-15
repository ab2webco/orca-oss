import { describe, expect, it } from 'vitest'
import type { GameAgent } from './orchestrator-game-state'
import { advisorReasonOf, teamAgentModelOf } from './team-panel-agent-model'

const unpinned = { model: false, effort: false }
const agentWith = (fields: Pick<GameAgent, 'advisor' | 'launch'>) => fields

describe('teamAgentModelOf', () => {
  it('names the model the session served over the label Jev last reported', () => {
    expect(
      teamAgentModelOf(
        agentWith({
          launch: { model: 'Opus 5.5', effort: 'high', source: 'session' },
          advisor: { model: 'Sonnet 5.5', effort: 'medium', pinned: unpinned }
        })
      )
    ).toMatchObject({ label: 'Opus 5.5', effort: 'high', source: 'session' })
  })

  it("credits Jev with the switch from the session's model and its reason", () => {
    expect(
      teamAgentModelOf(
        agentWith({
          launch: { model: 'Opus 5.5', effort: 'high', source: 'session' },
          advisor: {
            model: 'Opus 5.5',
            effort: 'high',
            pinned: unpinned,
            routedModel: 'claude-opus-5-5',
            sessionModel: 'claude-sonnet-5-5',
            line: 'jev · model: Opus 5.5 · high effort · code floor (Jev: code)'
          }
        })
      )?.credit
    ).toEqual({ by: 'advisor', from: 'Sonnet 5.5', reason: 'code floor (Jev: code)' })
  })

  it('shows the model alone for a member without Jev', () => {
    expect(
      teamAgentModelOf(
        agentWith({ launch: { model: 'Sonnet 5.5', effort: null, source: 'session' } })
      )
    ).toEqual({ label: 'Sonnet 5.5', effort: null, source: 'session' })
  })

  it('credits Jev without a switch when the router kept the session model', () => {
    expect(
      teamAgentModelOf(
        agentWith({
          advisor: {
            model: 'Opus 5.5',
            effort: 'high',
            pinned: unpinned,
            routedModel: 'claude-opus-5-5',
            sessionModel: 'claude-opus-5-5'
          }
        })
      )
    ).toEqual({
      label: 'Opus 5.5',
      effort: 'high',
      source: 'advisor',
      credit: { by: 'advisor', from: null, reason: null }
    })
  })
})

describe('advisorReasonOf', () => {
  it("reads the router's reason from Jev's line, in either language", () => {
    expect(
      advisorReasonOf('jev · modelo: Opus 5.5 · esfuerzo alto · Jev: código', 'Opus 5.5')
    ).toBe('Jev: código')
    expect(advisorReasonOf('jev · model: Haiku 5.5 · lowered', 'Haiku 5.5')).toBe('lowered')
  })

  it('reads no reason from a line that is not about the model', () => {
    expect(advisorReasonOf('jev · blocked `rm -rf /`: destructive', 'Opus 5.5')).toBeNull()
    expect(advisorReasonOf(null, 'Opus 5.5')).toBeNull()
    expect(advisorReasonOf('jev · model: Opus 5.5', 'Opus 5.5')).toBeNull()
  })
})
