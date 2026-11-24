import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Repo } from '../../shared/repo-types'
import { attributeCodexUsageEvent } from '../codex-usage/codex-usage-event-attribution'
import {
  attributeOpenCodeUsageEvent,
  buildWorktreesWithCanonicalPaths
} from '../opencode-usage/opencode-usage-worktree-attribution'
import {
  getPreviouslyAttributedWorktreeRefs,
  getRepoWorkspaceRootRefs
} from './usage-retired-worktree-refs'

const repos = [
  { id: 'repo-1', path: '/src/orca-oss', displayName: 'orca-oss' },
  { id: 'remote', path: '/srv/orca', displayName: 'orca (m1)', connectionId: 'ssh-1' }
] as Repo[]
const settings = { workspaceDir: '/ws', nestWorkspaces: true } as GlobalSettings

const event = {
  sessionId: 's',
  timestamp: '2026-04-09T10:00:00.000Z',
  eventKey: 'k',
  model: 'gpt-5',
  hasInferredPricing: false,
  estimatedCostUsd: null,
  inputTokens: 1,
  cachedInputTokens: 0,
  outputTokens: 1,
  reasoningOutputTokens: 0,
  totalTokens: 2
}

describe('refs that keep deleted worktrees in their repo', () => {
  it('maps the repo workspace folder for local repos only', async () => {
    const refs = await getRepoWorkspaceRootRefs(repos, settings)
    expect(refs).toEqual([
      {
        repoId: 'repo-1',
        worktreeId: 'repo-1::/ws/orca-oss',
        path: '/ws/orca-oss',
        displayName: 'orca-oss'
      }
    ])
  })

  it('carries a worktree the last scan attributed when it is no longer known', () => {
    const refs = getPreviouslyAttributedWorktreeRefs(
      [
        { repoId: 'repo-1', worktreeId: 'repo-1::/old/orca-1301', projectLabel: 'orca-1301' },
        { repoId: 'repo-1', worktreeId: 'repo-1::/old/orca-1301', projectLabel: 'orca-1301' },
        { repoId: 'removed', worktreeId: 'removed::/old/x', projectLabel: 'x' },
        { repoId: null, worktreeId: null, projectLabel: 'elsewhere' }
      ],
      repos,
      []
    )
    expect(refs).toEqual([
      {
        repoId: 'repo-1',
        worktreeId: 'repo-1::/old/orca-1301',
        path: '/old/orca-1301',
        displayName: 'orca-1301'
      }
    ])
  })

  it.each([
    ['Codex', attributeCodexUsageEvent],
    ['OpenCode', attributeOpenCodeUsageEvent]
  ])('%s attributes a deleted worktree cwd to its repo', async (_name, attribute) => {
    const worktrees = await buildWorktreesWithCanonicalPaths([
      {
        repoId: 'repo-1',
        worktreeId: 'repo-1::/src/orca-oss',
        path: '/src/orca-oss',
        displayName: 'orca-oss'
      },
      ...(await getRepoWorkspaceRootRefs(repos, settings)),
      ...getPreviouslyAttributedWorktreeRefs(
        [{ repoId: 'repo-1', worktreeId: 'repo-1::/old/orca-1290', projectLabel: 'orca-1290' }],
        repos,
        []
      )
    ])

    const underRoot = await attribute({ ...event, cwd: '/ws/orca-oss/orca-1301/src' }, worktrees)
    const carried = await attribute({ ...event, cwd: '/old/orca-1290' }, worktrees)
    const outside = await attribute({ ...event, cwd: '/tmp/tool' }, worktrees)

    expect(underRoot?.repoId).toBe('repo-1')
    expect(carried?.repoId).toBe('repo-1')
    expect(outside?.repoId).toBeNull()
  })
})
