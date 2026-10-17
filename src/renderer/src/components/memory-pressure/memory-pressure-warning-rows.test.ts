import { describe, expect, it } from 'vitest'
import type { MemoryPressurePane } from '../../../../shared/memory-pressure-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import {
  buildMemoryPressureRows,
  countRemoteTerminals,
  type MemoryPressureRowContext
} from './memory-pressure-warning-rows'

const GIB = 1024 ** 3

function pane(overrides: Partial<MemoryPressurePane>): MemoryPressurePane {
  return {
    sessionId: 'pty-1',
    ptyId: 'pty-1',
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

function tab(
  overrides: Partial<TerminalTab> & Pick<TerminalTab, 'id' | 'worktreeId'>
): TerminalTab {
  return {
    ptyId: null,
    title: 'zsh',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  }
}

function context(overrides: Partial<MemoryPressureRowContext> = {}): MemoryPressureRowContext {
  return {
    tabsByWorktree: {
      'repo-a::/w/feat': [
        tab({ id: 'tab-1', worktreeId: 'repo-a::/w/feat', defaultTitle: 'Terminal 1' }),
        tab({ id: 'tab-2', worktreeId: 'repo-a::/w/feat', title: 'claude', customTitle: 'Lead' }),
        tab({ id: 'tab-3', worktreeId: 'repo-a::/w/feat', title: 'codex', customTitle: 'Reviewer' })
      ],
      'ssh-repo::/srv/app': [
        tab({ id: 'tab-9', worktreeId: 'ssh-repo::/srv/app', title: 'ssh' }),
        tab({ id: 'tab-10', worktreeId: 'ssh-repo::/srv/app', title: 'ssh 2' })
      ]
    },
    ptyIdsByTabId: { 'tab-1': ['pty-1'], 'tab-2': ['pty-2'], 'tab-9': ['pty-9'] },
    terminalLayoutsByTabId: {
      'tab-3': {
        root: null,
        activeLeafId: null,
        expandedLeafId: null,
        ptyIdsByLeafId: { 'leaf-3': 'pty-3' }
      }
    },
    deferredSshSessionIdsByTabId: { 'tab-10': 'pty-10' },
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
      ptyId: 'pty-1',
      tabId: 'tab-1',
      paneKey: null,
      title: 'zsh',
      agentType: null,
      project: 'cineco / feat',
      memory: GIB,
      idleMs: null
    })
  })

  // Why: restored background tabs stay out of ptyIdsByTabId until their pane mounts, which is
  // where days-old agent sessions live; only the layout wake hint binds them.
  it('binds a restored background session through its layout wake hint', () => {
    const [row] = buildMemoryPressureRows(
      [pane({ sessionId: 'sess-3', ptyId: 'pty-3' })],
      context(),
      0
    )

    expect(row).toMatchObject({ ptyId: 'pty-3', tabId: 'tab-3', title: 'Reviewer' })
  })

  it('binds through the live PTY id, not the registry session id', () => {
    const [row] = buildMemoryPressureRows(
      [pane({ sessionId: 'sess-2', ptyId: 'pty-2', lastOutputAt: 4_000 })],
      context(),
      10_000
    )

    expect(row).toMatchObject({ tabId: 'tab-2', title: 'Lead', agentType: 'claude', idleMs: 6_000 })
  })

  it('keeps a session with no tab in this window, untitled and unopenable', () => {
    const [row] = buildMemoryPressureRows(
      [
        pane({
          sessionId: 'x',
          ptyId: 'pty-x',
          worktreeId: null,
          repoName: 'Other',
          worktreeName: 'Other'
        })
      ],
      context(),
      0
    )

    expect(row).toMatchObject({ tabId: null, title: null, project: 'Other' })
  })
})

describe('countRemoteTerminals', () => {
  it('counts bound terminal tabs in SSH-backed repos, deferred reattaches included', () => {
    expect(countRemoteTerminals(context())).toBe(2)
    expect(
      countRemoteTerminals(context({ ptyIdsByTabId: {}, deferredSshSessionIdsByTabId: {} }))
    ).toBe(0)
  })
})
