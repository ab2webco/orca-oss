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

import type { TeamMachine } from '../../../src/shared/team-panel-model-types'
import type { SupportedUiLocale } from '../../../src/shared/ui-locale'
import type { TeamMemberRow } from './team-drawer-model'
import { TeamHostsTab } from './TeamHostsTab'
import { teamWorkWordsOf } from './team-work-words'
import { button, GB, texts } from './team-sheet-render-fixtures'

type Reading = Extract<TeamMachine['reading'], { kind: 'ok' }>

const reading = (over: Partial<Reading> = {}): Reading => ({
  kind: 'ok',
  cpuCoreCount: 8,
  totalMemory: 32 * GB,
  availableMemory: 24 * GB,
  loadAverage1m: 1.5,
  cpuUsagePercent: 38,
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

const BUSY = machine('buildbox', {
  running: 2,
  cap: 3,
  status: 'working',
  reading: reading({
    cpuUsagePercent: 96,
    loadAverage1m: 9.4,
    workspaceDiskFree: 140 * GB,
    workspaceDiskTotal: 460 * GB
  })
})

const members = [
  { host: 'buildbox', ticket: 'LAB-7' },
  { host: 'buildbox', ticket: 'LAB-7' },
  { host: null, ticket: 'LAB-9' }
] as unknown as TeamMemberRow[]

const words = teamWorkWordsOf('en')

describe('TeamHostsTab board (ORCA-1252)', () => {
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

  const show = (value: TeamMachine[], locale: SupportedUiLocale = 'en') =>
    act(() =>
      root.render(
        <TeamHostsTab
          machines={{ kind: 'ready', value }}
          members={members}
          hostName="desk"
          locale={locale}
          words={teamWorkWordsOf(locale)}
        />
      )
    )

  it('draws a calm host collapsed, with its CPU, memory and disk in use', () => {
    show([machine('studio')])
    const shown = texts()

    expect(shown).toEqual(expect.arrayContaining(['CPU', '38%', 'Memory', '25%', 'Disk', '75%']))
    expect(shown.join(' ')).not.toContain('GB free')
  })

  // Why: an older Orca sends no CPU or disk, and a 0 would read as an idle, empty host.
  it("shows an older host's missing CPU and disk as unknown, never 0", () => {
    const older = reading()
    delete older.cpuUsagePercent
    delete older.workspaceDiskTotal
    delete older.workspaceDiskFree
    show([machine('veteran', { reading: older })])
    const shown = texts()

    expect(shown.filter((one) => one === '—')).toHaveLength(2)
    expect(shown).not.toContain('0%')
  })

  it('opens a busy host at first, with its readouts, load, cores and tickets', () => {
    show([machine('studio'), BUSY])
    const shown = texts()

    expect(shown).toContain('Busy · 2 of 3 agents')
    expect(shown).toContain('96%')
    expect(shown).toContain('load 9.4 · 8 cores')
    expect(shown).toContain('24 of 32 GB free')
    expect(shown).toContain('140 of 460 GB free')
    expect(shown.filter((one) => one === 'LAB-7')).toHaveLength(1)
    expect(shown).not.toContain('LAB-9')
    expect(shown).toContain('1 slot free')
  })

  // Why: the status and the launch note say what to do, so an ellipsis would hide the instruction.
  it('never cuts the status or the note that says what to do', () => {
    show([
      BUSY,
      machine('unready', { launch: { kind: 'unregistered', project: 'lab', reason: 'x' } })
    ])
    const cut = [...document.body.querySelectorAll<HTMLElement>('div')]
      .filter((one) => one.childElementCount === 0)
      .filter((one) =>
        ['Busy · 2 of 3 agents', words.notRegisteredNote('lab')].includes(one.textContent ?? '')
      )
      .map((one) => getComputedStyle(one))
      // Why no -webkit-line-clamp check: happy-dom 21 drops it; numberOfLines > 1 also sets the ellipsis.
      .filter((style) => style.textOverflow === 'ellipsis')

    expect(cut).toHaveLength(0)
  })

  // Why: on iOS a wrapped note with no set line height lost its last line ("clone and register it.").
  it('gives the status and the note a set line height, so iOS draws their last line', () => {
    show([
      BUSY,
      machine('unready', { launch: { kind: 'unregistered', project: 'lab', reason: 'x' } })
    ])
    const heights = [...document.body.querySelectorAll<HTMLElement>('div')]
      .filter((one) => one.childElementCount === 0)
      .filter((one) =>
        ['Busy · 2 of 3 agents', words.notRegisteredNote('lab')].includes(one.textContent ?? '')
      )
      .map((one) => getComputedStyle(one).lineHeight)

    expect(heights).toEqual(['16px', '16px'])
  })

  it('opens a host on a tap and keeps the choice while the sheet stays open', () => {
    show([machine('keeper')])
    act(() => button('keeper').click())
    expect(texts()).toContain('24 of 32 GB free')

    act(() => root.unmount())
    root = createRoot(container)
    show([machine('keeper')])
    expect(texts()).toContain('24 of 32 GB free')
  })

  it('sums the hosts ready to launch, the agents and the busy or low hosts', () => {
    show([
      machine('studio', { running: 1, status: 'working' }),
      BUSY,
      machine('blocked', { launch: { kind: 'refused', reason: 'no' }, status: 'attention' }),
      machine('away', { status: 'attention', reading: { kind: 'unreachable', lastSeenAt: null } })
    ])
    const shown = texts()

    expect(shown).toEqual(
      expect.arrayContaining(['Ready', 'of 4', 'Agents', 'of 11', 'Busy / low'])
    )
    expect(shown).toContain("1 can't launch · 1 offline")
    expect(shown).toContain('4 slots free')
    expect(shown).toContain('buildbox')
  })

  it('words the board in the host language', () => {
    show([machine('studio'), BUSY], 'es')
    const shown = texts()

    expect(shown).toContain('Ocupada · 2 de 3 agentes')
    expect(shown).toContain('carga 9,4 · 8 núcleos')
    expect(shown).toContain('Listas')
  })
})
