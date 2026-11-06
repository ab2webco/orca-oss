// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TeamMachine,
  TeamPanelModel,
  TeamPrList,
  TeamPrRow
} from '../../../../shared/team-panel-model-types'
import { TeamPanelMachinesTab } from './team-panel-machines-tab'
import { TeamPanelPrsTab } from './team-panel-prs-tab'

vi.mock('@/i18n/i18n', () => ({
  getIntlLocale: () => 'en-US',
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    Object.entries(options ?? {}).reduce(
      (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
      fallback
    )
}))

const GB = 1024 ** 3
const model = {} as TeamPanelModel
const selectTab = vi.fn()

let root: Root | null = null
let host: HTMLElement | null = null

function mount(node: React.JSX.Element): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root?.render(node))
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

const row = (over: Partial<TeamPrRow> = {}): TeamPrRow => ({
  label: '#924',
  number: 924,
  title: 'Keep a remote member',
  url: 'https://example.test/924',
  status: 'attention',
  reason: 'checksFailed',
  memberKey: null,
  ...over
})

const list = (rows: TeamPrRow[], over: Partial<TeamPrList> = {}): TeamPrList => ({
  rows,
  total: rows.length,
  listUrl: 'https://example.test/pulls',
  ...over
})

const prs = (value: TeamPrList): HTMLElement =>
  mount(<TeamPanelPrsTab value={value} model={model} selectTab={selectTab} />)

describe('TeamPanelPrsTab', () => {
  it('draws the label, the title and why it is in that state, linked to the PR', () => {
    const view = prs(list([row()]))
    const link = view.querySelector('a[data-team-pr="#924"]')

    expect(link?.getAttribute('href')).toBe('https://example.test/924')
    expect(link?.textContent).toContain('#924')
    expect(link?.textContent).toContain('Keep a remote member')
    expect(link?.textContent).toContain('Check failed')
  })

  it.each([
    ['conflict', 'Conflict'],
    ['inReview', 'In review'],
    ['ready', 'Ready'],
    ['draft', 'Draft'],
    ['checksUnknown', 'CI unknown']
  ] as const)('names %s', (reason, word) => {
    expect(prs(list([row({ reason })])).textContent).toContain(word)
  })

  it('shows a GitLab label as sent', () => {
    const view = prs(list([row({ label: '!12', reason: 'checksUnknown', status: 'idle' })]))

    expect(view.querySelector('a[data-team-pr="!12"]')).not.toBeNull()
    expect(view.textContent).not.toContain('Ready')
  })

  it('links to the full list when the host kept only some rows', () => {
    const view = prs(list([row()], { total: 12 }))
    const more = view.querySelector('a[data-team-pr-more]')

    expect(more?.getAttribute('href')).toBe('https://example.test/pulls')
    expect(more?.textContent).toContain('12')
  })

  it('offers no link when every row is shown, or the host has no list', () => {
    expect(prs(list([row()])).querySelector('a[data-team-pr-more]')).toBeNull()
    act(() => root?.unmount())
    const noUrl = prs(list([row()], { total: 12, listUrl: null }))

    expect(noUrl.querySelector('a[data-team-pr-more]')).toBeNull()
  })
})

const machine = (over: Partial<TeamMachine> = {}): TeamMachine => ({
  host: { kind: 'remote', name: 'm1', environmentId: null, reachable: true },
  running: 0,
  cap: 5,
  status: 'idle',
  reading: {
    kind: 'ok',
    cpuCoreCount: 8,
    totalMemory: 32 * GB,
    availableMemory: 28 * GB,
    loadAverage1m: 1
  },
  ...over
})

const machines = (value: TeamMachine[]): HTMLElement =>
  mount(<TeamPanelMachinesTab value={value} model={model} selectTab={selectTab} />)

describe('TeamPanelMachinesTab', () => {
  it('reads a free host with its memory', () => {
    const view = machines([machine()])

    expect(view.textContent).toContain('m1')
    expect(view.textContent).toContain('Free')
    expect(view.textContent).toContain('28 of 32 GB free')
  })

  it('names the local machine in the UI language', () => {
    expect(machines([machine({ host: { kind: 'local' } })]).textContent).toContain('local')
  })

  it('counts agents against the cap, and alone when the host has none', () => {
    expect(machines([machine({ running: 3, status: 'working' })]).textContent).toContain(
      '3 of 5 agents'
    )
    act(() => root?.unmount())
    expect(machines([machine({ running: 3, cap: null, status: 'working' })]).textContent).toContain(
      '3 agents'
    )
  })

  it('says low memory rather than the agent count', () => {
    const view = machines([machine({ running: 2, status: 'risk' })])

    expect(view.textContent).toContain('Low memory')
    expect(view.textContent).not.toContain('2 of 5')
  })

  it('fills the bar with the memory in use, and says so to a screen reader', () => {
    const view = machines([machine()])
    const bar = view.querySelector('[role="img"]')

    expect(bar?.getAttribute('aria-label')).toBe('Memory used 13%')
    const fill = bar?.firstElementChild as HTMLElement | null | undefined
    expect(fill?.style.transform).toBe('scaleX(0.125)')
  })

  it('draws an unreachable host as offline, with no invented figures', () => {
    const view = machines([
      machine({ status: 'attention', reading: { kind: 'unreachable', lastSeenAt: null } })
    ])

    expect(view.textContent).toContain('Offline')
    expect(view.textContent).not.toContain('GB')
    expect(view.querySelector('[role="img"]')).toBeNull()
  })
})
