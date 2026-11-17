// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { gameCharacterLevelOf } from '../../../../shared/orchestrator-game-characters'
import type { TeamXp } from '../../../../shared/team-xp-model'
import { TeamXpRow } from './TeamXpRow'

// Lv 17 starts at 13600 XP; the lead's case is 200 XP to Lv 18, then +300.
const LV17 = 13_600
const merged = { id: 'review-merged:#41', label: '#41 merged', xp: 100 }
const done = { id: 'work-item-done:plane:ORCA-12', label: 'ORCA-12 Done', xp: 300 }
const xpAt = (total: number, recent: TeamXp['recent']): TeamXp => ({
  ...gameCharacterLevelOf(total),
  total,
  recent
})

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

let root: Root | null = null
let container: HTMLElement

const draw = (xp: TeamXp): void =>
  act(() =>
    root!.render(
      <TooltipProvider>
        <TeamXpRow xp={xp} />
      </TooltipProvider>
    )
  )

const pick = (selector: string): HTMLElement | null => container.querySelector(selector)
const chip = (): string | undefined => pick('[data-team-xp-level]')?.textContent ?? undefined
const fillWidth = (): string | undefined => pick('[data-team-xp] .bg-foreground\\/60')?.style.width
const advance = (ms: number): void => act(() => void vi.advanceTimersByTime(ms))

function reduceMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    addEventListener: () => {},
    removeEventListener: () => {}
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('TeamXpRow', () => {
  it('says what it measures and what is left', () => {
    reduceMotion(false)
    draw(xpAt(LV17 + 1500, [merged]))

    expect(chip()).toBe('Lv 17')
    expect(pick('[data-team-xp]')?.textContent).toContain('200 XP to Lv 18')
    expect(pick('[data-team-xp-note]')).toBeNull()
  })

  // ORCA-1264 lead review: +300 at 200 to Lv 18 lands on 100/1800, '1700 XP to Lv 19'.
  it('fills the old level, then lands the new one on the ledger carry-over', () => {
    reduceMotion(false)
    draw(xpAt(LV17 + 1500, [merged]))
    draw(xpAt(LV17 + 1800, [done, merged]))

    expect(chip()).toBe('Lv 17')
    expect(pick('[data-team-xp]')?.textContent).toContain('200 XP to Lv 18')
    expect(pick('[data-team-xp-float]')?.textContent).toBe('Level 18!')
    expect(pick('[data-team-xp-note]')?.textContent).toBe('+300 · ORCA-12 Done')

    advance(450)
    expect(chip()).toBe('Lv 18')

    advance(700)
    expect(pick('[data-team-xp]')?.textContent).toContain('1700 XP to Lv 19')
    expect(pick('[data-team-xp-gain]')?.style.width).toBe(`${(100 / 1800) * 100}%`)

    advance(2700)
    expect(pick('[data-team-xp-gain]')).toBeNull()
    expect(pick('[data-team-xp-note]')).toBeNull()
    expect(fillWidth()).toBe(`${(100 / 1800) * 100}%`)
  })

  it('grows a plain gain from where the bar stood and names its reward', () => {
    reduceMotion(false)
    draw(xpAt(LV17 + 1400, []))
    draw(xpAt(LV17 + 1500, [merged]))

    // The count starts from the old figure; the new one never flashes first.
    expect(pick('[data-team-xp-left]')?.textContent).toBe('300 XP to Lv 18')
    expect(fillWidth()).toBe(`${(1400 / 1700) * 100}%`)
    expect(Number.parseFloat(pick('[data-team-xp-gain]')!.style.width)).toBeCloseTo(
      (100 / 1700) * 100
    )
    expect(pick('[data-team-xp-float]')?.textContent).toBe('+100 · #41 merged')

    advance(2800)
    expect(pick('[data-team-xp-float]')).toBeNull()
    expect(fillWidth()).toBe(`${(1500 / 1700) * 100}%`)
    expect(pick('[data-team-xp]')?.textContent).toContain('200 XP to Lv 18')
  })

  it('shows a level-up at once and in words when motion is reduced', () => {
    reduceMotion(true)
    draw(xpAt(LV17 + 1500, [merged]))
    draw(xpAt(LV17 + 1800, [done, merged]))

    expect(chip()).toBe('Lv 18')
    expect(pick('[data-team-xp]')?.textContent).toContain('1700 XP to Lv 19')
    expect(fillWidth()).toBe(`${(100 / 1800) * 100}%`)
    expect(pick('[data-team-xp-gain]')).toBeNull()
    expect(pick('[data-team-xp-float]')).toBeNull()
    expect(pick('[data-team-xp-note]')?.textContent).toBe('Level 18! +300 · ORCA-12 Done')

    advance(4000)
    expect(pick('[data-team-xp-note]')).toBeNull()
  })
})
