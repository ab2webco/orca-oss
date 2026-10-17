// @vitest-environment happy-dom
/**
 * The Resource Manager tooltip and the SSH segment's host count were built from
 * bare English literals inside helper functions, so they stayed English while
 * every label around them translated. The coverage audit cannot see values
 * returned from helpers, so only a runtime assertion against the real catalog
 * keeps them honest — same reasoning as
 * `src/renderer/src/i18n/settings-status-label-localization.test.ts`.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SshConnectionStatus } from '../../../../shared/ssh-types'
import { i18n } from '@/i18n/i18n'
import {
  formatTerminalSessionCount,
  getResourceManagerAriaLabel,
  getResourceManagerTooltipLines
} from './resource-manager-terminal-copy'
import { SshStatusSegment } from './SshStatusSegment'

type StoreState = {
  sshConnectionStates: Map<string, { status: SshConnectionStatus }>
  sshTargetLabels: Map<string, string>
  remoteWorkspaceSyncStatusByTargetId: Record<string, { phase: string }>
}

let storeState: StoreState = {
  sshConnectionStates: new Map(),
  sshTargetLabels: new Map(),
  remoteWorkspaceSyncStatusByTargetId: {}
}

vi.mock('../../store', () => {
  const state = (): Record<string, unknown> => ({
    ...storeState,
    settings: null,
    runtimeEnvironments: [],
    runtimeStatusByEnvironmentId: new Map(),
    setRuntimeEnvironmentStatus: vi.fn(),
    hydrateRuntimeEnvironmentStatuses: vi.fn(),
    setActiveView: vi.fn(),
    openSettingsTarget: vi.fn(),
    recordFeatureInteraction: vi.fn(),
    fetchRuntimeEnvironmentRepos: vi.fn(),
    fetchWorktrees: vi.fn(),
    fetchWorktreeLineage: vi.fn()
  })
  const useAppStore = (selector: (value: Record<string, unknown>) => unknown): unknown =>
    selector(state())
  useAppStore.getState = state
  return { useAppStore }
})

function setSshTargets(
  entries: { id: string; label: string; status: SshConnectionStatus; syncPhase?: string }[]
): void {
  storeState = {
    sshConnectionStates: new Map(entries.map((entry) => [entry.id, { status: entry.status }])),
    sshTargetLabels: new Map(entries.map((entry) => [entry.id, entry.label])),
    remoteWorkspaceSyncStatusByTargetId: Object.fromEntries(
      entries.flatMap((entry) => (entry.syncPhase ? [[entry.id, { phase: entry.syncPhase }]] : []))
    )
  }
}

function triggerText(): string {
  return screen.getByRole('button').textContent ?? ''
}

describe('status-bar copy under a non-English UI language', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('es')
  })

  afterEach(() => {
    cleanup()
  })

  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('translates both plural forms of the terminal session count', () => {
    expect(formatTerminalSessionCount(1)).toBe('1 sesión de terminal')
    expect(formatTerminalSessionCount(5)).toBe('5 sesiones de terminal')
  })

  it('translates every Resource Manager tooltip line', () => {
    expect(
      getResourceManagerTooltipLines({
        memoryLabel: '512 MB',
        sessionCount: 2,
        spaceScanReady: true
      })
    ).toEqual([
      {
        id: 'summary',
        text: 'Administrador de recursos - 512 MB - 2 sesiones de terminal',
        emphasized: false
      },
      { id: 'space-scan', text: 'Escaneo de espacio listo', emphasized: true },
      {
        id: 'sessions-hint',
        text: 'Las sesiones de terminal se agrupan por espacio de trabajo.',
        emphasized: false
      }
    ])
  })

  // Why: the tint used to be selected by `line === 'Space scan ready'`, so it
  // silently vanished for every non-English locale once the copy translated.
  it('keeps the space-scan row flagged when its copy is no longer English', () => {
    const lines = getResourceManagerTooltipLines({
      memoryLabel: '512 MB',
      sessionCount: 2,
      spaceScanReady: true
    })

    const emphasized = lines.filter((line) => line.emphasized)
    expect(emphasized).toHaveLength(1)
    expect(emphasized[0]?.text).toBe('Escaneo de espacio listo')
    expect(emphasized[0]?.text).not.toBe('Space scan ready')
  })

  it('translates the memory-unavailable and empty-session tooltip lines', () => {
    expect(
      getResourceManagerTooltipLines({ memoryLabel: '—', sessionCount: 0, spaceScanReady: false })
    ).toEqual([
      {
        id: 'summary',
        text: 'Administrador de recursos - memoria no disponible - 0 sesiones de terminal',
        emphasized: false
      },
      { id: 'sessions-hint', text: 'Aún no hay sesiones de terminal.', emphasized: false }
    ])
  })

  it('translates the Resource Manager trigger label read by screen readers', () => {
    expect(getResourceManagerAriaLabel({ sessionCount: 1, spaceScanReady: true })).toBe(
      'Administrador de recursos, 1 sesión de terminal, Escaneo de espacio listo'
    )
    expect(getResourceManagerAriaLabel({ sessionCount: 3, spaceScanReady: false })).toBe(
      'Administrador de recursos, 3 sesiones de terminal'
    )
  })

  it('translates the connected host count next to the translated aria label', () => {
    setSshTargets([
      { id: 'ssh-1', label: 'builder', status: 'connected' },
      { id: 'ssh-2', label: 'openclaw', status: 'connected' }
    ])
    render(<SshStatusSegment compact={false} iconOnly={false} />)

    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(
      'Estado de conexión del host remoto'
    )
    expect(triggerText()).toContain('2 hosts')
  })

  it('translates the singular host count', () => {
    setSshTargets([{ id: 'ssh-1', label: 'builder', status: 'connected' }])
    render(<SshStatusSegment compact={false} iconOnly={false} />)

    expect(triggerText()).toContain('1 host')
  })

  it('translates the connecting and workspace-sync states', () => {
    setSshTargets([{ id: 'ssh-1', label: 'builder', status: 'connecting' }])
    render(<SshStatusSegment compact={false} iconOnly={false} />)
    expect(triggerText()).toContain('Conectando…')
    cleanup()

    setSshTargets([
      { id: 'ssh-1', label: 'builder', status: 'connected', syncPhase: 'conflict' },
      { id: 'ssh-2', label: 'openclaw', status: 'connected', syncPhase: 'error' }
    ])
    render(<SshStatusSegment compact={false} iconOnly={false} />)
    expect(triggerText()).toContain('Conflicto del espacio de trabajo')
    cleanup()

    setSshTargets([{ id: 'ssh-1', label: 'builder', status: 'connected', syncPhase: 'error' }])
    render(<SshStatusSegment compact={false} iconOnly={false} />)
    expect(triggerText()).toContain('Error de sincronización del espacio de trabajo')
  })
})
