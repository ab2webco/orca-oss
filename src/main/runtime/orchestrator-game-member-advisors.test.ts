import { describe, expect, it } from 'vitest'
import type { GameMemberAdvisorReport } from '../../shared/orchestrator-game-member-advisor'
import { GameMemberAdvisors } from './orchestrator-game-member-advisors'

const MINUTE = 60_000
const pinned = { model: false, effort: true }
const on = (model: string | null, effort: string | null = 'high') => ({ model, effort, pinned })

describe('GameMemberAdvisors', () => {
  it('keeps what each member pane last reported, with no switch at first', () => {
    const store = new GameMemberAdvisors()
    store.note('pane-a', on('Opus 5.5'), 0)
    expect(store.of('pane-a', 1)).toEqual(on('Opus 5.5'))
    expect(store.of('pane-b', 1)).toBeNull()
  })

  it('a changed model or effort keeps what the member was on before as its latest switch', () => {
    const store = new GameMemberAdvisors()
    store.note('pane-a', on('Opus 5.5'), 0)
    store.note('pane-a', on('Opus 5.5'), 1)
    store.note('pane-a', on('Sonnet 5.5'), 2)
    expect(store.of('pane-a', 3)).toEqual({
      ...on('Sonnet 5.5'),
      previous: { model: 'Opus 5.5', effort: 'high' }
    })
    store.note('pane-a', on('Sonnet 5.5'), 4)
    store.note('pane-a', on('Sonnet 5.5', 'low'), 5)
    expect(store.of('pane-a', 6)?.previous).toEqual({ model: 'Sonnet 5.5', effort: 'high' })
  })

  it('a pin change alone is no switch', () => {
    const store = new GameMemberAdvisors()
    store.note('pane-a', on('Opus 5.5'), 0)
    store.note('pane-a', { ...on('Opus 5.5'), pinned: { model: true, effort: true } }, 1)
    expect(store.of('pane-a', 2)).toEqual({
      ...on('Opus 5.5'),
      pinned: { model: true, effort: true }
    })
  })

  it('null forgets the member, and a report not renewed for 3 minutes expires', () => {
    const store = new GameMemberAdvisors()
    store.note('pane-a', on('Opus 5.5'), 0)
    store.note('pane-a', null, 1)
    expect(store.of('pane-a', 2)).toBeNull()
    store.note('pane-b', on('Opus 5.5'), 0)
    expect(store.of('pane-b', 3 * MINUTE - 1)).not.toBeNull()
    expect(store.of('pane-b', 3 * MINUTE)).toBeNull()
  })

  it('an expired report starts over: the next one carries no switch', () => {
    const store = new GameMemberAdvisors()
    store.note('pane-a', on('Opus 5.5'), 0)
    store.note('pane-a', on('Sonnet 5.5'), 4 * MINUTE)
    expect(store.of('pane-a', 4 * MINUTE)?.previous).toBeUndefined()
  })

  it('holds a bounded number of panes, dropping the stalest first', () => {
    const store = new GameMemberAdvisors(2)
    store.note('pane-a', on('A'), 0)
    store.note('pane-b', on('B'), 1)
    store.note('pane-a', on('A'), 2)
    store.note('pane-c', on('C'), 3)
    expect(store.of('pane-b', 4)).toBeNull()
    expect(store.of('pane-a', 4)?.model).toBe('A')
    expect(store.of('pane-c', 4)?.model).toBe('C')
  })

  it("notes a pane's raw report: null forgets, one it cannot read leaves the last", () => {
    const store = new GameMemberAdvisors()
    const raw = { version: 1, model: 'Opus 5.5', effort: 'high', pinned: { effort: true } }
    store.noteReport('pane-a', raw, 0)
    expect(store.of('pane-a', 1)).toEqual(on('Opus 5.5'))
    store.noteReport('pane-a', { version: 2 }, 1)
    store.noteReport('pane-a', undefined, 1)
    expect(store.of('pane-a', 2)).toEqual(on('Opus 5.5'))
    store.noteReport('pane-a', null, 2)
    expect(store.of('pane-a', 3)).toBeNull()
  })
})

describe('GameMemberAdvisors kept copy', () => {
  const keptIn = () => {
    const kept = new Map<string, GameMemberAdvisorReport>()
    return {
      kept,
      durable: {
        read: (paneKey: string) => kept.get(paneKey) ?? null,
        write: (paneKey: string, report: GameMemberAdvisorReport | null) => {
          if (report === null) {
            kept.delete(paneKey)
          } else {
            kept.set(paneKey, report)
          }
        }
      }
    }
  }

  it('answers with the last report after it expired from memory', () => {
    const { durable } = keptIn()
    const store = new GameMemberAdvisors(undefined, durable)
    store.note('pane-a', on('Opus 5.5'), 0)
    expect(store.of('pane-a', 4 * MINUTE)).toEqual(on('Opus 5.5'))
  })

  it('answers with the last report after a restart, before the member reports again', () => {
    const { durable } = keptIn()
    new GameMemberAdvisors(undefined, durable).note('pane-a', on('Opus 5.5'), 0)
    expect(new GameMemberAdvisors(undefined, durable).of('pane-a', 0)).toEqual(on('Opus 5.5'))
  })

  it('a null report clears the kept copy too', () => {
    const { kept, durable } = keptIn()
    const store = new GameMemberAdvisors(undefined, durable)
    store.note('pane-a', on('Opus 5.5'), 0)
    expect(kept.has('pane-a')).toBe(true)
    store.note('pane-a', null, 1)
    expect(kept.has('pane-a')).toBe(false)
    expect(store.of('pane-a', 2)).toBeNull()
  })
})
