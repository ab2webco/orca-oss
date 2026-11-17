import { describe, expect, it } from 'vitest'
import { GameMemberStewards } from './orchestrator-game-member-stewards'
import { GAME_MEMBER_ADVISOR_TTL_MS } from './orchestrator-game-member-advisors'

const report = (model: string, stepsSeen = 1) => ({
  version: 1,
  session: 's1',
  ticket: 'ORCA-12',
  model,
  effort: 'high',
  phase: 'implement',
  plan: 'plan',
  standDown: null,
  pinned: { model: false, effort: false },
  stepsSeen,
  decisions: []
})

describe('GameMemberStewards', () => {
  it("keeps each pane's last report until it goes quiet", () => {
    const store = new GameMemberStewards()
    expect(store.noteReport('pane-a', report('claude-opus-5-5'), 0).changed).toBe(true)
    expect(store.of('pane-a', 1)?.model).toBe('claude-opus-5-5')
    expect(store.of('pane-b', 1)).toBeNull()
    expect(store.of('pane-a', GAME_MEMBER_ADVISOR_TTL_MS)).toBeNull()
  })

  it('a step count alone is no change; a new pick is', () => {
    const store = new GameMemberStewards()
    store.noteReport('pane-a', report('claude-sonnet-5-5', 1), 0)
    expect(store.noteReport('pane-a', report('claude-sonnet-5-5', 9), 1).changed).toBe(false)
    expect(store.of('pane-a', 2)?.stepsSeen).toBe(9)
    expect(store.noteReport('pane-a', report('claude-opus-5-5', 9), 2).changed).toBe(true)
  })

  it('an unreadable report leaves the last; null forgets it', () => {
    const store = new GameMemberStewards()
    store.noteReport('pane-a', report('claude-opus-5-5'), 0)
    expect(store.noteReport('pane-a', { version: 9 }, 1)).toEqual({ steward: null, changed: false })
    expect(store.of('pane-a', 2)?.model).toBe('claude-opus-5-5')
    expect(store.noteReport('pane-a', null, 3).changed).toBe(true)
    expect(store.of('pane-a', 4)).toBeNull()
  })

  it('evicts the stalest pane past its cap', () => {
    const store = new GameMemberStewards(2)
    store.noteReport('pane-a', report('a'), 0)
    store.noteReport('pane-b', report('b'), 1)
    store.noteReport('pane-a', report('a2'), 2)
    store.noteReport('pane-c', report('c'), 3)
    expect(store.of('pane-b', 4)).toBeNull()
    expect(store.of('pane-a', 4)?.model).toBe('a2')
  })
})
