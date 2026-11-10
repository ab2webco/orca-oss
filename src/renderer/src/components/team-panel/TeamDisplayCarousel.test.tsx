// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamMemberCard,
  TeamMetrics,
  TeamPanelGameModel
} from '../../../../shared/team-panel-model-types'
import { TeamDisplayCarousel, TEAM_DISPLAY_PAGE_MS } from './TeamDisplayCarousel'
import { teamDisplayTickerOf } from './team-display-ticker'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const language = vi.hoisted(() => ({ prefix: '' }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    language.prefix +
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en-US'
}))

const GB = 1024 ** 3

const metrics: TeamMetrics = {
  timezone: 'UTC',
  mergedPerDay: Array.from({ length: 14 }, (_, index) => ({
    day: `2026-11-${String(index + 1).padStart(2, '0')}`,
    merged: index === 13 ? 4 : 1
  })),
  mergedPerHour24h: null,
  leadTimeMedianMs: 6_120_000,
  ciGreenPercent: null,
  ciGreenPerDay: null,
  flakyChecks: null,
  accounts: [{ email: 'scloud@x.test', sessionPercent: 6, weeklyPercent: 31 }],
  costPerDay: null
}

const member = (over: Partial<TeamMemberCard>): TeamMemberCard =>
  ({
    paneKey: 'm',
    status: 'working',
    condition: 'working',
    host: { kind: 'local' },
    ticket: null,
    pr: null,
    needsYou: false,
    ...over
  }) as TeamMemberCard

const model = (over: Partial<TeamPanelGameModel> = {}): TeamPanelGameModel =>
  ({
    kind: 'team',
    members: [
      member({ paneKey: 'a' }),
      member({ paneKey: 'b', status: 'idle', condition: 'idle' })
    ],
    metrics: { kind: 'ready', value: metrics },
    inbox: { kind: 'ready', value: { forYou: 0, waiting: 0, threads: 0, answered: 0 } },
    queue: { kind: 'ready', value: [] },
    machines: {
      kind: 'ready',
      value: [
        {
          host: { kind: 'local' },
          running: 1,
          cap: 4,
          status: 'working',
          reading: {
            kind: 'ok',
            cpuCoreCount: 8,
            totalMemory: 16 * GB,
            availableMemory: 8 * GB,
            loadAverage1m: 2
          }
        }
      ]
    },
    ...over
  }) as TeamPanelGameModel

const roots: ReturnType<typeof createRoot>[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
  vi.useRealTimers()
  document.body.innerHTML = ''
})

async function render(value: TeamPanelGameModel): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<TeamDisplayCarousel model={value} />))
  return container
}

const title = (container: HTMLElement): string | null =>
  container.querySelector('[data-team-display-title]')?.textContent ?? null
const press = async (container: HTMLElement, label: string): Promise<void> => {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button, label).not.toBeNull()
  await act(async () => button!.click())
}
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))

describe('TeamDisplayCarousel', () => {
  it('opens on Summary with real counts and says the hourly chart has no data', async () => {
    const container = await render(model())

    expect(container.querySelector('[aria-roledescription="carousel"]')).not.toBeNull()
    expect(title(container)).toBe('Summary')
    const kpis = [...container.querySelectorAll('[data-team-display-kpi]')].map((one) =>
      one.querySelector('[role="img"]')?.getAttribute('aria-label')
    )
    expect(kpis).toEqual(['2', '0', '0', '4'])
    expect(container.textContent).toContain('No hourly data')
  })

  it('steps with the arrows and jumps with the dots', async () => {
    const container = await render(model())

    await press(container, 'Next metric')
    expect(title(container)).toBe('Delivery')
    expect(container.textContent).toContain('Median 1 h 42 m')
    await press(container, 'Previous metric')
    await press(container, 'Previous metric')
    expect(title(container)).toBe('Usage')
    await press(container, 'Machines')
    expect(title(container)).toBe('Machines')
    expect(
      container.querySelector('button[aria-label="Machines"]')?.getAttribute('aria-current')
    ).toBe('true')
  })

  it(`turns the page every ${TEAM_DISPLAY_PAGE_MS} ms, but not while hovered or paused`, async () => {
    const container = await render(model())
    const carousel = container.querySelector('[aria-roledescription="carousel"]')!

    await advance(TEAM_DISPLAY_PAGE_MS)
    expect(title(container)).toBe('Delivery')

    await act(async () => carousel.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await advance(TEAM_DISPLAY_PAGE_MS * 2)
    expect(title(container)).toBe('Delivery')
    await act(async () => carousel.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))

    await press(container, 'Pause the carousel')
    await advance(TEAM_DISPLAY_PAGE_MS * 2)
    expect(title(container)).toBe('Delivery')
    await press(container, 'Resume the carousel')
    await advance(TEAM_DISPLAY_PAGE_MS)
    expect(title(container)).toBe('Quality')
  })
})

describe('TeamDisplayCarousel motion', () => {
  const stage = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-team-display-stage]')!
  const drag = async (container: HTMLElement, dx: number, dy = 0) => {
    const at = (type: string, x: number, y: number) =>
      new PointerEvent(type, { bubbles: true, pointerType: 'touch', clientX: x, clientY: y })
    await act(async () => void stage(container).dispatchEvent(at('pointerdown', 200, 50)))
    await act(async () => void stage(container).dispatchEvent(at('pointermove', 200 + dx, 50 + dy)))
    await act(async () => void stage(container).dispatchEvent(at('pointerup', 200 + dx, 50 + dy)))
  }

  it('turns the page with a swipe past a fifth of the stage, and springs back short of it', async () => {
    const container = await render(model())

    await drag(container, -120)
    expect(title(container)).toBe('Delivery')
    await drag(container, 120)
    expect(title(container)).toBe('Summary')
    await drag(container, -20)
    expect(title(container)).toBe('Summary')
    await drag(container, -120, 200)
    expect(title(container)).toBe('Summary')
  })

  it('pulses the ticker dot only while the line asks for you', async () => {
    const calm = await render(model())
    expect(calm.querySelector('[data-team-display-dot]')?.className).not.toContain('animate-pulse')

    const asking = await render(
      model({
        members: [
          member({
            needsYou: true,
            ticket: { identifier: 'ORCA-1039' } as TeamMemberCard['ticket']
          })
        ]
      })
    )
    expect(asking.querySelector('[data-team-display-dot]')?.className).toContain(
      'motion-safe:animate-pulse'
    )
  })
})

describe('TeamDisplayCarousel language', () => {
  afterEach(() => {
    language.prefix = ''
  })

  it('redraws the line under the pages in a new language with the same model', async () => {
    const value = model()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<TeamDisplayCarousel model={value} />))
    language.prefix = 'es:'
    await act(async () => root.render(<TeamDisplayCarousel model={value} />))

    expect(container.querySelector('[data-team-display-ticker]')?.textContent).toBe('es:1 working')
  })
})

describe('teamDisplayTickerOf', () => {
  it('puts a member waiting on you first, as an alert', () => {
    const ticker = teamDisplayTickerOf(
      model({
        members: [
          member({
            needsYou: true,
            ticket: { identifier: 'ORCA-1039' } as TeamMemberCard['ticket']
          })
        ]
      })
    )

    expect(ticker[0]).toEqual({ text: 'ORCA-1039 is waiting for you', alert: true })
  })

  it('names failing checks and the next queued PR, else who is working', () => {
    const failing = member({
      pr: { number: 924, ci: 'failure' } as TeamMemberCard['pr'],
      ticket: { identifier: 'ORCA-1044' } as TeamMemberCard['ticket']
    })
    const queue = {
      kind: 'ready',
      value: [
        { label: '#915', position: 1 },
        { label: '#916', position: 2 }
      ]
    }

    expect(
      teamDisplayTickerOf(
        model({ members: [failing], queue: queue as TeamPanelGameModel['queue'] })
      ).map((one) => one.text)
    ).toEqual(['#924 checks failing, ORCA-1044 on it', 'Queue 2, next #915'])
    expect(teamDisplayTickerOf(model()).map((one) => one.text)).toEqual(['1 working'])
  })
})
