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
import { teamControlWordsOf } from './team-control-words'
import type { TeamSheetControl } from './team-sheet-control'

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
    onSend: (one: TeamAction) => Promise<'sent' | 'repeat' | 'failed'>,
    locale: 'en' | 'es' = 'en'
  ) =>
    act(() =>
      root.render(
        <TeamActionDock
          control={control}
          memberCount={4}
          words={teamControlWordsOf(locale)}
          onSend={onSend}
        />
      )
    )

  it('docks Wave, Push and Sweep with their counts, and sends one as a lead turn on a tap', async () => {
    const onSend = vi.fn(async () => 'sent' as const)
    show(onSend)
    const shown = texts()
    expect(shown).toEqual(expect.arrayContaining(['Wave', '4', 'Push', '2', 'Sweep', '1']))
    expect(shown).not.toContain('Status')
    await act(async () => button('Wave, 4 to do, slots free').click())
    expect(onSend).toHaveBeenCalledWith(wave)
    expect(texts()).toContain('Sent to the lead: Wave')
  })

  it('asks before stopping every member, and sends Stop only on confirm', async () => {
    const onSend = vi.fn(async () => 'sent' as const)
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
    show(vi.fn(async () => 'failed' as const))
    await act(async () => button('Sweep, 1 finished to close').click())
    expect(texts()).toContain('Could not send Sweep')
    show(vi.fn(async () => 'repeat' as const))
    await act(async () => button('Wave, 4 to do, slots free').click())
    expect(texts()).not.toContain('Sent to the lead: Wave')
  })

  it('words the dock in the host language', () => {
    show(vi.fn(), 'es')
    expect(texts()).toEqual(expect.arrayContaining(['Ola', 'Barrer']))
    act(() => button('Detener a todos').click())
    expect(texts()).toContain('¿Detener a los 4 miembros? Siguen parados hasta que los reactives.')
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
    expect(texts().filter(Boolean)).toEqual(['Stopped by lead', 'Launches and pushes paused'])
    act(() =>
      root.render(
        <TeamStoppedBanner
          stopped={{ by: null, membersRunning: 0 }}
          words={teamControlWordsOf('es')}
        />
      )
    )
    expect(texts().filter(Boolean)).toEqual(['Detenido'])
  })
})
