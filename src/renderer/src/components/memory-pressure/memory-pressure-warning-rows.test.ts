import { describe, expect, it } from 'vitest'
import type { MemoryPressurePane } from '../../../../shared/memory-pressure-types'
import {
  buildMemoryPressureRows,
  countRemoteTerminals,
  type MemoryPressureRowContext
} from './memory-pressure-warning-rows'

const GIB = 1024 ** 3

function pane(overrides: Partial<MemoryPressurePane>): MemoryPressurePane {
  return {
    sessionId: 'pty-1',
    paneKey: null,
    worktreeId: 'repo-a::/w/feat',
    worktreeName: 'feat',
    repoName: 'cineco',
    memory: GIB,
    metric: 'phys-footprint',
    lastOutputAt: null,
    ...overrides
  }
}

function context(overrides: Partial<MemoryPressureRowContext> = {}): MemoryPressureRowContext {
  return {
    tabsByWorktree: {
      'repo-a::/w/feat': [
        { id: 'tab-1', title: 'zsh', defaultTitle: 'Terminal 1', customTitle: null },
        { id: 'tab-2', title: 'claude', customTitle: 'Lead' }
      ],
      'ssh-repo::/srv/app': [{ id: 'tab-9', title: 'ssh', customTitle: null }]
    },
    ptyIdsByTabId: { 'tab-1': ['pty-1'], 'tab-2': ['pty-2'], 'tab-9': ['pty-9'] },
    agentStatusByPaneKey: {
      'tab-2:leaf-2': { paneKey: 'tab-2:leaf-2', agentType: 'claude' }
    },
    repoConnectionIdById: new Map([
      ['repo-a', null],
      ['ssh-repo', 'conn-1']
    ]),
    ...overrides
  }
}

describe('buildMemoryPressureRows', () => {
  it('names a warm-reattached session through its tab when it has no pane key', () => {
    const [row] = buildMemoryPressureRows([pane({})], context(), 10_000)

    expect(row).toEqual({
      sessionId: 'pty-1',
      tabId: 'tab-1',
      paneKey: null,
      title: 'zsh',
      agentType: null,
      project: 'cineco / feat',
      memory: GIB,
      idleMs: null
    })
  })

  it('prefers a custom title, carries the agent and measures idle from the last output', () => {
    const [row] = buildMemoryPressureRows(
      [pane({ sessionId: 'pty-2', paneKey: 'tab-2:leaf-2', lastOutputAt: 4_000 })],
      context(),
      10_000
    )

    expect(row).toMatchObject({ tabId: 'tab-2', title: 'Lead', agentType: 'claude', idleMs: 6_000 })
  })

  it('finds the agent from any pane of the tab when the session has no pane key', () => {
    const [row] = buildMemoryPressureRows([pane({ sessionId: 'pty-2' })], context(), 0)

    expect(row.agentType).toBe('claude')
  })

  it('keeps a session with no tab in this window, untitled and unopenable', () => {
    const [row] = buildMemoryPressureRows(
      [pane({ sessionId: 'pty-x', worktreeId: null, repoName: 'Other', worktreeName: 'Other' })],
      context(),
      0
    )

    expect(row).toMatchObject({ tabId: null, title: null, project: 'Other' })
  })
})

describe('countRemoteTerminals', () => {
  it('counts live terminal tabs in SSH-backed repos, which the local sweep cannot measure', () => {
    expect(countRemoteTerminals(context())).toBe(1)
    expect(countRemoteTerminals(context({ ptyIdsByTabId: { 'tab-9': [] } }))).toBe(0)
  })
})
