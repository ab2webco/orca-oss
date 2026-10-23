import { afterEach, describe, expect, it } from 'vitest'

import type { GameAgent, GameState } from '../types'
import { cellWidthOf } from '../hooks/cell-width'
import {
  flatMemberLinesOf,
  flatPhaseLineOf,
  flatScoreLineOf,
  flatTextOf,
  type FlatLine
} from '../hooks/flat-view'
import { setGameLocale } from '../hooks/game-strings'
import { levelOf } from '../hooks/rewards'
import { sceneOf } from '../hooks/scenes/index'

const agent = (patch: Partial<GameAgent>): GameAgent => ({
  paneKey: 'p',
  displayName: 'a',
  agentType: 'claude',
  state: 'working',
  toolName: null,
  isLeader: false,
  ...patch
})

const state = (agents: GameAgent[]): GameState => ({
  config: {},
  warnings: [],
  extensions: { scenes: [] },
  links: [],
  activity: null,
  worktree: null,
  agents,
  review: null,
  workItem: null,
  role: 'lead'
})

const ALEX = agent({
  paneKey: 'alex',
  displayName: 'Alex · ORCA-685 Flat game mode',
  toolName: 'Edit',
  isMember: true,
  worktree: { id: 'wt-a', path: '/w/a', branch: 'orca-685', displayName: 'orca-685' },
  review: {
    provider: 'github',
    number: 553,
    title: 'feat',
    url: 'https://github.com/o/r/pull/553',
    state: 'open',
    ci: 'success'
  }
})

const crew = (count: number): GameAgent[] =>
  Array.from({ length: count }, (_, at) =>
    agent({ paneKey: `m${at}`, displayName: `Member${at} · ORCA-${700 + at}`, isMember: true })
  )

const scene = sceneOf('quest')
const WIDTHS = [40, 60, 130] as const

const linesOf = (agents: GameAgent[], columns: number, maxMembers = 6): FlatLine[] =>
  flatMemberLinesOf({ state: state(agents), scene, columns, maxMembers })

const expectFits = (lines: readonly FlatLine[], columns: number) => {
  for (const line of lines) {
    const text = flatTextOf(line)
    expect(text, `${columns}: ${text}`).not.toContain('\n')
    expect(cellWidthOf(text), `${columns}: ${text}`).toBeLessThanOrEqual(columns)
  }
}

afterEach(() => setGameLocale('en'))

describe('flatMemberLinesOf', () => {
  it('says the team is empty in one line at every width', () => {
    for (const columns of WIDTHS) {
      const lines = linesOf([], columns)
      expect(lines.map(flatTextOf)).toEqual(['No party yet.'])
      expectFits(lines, columns)
    }
  })

  it('draws one member with name, ticket, phase, activity, PR and CI on one line at 130', () => {
    const lines = linesOf([ALEX], 130)
    expect(lines.map(flatTextOf)).toEqual([
      '• Alex  ORCA-685  ⚒ Blacksmith  Editing  PR #553 open  CI green'
    ])
    expect(lines[0]?.paneKey).toBe('alex')
  })

  it('shortens the same line at 60 and 40 instead of wrapping', () => {
    expect(linesOf([ALEX], 60).map(flatTextOf)).toEqual([
      '• Alex  ORCA-685  ⚒ Blacksmith  PR #553 open  CI green'
    ])
    const narrow = linesOf([ALEX], 40)
    expectFits(narrow, 40)
    expect(flatTextOf(narrow[0] ?? { key: '', parts: [] })).toMatch(/^• Alex {2}ORCA-685 {2}⚒ /)
  })

  it('keeps one line per member and a +N line within the cap', () => {
    for (const columns of WIDTHS) {
      const lines = linesOf(crew(12), columns, 6)
      expect(lines).toHaveLength(6)
      expect(flatTextOf(lines[5] ?? { key: '', parts: [] })).toBe('+7 more')
      expectFits(lines, columns)
      expect(linesOf(crew(3), columns, 6)).toHaveLength(3)
    }
  })

  it('names a waiting member and a red CI in the member words', () => {
    const waiting = agent({ paneKey: 'w', displayName: 'Bo · ORCA-9', state: 'waiting' })
    const red = {
      ...ALEX,
      review: { ...(ALEX.review ?? ({} as never)), ci: 'failure' as const }
    }
    const texts = linesOf([waiting, red], 130).map(flatTextOf)
    expect(texts[0]).toBe('! Bo  ORCA-9  needs you')
    expect(texts[1]).toMatch(/^× Alex .* CI failing$/)
  })

  it('puts the lead first with its crown', () => {
    const lead = agent({ paneKey: 'l', displayName: 'lead', isLeader: true, state: 'idle' })
    const texts = linesOf([ALEX, lead], 130).map(flatTextOf)
    expect(texts[0]).toMatch(/^♛ lead/)
    expect(texts[1]).toMatch(/^• Alex/)
  })

  it('leaves PR and CI out for a member with no review', () => {
    const folder = agent({ paneKey: 'f', displayName: 'Cy · ORCA-12', state: 'idle' })
    expect(linesOf([folder], 130).map(flatTextOf)).toEqual(['z Cy  ORCA-12  idle'])
  })

  it('speaks Spanish with the Spanish catalog', () => {
    setGameLocale('es')
    expect(linesOf([], 60).map(flatTextOf)).toEqual(['Aún no hay grupo.'])
    expect(linesOf(crew(12), 130, 3).map(flatTextOf).at(-1)).toBe('+10 más')
    expect(linesOf([ALEX], 130).map(flatTextOf)[0]).toContain('CI en verde')
  })
})

describe('flatScoreLineOf', () => {
  it('shows level, XP and the latest rewards within the width', () => {
    const recent = [
      { label: '#553 merged', xp: 100, at: 2 },
      { label: 'ORCA-685 launched', xp: 10, at: 1 }
    ]
    const wide = flatScoreLineOf({ level: levelOf(120), recent, isDemo: false, columns: 130 })
    expect(flatTextOf(wide ?? { key: '', parts: [] })).toBe(
      'Lv 2 □□□□□ 20/200 XP · +100 #553 merged · +10 ORCA-685 launched'
    )
    for (const columns of WIDTHS) {
      const line = flatScoreLineOf({ level: levelOf(120), recent, isDemo: true, columns })
      expectFits(line === undefined ? [] : [line], columns)
      expect(flatTextOf(line ?? { key: '', parts: [] })).toMatch(/^DEMO · Lv 2/)
    }
  })

  it('shows a row that took XP away with its minus sign, in red', () => {
    const recent = [{ label: '#553 reverted', xp: -30, at: 2 }]
    const line = flatScoreLineOf({ level: levelOf(0), recent, isDemo: false, columns: 130 })
    expect(flatTextOf(line ?? { key: '', parts: [] })).toBe(
      'Lv 1 □□□□□ 0/100 XP · -30 #553 reverted'
    )
    expect(line?.parts.find((part) => part.key === 'reward-0')?.color).toBe('red')
  })

  it('draws nothing with rewards off', () => {
    expect(flatScoreLineOf({ level: undefined, recent: [], isDemo: false, columns: 60 })).toBe(
      undefined
    )
  })
})

describe('flatPhaseLineOf', () => {
  it("names the scene's card for the phase and the caption", () => {
    const line = flatPhaseLineOf(scene, 'verify', 'Running tests', 130)
    expect(flatTextOf(line)).toBe('⚔ Knight · Running tests')
    expect(line.parts[0]?.color).toBe(scene.cards.verify.color)
    expect(cellWidthOf(flatTextOf(flatPhaseLineOf(scene, undefined, 'x'.repeat(90), 40)))).toBe(40)
  })
})
