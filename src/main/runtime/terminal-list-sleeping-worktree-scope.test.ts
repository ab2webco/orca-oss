import { describe, expect, it } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../shared/agent-session-resume'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { WorkspaceSessionState } from '../../shared/types'
import { FOLDER_WORKSPACE_INSTANCE_SEPARATOR } from '../../shared/worktree/id'
import { OrcaRuntimeService } from './orca-runtime'

// Why: mobile mounts one WKWebView per listed terminal, so sleeping rows from other
// worktrees in a scoped list spawned dozens of WebViews per foreground (ORCA-811).

const REPO_ID = 'repo-1'
const FOLDER_PATH = '/tmp/folder-project'
const ROOT_ID = `${REPO_ID}::${FOLDER_PATH}`
const WORKSPACE_A = `${ROOT_ID}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
const WORKSPACE_B = `${ROOT_ID}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`

const REPO = {
  id: REPO_ID,
  path: FOLDER_PATH,
  displayName: 'folder-project',
  badgeColor: 'blue',
  addedAt: 1,
  kind: 'folder'
} as const

function sleepingRecord(
  worktreeId: string,
  tabId: string,
  leafId: string
): SleepingAgentSessionRecord {
  return {
    paneKey: `${tabId}:${leafId}`,
    tabId,
    worktreeId,
    agent: 'claude',
    providerSession: { key: 'session_id', id: `${tabId}-session` },
    prompt: 'work',
    state: 'working',
    capturedAt: 10,
    updatedAt: 20,
    terminalTitle: tabId,
    lastAssistantMessage: '',
    origin: 'worktree-sleep'
  }
}

const SLEEPING_IN_A = sleepingRecord(WORKSPACE_A, 'tab-a', '11111111-1111-4111-8111-111111111111')
const SLEEPING_IN_B = sleepingRecord(WORKSPACE_B, 'tab-b', '22222222-2222-4222-8222-222222222222')

function makeRuntime(): OrcaRuntimeService {
  const meta: Record<string, Record<string, unknown>> = {
    [WORKSPACE_A]: { hostId: 'local' },
    [WORKSPACE_B]: { hostId: 'local' }
  }
  const session: WorkspaceSessionState = {
    ...getDefaultWorkspaceSession(),
    sleepingAgentSessionsByPaneKey: {
      [SLEEPING_IN_A.paneKey]: SLEEPING_IN_A,
      [SLEEPING_IN_B.paneKey]: SLEEPING_IN_B
    }
  }
  return new OrcaRuntimeService({
    getRepos: () => [REPO],
    getRepo: (id: string) => (id === REPO_ID ? REPO : undefined),
    getAllWorktreeMeta: () => meta,
    getWorktreeMeta: (worktreeId: string) => meta[worktreeId],
    setWorktreeMeta: (worktreeId: string, patch: Record<string, unknown>) => {
      meta[worktreeId] = { ...meta[worktreeId], ...patch }
      return meta[worktreeId]
    },
    getWorkspaceSession: () => session,
    setWorkspaceSession: () => {},
    flushOrThrow: () => {}
  } as never)
}

describe('terminal.list scoped to a worktree', () => {
  it('lists no sleeping agents from other worktrees while the resolved-worktree cache is fresh', async () => {
    const runtime = makeRuntime()
    // Why: an unscoped list fills the resolved-worktree cache with every worktree.
    const unscoped = await runtime.listTerminals()
    expect(unscoped.terminals.map((terminal) => terminal.worktreeId).sort()).toEqual(
      [WORKSPACE_A, WORKSPACE_B].sort()
    )

    const scoped = await runtime.listTerminals(`id:${WORKSPACE_A}`)

    expect(scoped.terminals.map((terminal) => terminal.worktreeId)).toEqual([WORKSPACE_A])
  })

  it('lists no sleeping agents from other worktrees on a cold cache', async () => {
    const scoped = await makeRuntime().listTerminals(`id:${WORKSPACE_A}`)

    expect(scoped.terminals.map((terminal) => terminal.worktreeId)).toEqual([WORKSPACE_A])
  })
})
