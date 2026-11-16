// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostHeaderRow } from '../../host-section-rows'
import { HostSectionHeader } from './HostSectionHeader'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}))
vi.mock('../../HostSectionHeaderMenu', () => ({ HostSectionHeaderMenu: () => null }))
vi.mock('../../host-header-active-count', () => ({
  useHostActiveAgentCount: (worktreeIds: readonly string[]) => worktreeIds.length - 1
}))
const NOW = 10 * 3_600_000
const lastLiveAt = new Map<string, number>()
vi.mock('../../host-last-live-store', () => ({
  useHostLastLiveAt: (hostId: string) => lastLiveAt.get(hostId) ?? null
}))
vi.mock('../../../dashboard/useNow', () => ({ useNow: () => NOW }))

function host(overrides: Partial<HostHeaderRow> = {}): HostHeaderRow {
  return {
    type: 'host-header',
    key: 'host:local',
    hostId: 'local' as HostHeaderRow['hostId'],
    kind: 'local',
    label: 'Local Mac',
    detail: 'This computer',
    health: 'local',
    collapsed: false,
    count: 14,
    worktreeIds: ['a', 'b'],
    ...overrides
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(row: HostHeaderRow): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<HostSectionHeader row={row} onToggle={() => undefined} />))
  return container.querySelector('[data-host-header-drag-id]') as HTMLElement
}

afterEach(() => {
  lastLiveAt.clear()
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('HostSectionHeader as a V30 tree row (ORCA-1149)', () => {
  it('draws a plain row with how many agents are active, not a boxed card with a count pill', () => {
    const header = render(host())

    expect(header.className).not.toMatch(/\bborder\b/)
    expect(header.className).not.toMatch(/(^|\s)bg-worktree-sidebar-accent/)
    expect(header.textContent).not.toContain('14')
    expect(header.querySelector('[data-host-header-active]')?.textContent).toBe('1 active')
  })

  it('draws a remote host the same way, without its transport detail', () => {
    const header = render(
      host({ kind: 'runtime', label: 'M1', detail: 'Orca server', worktreeIds: ['a', 'b', 'c'] })
    )

    expect(header.textContent).not.toContain('Orca server')
    expect(header.className).not.toMatch(/\bborder\b/)
    expect(header.querySelector('[data-host-header-active]')?.textContent).toBe('2 active')
  })

  it('keeps the count flush right: the hover chevron and menu float in their own slot', () => {
    const header = render(host())
    const controls = header.querySelector('[data-host-header-controls]') as HTMLElement

    expect(controls.className).toMatch(/\babsolute\b/)
    expect(header.className).toMatch(/\brelative\b/)
    expect(controls.contains(header.querySelector('[data-host-header-action]'))).toBe(true)
  })

  it('names an offline host with the age of its last data, never an active count', () => {
    lastLiveAt.set('ssh:contabo', NOW - 3 * 3_600_000)
    const header = render(
      host({
        hostId: 'ssh:contabo' as HostHeaderRow['hostId'],
        kind: 'ssh',
        health: 'disconnected'
      })
    )

    expect(header.querySelector('[data-host-header-offline]')?.textContent).toBe('Offline · 3 h')
    expect(header.querySelector('[data-host-header-active]')).toBeNull()
  })

  it('says only Offline when this session never saw the host connected', () => {
    const header = render(
      host({
        hostId: 'ssh:contabo' as HostHeaderRow['hostId'],
        kind: 'ssh',
        health: 'error',
        connectionStatus: 'reconnection-failed'
      })
    )

    expect(header.querySelector('[data-host-header-offline]')?.textContent).toBe('Offline')
    expect(header.querySelector('[data-host-header-active]')).toBeNull()
  })

  it('still words a host that needs authentication', () => {
    const header = render(
      host({ kind: 'ssh', health: 'error', connectionStatus: 'auth-failed', detail: 'SSH' })
    )

    expect(header.textContent).toContain('Authentication needed')
  })
})
