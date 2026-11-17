// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamMachine, TeamPanelModel } from '../../../../shared/team-panel-model-types'
import { TeamPanelMachinesTab } from './team-panel-machines-tab'

vi.mock('@/i18n/i18n', () => ({
  getIntlLocale: () => 'en-US',
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    Object.entries(options ?? {}).reduce(
      (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
      fallback
    )
}))

const GB = 1024 ** 3

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

type Reading = Extract<TeamMachine['reading'], { kind: 'ok' }>

const reading = (over: Partial<Reading> = {}): Reading => ({
  kind: 'ok',
  cpuCoreCount: 10,
  totalMemory: 32 * GB,
  availableMemory: 24 * GB,
  loadAverage1m: 2.5,
  cpuUsagePercent: 42,
  workspaceDiskTotal: 500 * GB,
  workspaceDiskFree: 125 * GB,
  ...over
})

const machine = (name: string, over: Partial<TeamMachine> = {}): TeamMachine => ({
  host: { kind: 'remote', name, environmentId: null, reachable: true },
  running: 0,
  cap: 4,
  status: 'idle',
  launch: { kind: 'ready' },
  reading: reading(),
  ...over
})

const member = (name: string, ticket: string) => ({
  host: { kind: 'remote', name, environmentId: null, reachable: true },
  ticket: { identifier: ticket, title: null, url: null, statusGroup: null }
})

const model = {
  kind: 'team',
  members: [member('busybox', 'LAB-7'), member('busybox', 'LAB-9')]
} as unknown as TeamPanelModel

function mount(value: TeamMachine[]): HTMLElement {
  const container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  act(() => root?.render(<TeamPanelMachinesTab value={value} model={model} selectTab={() => {}} />))
  return container
}

const remount = (value: TeamMachine[]): HTMLElement => {
  act(() => root?.unmount())
  document.body.replaceChildren()
  return mount(value)
}

const rowOf = (view: HTMLElement, name: string): HTMLElement =>
  view.querySelector(`[data-team-machine="${name}"]`)!

const gauge = (row: HTMLElement, name: string): string | null | undefined =>
  row.querySelector(`[data-team-machine-gauge="${name}"]`)?.textContent

const BUSY = machine('busybox', {
  running: 2,
  status: 'working',
  reading: reading({ cpuUsagePercent: 96, loadAverage1m: 12.6 })
})

describe('Machines board rows (ORCA-1252)', () => {
  it('draws a calm host collapsed, with its CPU, memory and disk in use', () => {
    const row = rowOf(mount([machine('studio')]), 'studio')

    expect(row.getAttribute('data-state')).toBe('closed')
    expect(gauge(row, 'cpu')).toBe('CPU42%')
    expect(gauge(row, 'memory')).toBe('Memory25%')
    expect(gauge(row, 'disk')).toBe('Disk75%')
    expect(row.textContent).not.toContain('GB free')
  })

  // Why: an older Orca sends no CPU or disk, and a 0 would read as an idle, empty host.
  it("shows an older host's missing CPU and disk as unknown, never 0", () => {
    const older = reading()
    delete older.cpuUsagePercent
    delete older.workspaceDiskTotal
    delete older.workspaceDiskFree
    const row = rowOf(mount([machine('veteran', { reading: older })]), 'veteran')

    expect(gauge(row, 'cpu')).toBe('CPU—')
    expect(gauge(row, 'disk')).toBe('Disk—')
    expect(row.textContent).not.toContain('0%')
    expect(row.querySelector('[data-team-machine-gauge="cpu"] [role="img"]')).toBeNull()
  })

  it('opens a busy host at first, with its readouts, load, cores and tickets', () => {
    const row = rowOf(mount([machine('studio'), BUSY]), 'busybox')

    expect(row.getAttribute('data-state')).toBe('open')
    expect(row.textContent).toContain('Busy · 2 of 4 agents')
    expect(row.textContent).toContain('load 12.6 · 10 cores')
    expect(row.textContent).toContain('24 of 32 GB free')
    expect(row.textContent).toContain('125 of 500 GB free')
    expect(row.textContent).toContain('LAB-7')
    expect(row.textContent).toContain('LAB-9')
  })

  // Why fresh names: the choice outlives a mount, as it must outlive a tab switch.
  it('keeps a host open or closed as the user left it while the panel stays open', () => {
    const hot = { ...BUSY, host: { ...BUSY.host, name: 'hot' } } as TeamMachine
    let view = mount([machine('keeper'), hot])
    act(() => rowOf(view, 'keeper').querySelector('button')!.click())
    act(() => rowOf(view, 'hot').querySelector('button')!.click())

    view = remount([machine('keeper'), hot])

    expect(rowOf(view, 'keeper').getAttribute('data-state')).toBe('open')
    expect(rowOf(view, 'hot').getAttribute('data-state')).toBe('closed')
    expect(rowOf(view, 'keeper').textContent).toContain('24 of 32 GB free')
  })

  it('says one free slot in the singular', () => {
    const row = rowOf(
      mount([{ ...BUSY, host: { ...BUSY.host, name: 'single' }, running: 3 } as TeamMachine]),
      'single'
    )

    expect(row.textContent).toContain('1 slot free')
    expect(row.textContent).not.toContain('1 slots')
  })

  it('names a low workspaces disk in the warning tone', () => {
    const low = machine('tight', { reading: reading({ workspaceDiskFree: 6 * GB }) })
    const row = rowOf(mount([low]), 'tight')

    expect(row.textContent).toContain('Low disk')
    expect(
      row.querySelector('[data-team-machine-readout="disk"] .text-status-warning')
    ).not.toBeNull()
  })
})
