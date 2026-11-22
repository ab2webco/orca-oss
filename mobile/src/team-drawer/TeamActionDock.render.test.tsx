import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Why: lucide's circular ESM re-exports do not load under Vite's runner; icons are not under test.
vi.mock('lucide-react-native', async () => {
  const { createElement: h } = await import('react')
  const Icon = () => h('span')
  return new Proxy(
    {},
    {
      get: (_target, name) => (typeof name === 'string' && name !== 'then' ? Icon : undefined),
      has: (_target, name) => typeof name === 'string' && name !== 'then'
    }
  )
})

import type { TeamAction } from '../../../src/shared/team-panel-actions'
import { TeamActionDock, TeamStoppedBanner } from './TeamActionDock'
import { teamDockStripOverflows } from './team-dock-strip-overflow'
import { teamControlWordsOf } from './team-control-words'
import type { TeamTurnResult } from './team-lead-turn-send'
import type { TeamSheetControl } from './team-sheet-control'

const SENT: TeamTurnResult = { outcome: 'sent', reason: null }

const action = (
  id: string,
  orca: TeamAction['orca'],
  label: string,
  icon: TeamAction['icon'],
  now: number | null
): TeamAction => ({
  id,
  orca,
  label,
  icon,
  command: null,
  pin: false,
  send: `/${label.toLowerCase()}`,
  now: now === null ? null : { count: now },
  off: null
})
const wave = action('lead:wave', 'wave', 'Wave', 'launch', 4)
const push = action('lead:push', 'push', 'Push', 'play', 2)
const sweep = action('lead:sweep', 'sweep', 'Sweep', 'check', 1)
const stop = action('lead:stop', 'stop', 'Stop', 'stop', null)
const status = action('lead:status', 'status', 'Status', 'pulse', null)
const control: TeamSheetControl = { actions: [wave, status, push, sweep, stop], stopped: null }

const texts = (): string[] =>
  [...document.body.querySelectorAll<HTMLElement>('div')]
    .filter((one) => one.childElementCount === 0)
    .map((one) => one.textContent ?? '')

function button(label: string): HTMLElement {
  const found = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!found) {
    throw new Error(`no control labelled ${label}`)
  }
  return found
}

describe('TeamActionDock', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const show = (
    onSend: (one: TeamAction) => Promise<TeamTurnResult>,
    locale: 'en' | 'es' = 'en',
    memberCount = 4
  ) =>
    act(() =>
      root.render(
        <TeamActionDock
          control={control}
          memberCount={memberCount}
          words={teamControlWordsOf(locale)}
          onSend={onSend}
        />
      )
    )

  it('docks Wave, Push and Sweep with their counts, and sends one as a lead turn on a tap', async () => {
    const onSend = vi.fn(async () => SENT)
    show(onSend)
    const shown = texts()
    expect(shown).toEqual(expect.arrayContaining(['Wave', '4', 'Push', '2', 'Sweep', '1']))
    expect(shown).not.toContain('Status')
    await act(async () => button('Wave, 4 to do, slots free').click())
    expect(onSend).toHaveBeenCalledWith(wave)
    expect(texts()).toContain('Sent to the lead: Wave')
  })

  it('keeps Stop and the menu on the chips row, with the chips in a strip that scrolls', () => {
    show(vi.fn(async () => SENT))
    const stopButton = button('Stop every member')
    let row = stopButton.parentElement
    while (row && !row.contains(button('Wave, 4 to do, slots free'))) {
      row = row.parentElement
    }
    expect(row).not.toBeNull()
    expect(getComputedStyle(row!).flexWrap).not.toBe('wrap')
    expect(row!.contains(button('All actions'))).toBe(true)
    const scrolls = (one: HTMLElement): boolean => {
      for (let at = one.parentElement; at && at !== row; at = at.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(at).overflowX)) {
          return true
        }
      }
      return false
    }
    expect(
      ['Wave, 4 to do, slots free', 'Push, 2 stopped', 'Sweep, 1 finished to close']
        .map(button)
        .every(scrolls)
    ).toBe(true)
    expect(scrolls(stopButton)).toBe(false)
    expect(scrolls(button('All actions'))).toBe(false)
  })

  it('fades the strip edge only while chips still run past it', () => {
    expect(teamDockStripOverflows(300, 250, 0)).toBe(true)
    expect(teamDockStripOverflows(300, 250, 50)).toBe(false)
    expect(teamDockStripOverflows(240, 250, 0)).toBe(false)
  })

  it('asks before stopping every member, and sends Stop only on confirm', async () => {
    const onSend = vi.fn(async () => SENT)
    show(onSend)
    act(() => button('Stop every member').click())
    expect(texts()).toContain('Stop all 4 members? They stay stopped until you push them.')
    act(() => button('Cancel').click())
    expect(texts()).not.toContain('Stop all 4 members? They stay stopped until you push them.')
    expect(onSend).not.toHaveBeenCalled()
    act(() => button('Stop every member').click())
    await act(async () => button('Stop').click())
    expect(onSend).toHaveBeenCalledWith(stop)
  })

  it('says when the lead did not get the turn, and stays quiet on a repeat press', async () => {
    show(vi.fn(async () => ({ outcome: 'failed' as const, reason: null })))
    await act(async () => button('Sweep, 1 finished to close').click())
    expect(texts()).toContain('Could not send Sweep')
    show(vi.fn(async () => ({ outcome: 'repeat' as const, reason: null })))
    await act(async () => button('Wave, 4 to do, slots free').click())
    expect(texts()).not.toContain('Sent to the lead: Wave')
  })

  it('shows the press at once, while the turn is still on its way to the lead', () => {
    show(vi.fn(() => new Promise<TeamTurnResult>(() => {})))
    act(() => button('Wave, 4 to do, slots free').click())
    expect(texts()).toContain('Sending Wave to the lead…')
  })

  it('says why the lead did not get the turn', async () => {
    show(vi.fn(async () => ({ outcome: 'failed' as const, reason: 'Terminal not found' })))
    await act(async () => button('Wave, 4 to do, slots free').click())
    expect(texts()).toContain('Could not send Wave: Terminal not found')
  })

  it('confirms how many members a Wave launched once they join the team', async () => {
    show(vi.fn(async () => SENT))
    await act(async () => button('Wave, 4 to do, slots free').click())
    show(
      vi.fn(async () => SENT),
      'en',
      7
    )
    expect(texts()).toContain('Wave launched 3 members')
  })

  it('clears what a Wave launched after a while, and a new press replaces it at once', async () => {
    vi.useFakeTimers()
    try {
      await act(async () => show(vi.fn(async () => SENT)))
      await act(async () => button('Wave, 4 to do, slots free').click())
      await act(async () =>
        show(
          vi.fn(async () => SENT),
          'en',
          5
        )
      )
      expect(texts()).toContain('Wave launched 1 member')
      await act(async () => vi.advanceTimersByTime(8_000))
      expect(texts()).not.toContain('Wave launched 1 member')
      await act(async () =>
        show(
          vi.fn(async () => SENT),
          'en',
          6
        )
      )
      expect(texts()).not.toContain('Wave launched 2 members')
      await act(async () => button('Wave, 4 to do, slots free').click())
      await act(async () =>
        show(
          vi.fn(async () => SENT),
          'en',
          7
        )
      )
      expect(texts()).toContain('Wave launched 1 member')
      act(() => button('Sweep, 1 finished to close').click())
      expect(texts()).toContain('Sending Sweep to the lead…')
      expect(texts()).not.toContain('Wave launched 1 member')
    } finally {
      vi.useRealTimers()
    }
  })

  it('words the dock in the host language', () => {
    show(vi.fn(), 'es')
    expect(texts()).toEqual(expect.arrayContaining(['Ola', 'Barrer']))
    act(() => button('Detener a todos').click())
    expect(texts()).toContain('¿Detener a los 4 miembros? Siguen parados hasta que los reactives.')
  })

  const ship: TeamAction = { ...action('action-0', null, 'Ship', 'ship', null), command: 'ship' }
  const full: TeamSheetControl = { actions: [wave, status, push, sweep, stop, ship], stopped: null }
  const showFull = (onSend: (one: TeamAction) => Promise<TeamTurnResult>) =>
    act(() =>
      root.render(
        <TeamActionDock
          control={full}
          memberCount={4}
          words={teamControlWordsOf('en')}
          onSend={onSend}
        />
      )
    )

  it('opens every action grouped as the desktop menu: Now, This project, From Orca', () => {
    showFull(vi.fn())
    act(() => button('All actions').click())
    const shown = texts()
    const at = (text: string) => shown.indexOf(text)
    expect(at('Now')).toBeLessThan(at('This project'))
    expect(at('This project')).toBeLessThan(at('From Orca'))
    expect(at('Ship')).toBeGreaterThan(at('This project'))
    expect(at('Status')).toBeGreaterThan(at('From Orca'))
    expect(shown).toContain('4 to do, slots free')
    expect(shown).toContain('Stop every member')
  })

  it('finds an action by name, and says when none matches', () => {
    showFull(vi.fn())
    act(() => button('All actions').click())
    const search = document.body.querySelector<HTMLInputElement>('[aria-label="Search actions"]')!
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(search, 'swe')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(texts()).toContain('Sweep')
    expect(texts()).not.toContain('Ship')
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(search, 'zzz')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(texts()).toContain('No action with that name.')
  })

  it('runs a picked action as a lead turn, and asks before Stop', async () => {
    const onSend = vi.fn(async () => SENT)
    showFull(onSend)
    act(() => button('All actions').click())
    await act(async () => button('Status').click())
    expect(onSend).toHaveBeenCalledWith(status)
    act(() => button('All actions').click())
    act(() => button('Stop every member').click())
    expect(texts()).toContain('Stop all 4 members? They stay stopped until you push them.')
  })

  it('shows the STOP, with launches and pushes paused while members run', () => {
    act(() =>
      root.render(
        <TeamStoppedBanner
          stopped={{ by: 'lead', membersRunning: 2 }}
          words={teamControlWordsOf('en')}
        />
      )
    )
    expect(container.textContent).toBe('Stopped by lead Launches and pushes paused')
    act(() =>
      root.render(
        <TeamStoppedBanner
          stopped={{ by: null, membersRunning: 0 }}
          words={teamControlWordsOf('es')}
        />
      )
    )
    expect(container.textContent).toBe('Detenido')
  })

  it('lets the STOP sentence wrap instead of cutting it at 320', () => {
    act(() =>
      root.render(
        <TeamStoppedBanner
          stopped={{ by: 'lead', membersRunning: 2 }}
          words={teamControlWordsOf('en')}
        />
      )
    )
    const clipped = [...container.querySelectorAll<HTMLElement>('*')].filter((one) => {
      const style = getComputedStyle(one)
      return (
        style.whiteSpace === 'nowrap' ||
        style.textOverflow === 'ellipsis' ||
        style.getPropertyValue('-webkit-line-clamp') !== ''
      )
    })
    expect(clipped.map((one) => one.textContent)).toEqual([])
  })
})
