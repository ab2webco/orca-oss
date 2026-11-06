// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamDisplayPage } from './team-display-pages'
import { TeamDisplayPageView } from './team-display-page-view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
  getIntlLocale: () => 'en-US'
}))

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount()
    }
  })
})

async function render(page: TeamDisplayPage): Promise<HTMLElement> {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<TeamDisplayPageView page={page} />))
  return container
}

const figures = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll('[role="img"]')].map((one) => one.getAttribute('aria-label'))

describe('TeamDisplayPageView', () => {
  it('draws the summary counts as segment digits, with the alert in red', async () => {
    const container = await render({
      id: 'summary',
      active: 3,
      alerts: 1,
      queued: 7,
      mergedToday: 12,
      mergedPerHour24h: null,
      meters: { ciGreenPercent: null, sessionPercent: 6, weeklyPercent: 31 }
    })

    expect(figures(container)).toEqual(['3', '1', '7', '12'])
    expect(container.querySelectorAll('.text-status-attention').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('No hourly data')
    expect(container.textContent).toContain('31%')
  })

  it('names each weekday under its merges and the median lead time', async () => {
    const container = await render({
      id: 'delivery',
      merged7d: 9,
      days: [
        { day: '2026-11-05', merged: 4 },
        { day: '2026-11-06', merged: 5 }
      ],
      leadTimeMedianMs: 6_120_000
    })

    expect(figures(container)).toEqual(['9'])
    expect(container.textContent).toContain('Median 1 h 42 m')
    expect(container.textContent).toContain('TF')
  })

  it('marks an offline machine instead of drawing its load', async () => {
    const container = await render({
      id: 'machines',
      rows: [
        {
          key: 'local',
          host: { kind: 'local' },
          cpuPercent: 35,
          memoryPercent: 42,
          running: 1,
          cap: 4
        },
        {
          key: 'imac',
          host: { kind: 'remote', name: 'imac', environmentId: null, reachable: false },
          cpuPercent: null,
          memoryPercent: null,
          running: 0,
          cap: 2
        }
      ]
    })

    expect(container.querySelectorAll('[data-team-display-blocks]')).toHaveLength(2)
    expect(container.textContent).toContain('Offline')
    expect(container.textContent).toContain('0/2')
  })

  it('says what Orca has no data for on every page and draws no invented figure', async () => {
    const empty: TeamDisplayPage[] = [
      {
        id: 'summary',
        active: 0,
        alerts: null,
        queued: null,
        mergedToday: null,
        mergedPerHour24h: null,
        meters: { ciGreenPercent: null, sessionPercent: null, weeklyPercent: null }
      },
      { id: 'delivery', merged7d: null, days: [], leadTimeMedianMs: null },
      { id: 'quality', ciGreenPercent: null, ciGreenPerDay: null, flakyChecks: null },
      { id: 'machines', rows: null },
      { id: 'usage', costPerDay: null, accounts: null }
    ]
    const seen: string[] = []
    for (const page of empty) {
      const container = await render(page)
      seen.push(`${page.id}: ${figures(container).join(',')} | ${container.textContent}`)
    }

    expect(seen.join('\n')).toMatchInlineSnapshot()
  })
})
