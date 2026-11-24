import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Os from 'node:os'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeMeta } from '../../shared/types'

let root = ''

vi.mock('electron', () => ({ app: { getPath: () => join(root, 'userData') } }))

type BackingStore = {
  getRepos: () => Repo[]
  getAllWorktreeMeta: () => Record<string, WorktreeMeta>
  getSettings?: () => GlobalSettings
}

function turn(sessionId: string, cwd: string, index: number): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId,
    cwd,
    timestamp: new Date(Date.now() - 3_600_000 + index * 60_000).toISOString(),
    requestId: `${sessionId}-${index}`,
    message: {
      id: `${sessionId}-m${index}`,
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }
    }
  })
}

function writeTranscript(sessionId: string, cwd: string, index: number): void {
  const dir = join(root, 'home', '.claude', 'projects', 'p')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${turn(sessionId, cwd, index)}\n`)
}

async function createStore(backing: BackingStore) {
  vi.resetModules()
  vi.doMock('node:os', async (importOriginal) => ({
    ...(await importOriginal<typeof Os>()),
    homedir: () => join(root, 'home')
  }))
  const { ClaudeUsageStore } = await import('./store')
  const store = new ClaudeUsageStore(backing as never)
  await store.setEnabled(true)
  return store
}

function repo(id: string, path: string, displayName: string): Repo {
  return { id, path, displayName, badgeColor: '#000', addedAt: 0 } as Repo
}

describe('ClaudeUsageStore usage from a deleted worktree', () => {
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-claude-deleted-wt-')))
    mkdirSync(join(root, 'userData'), { recursive: true })
  })

  afterEach(() => {
    vi.doUnmock('node:os')
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps a worktree seen in an earlier scan in its repo row after the worktree is removed', async () => {
    const repoPath = join(root, 'src', 'orca')
    const oldWorktree = join(root, 'elsewhere', 'orca-1301')
    mkdirSync(repoPath, { recursive: true })
    mkdirSync(oldWorktree, { recursive: true })
    writeTranscript('s-root', repoPath, 0)
    writeTranscript('s-old', oldWorktree, 1)
    let meta: Record<string, WorktreeMeta> = {
      [`repo-1::${oldWorktree}`]: { displayName: 'orca-1301' } as WorktreeMeta
    }
    const store = await createStore({
      getRepos: () => [repo('repo-1', repoPath, 'orca-oss')],
      getAllWorktreeMeta: () => meta
    })
    await store.refresh(true)
    expect(store.getSnapshot('all', 'all').projectBreakdown.map((row) => row.label)).toEqual([
      'orca-oss'
    ])

    meta = {}
    rmSync(oldWorktree, { recursive: true, force: true })
    await store.refresh(true)

    const { projectBreakdown } = store.getSnapshot('all', 'all')
    expect(projectBreakdown.map((row) => [row.label, row.turns, row.sessions])).toEqual([
      ['orca-oss', 2, 2]
    ])
  })

  it("maps a cwd under the repo's own workspace folder to the repo with no earlier scan", async () => {
    const repoPath = join(root, 'src', 'orca-oss')
    const workspaceDir = join(root, 'ws')
    mkdirSync(repoPath, { recursive: true })
    mkdirSync(join(workspaceDir, 'orca-oss'), { recursive: true })
    writeTranscript('s-gone', join(workspaceDir, 'orca-oss', 'orca-1301'), 0)
    writeTranscript('s-gone-sub', join(workspaceDir, 'orca-oss', 'orca-1290', 'src'), 1)
    const store = await createStore({
      getRepos: () => [repo('repo-1', repoPath, 'orca-oss')],
      getAllWorktreeMeta: () => ({}),
      getSettings: () => ({ workspaceDir, nestWorkspaces: true }) as GlobalSettings
    })
    await store.refresh(true)

    const { projectBreakdown, summary } = store.getSnapshot('orca', 'all')
    expect(projectBreakdown.map((row) => [row.label, row.turns, row.sessions])).toEqual([
      ['orca-oss', 2, 2]
    ])
    expect(summary.sessions).toBe(2)
  })

  it('leaves a workspace folder shared by two repos unmapped', async () => {
    const workspaceDir = join(root, 'ws')
    const firstRepo = join(root, 'a', 'orca')
    const secondRepo = join(root, 'b', 'orca')
    mkdirSync(firstRepo, { recursive: true })
    mkdirSync(secondRepo, { recursive: true })
    writeTranscript('s-gone', join(workspaceDir, 'orca', 'orca-1301'), 0)
    const store = await createStore({
      getRepos: () => [repo('repo-1', firstRepo, 'orca A'), repo('repo-2', secondRepo, 'orca B')],
      getAllWorktreeMeta: () => ({}),
      getSettings: () => ({ workspaceDir, nestWorkspaces: true }) as GlobalSettings
    })
    await store.refresh(true)

    expect(store.getSnapshot('all', 'all').projectBreakdown.map((row) => row.label)).toEqual([
      'orca/orca-1301'
    ])
  })
})
