import { describe, expect, it } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../shared/agent-session-resume'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { WorkspaceSessionState } from '../../shared/types'
import { OrcaRuntimeService } from './orca-runtime'

// ORCA-718: `orca terminal close` keeps the agent's resume record (ORCA-487), and terminal.list
// built a sleeping row from it, so a lead the user closed came back as a sleeping Lead tab.

const REPO_ID = 'repo-1'
const REPO_PATH = '/tmp/repo'
const WORKTREE_ID = `${REPO_ID}::${REPO_PATH}`
const REPO = {
  id: REPO_ID,
  path: REPO_PATH,
  displayName: 'repo',
  badgeColor: 'blue',
  addedAt: 1,
  kind: 'git'
} as const

function record(
  tabId: string,
  origin: NonNullable<SleepingAgentSessionRecord['origin']>
): SleepingAgentSessionRecord {
  return {
    paneKey: `${tabId}:11111111-1111-4111-8111-111111111111`,
    tabId,
    worktreeId: WORKTREE_ID,
    agent: 'claude',
    providerSession: { key: 'session_id', id: `${tabId}-session` },
    prompt: 'lead',
    state: 'working',
    capturedAt: 10,
    updatedAt: 20,
    terminalTitle: tabId,
    origin
  }
}

function openTab(id: string) {
  return {
    id,
    ptyId: null,
    worktreeId: WORKTREE_ID,
    title: id,
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function listedTabIds(session: WorkspaceSessionState): Promise<string[]> {
  const meta = { [WORKTREE_ID]: { hostId: 'local' } }
  const runtime = new OrcaRuntimeService({
    getRepos: () => [REPO],
    getRepo: (id: string) => (id === REPO_ID ? REPO : undefined),
    getAllWorktreeMeta: () => meta,
    getWorktreeMeta: (id: string) => meta[id as keyof typeof meta],
    getWorkspaceSession: () => session,
    setWorkspaceSession: () => {},
    flushOrThrow: () => {}
  } as never)
  return runtime
    .listTerminals(`id:${WORKTREE_ID}`)
    .then(({ terminals }) => terminals.map((terminal) => terminal.tabId).sort())
}

describe('terminal.list sleeping rows', () => {
  it('lists no sleeping row for a live or quit record whose tab was closed', async () => {
    const closedLive = record('closed-lead', 'live')
    const closedQuit = record('closed-quit', 'quit')
    const open = record('open-member', 'quit')
    const session: WorkspaceSessionState = {
      ...getDefaultWorkspaceSession(),
      tabsByWorktree: { [WORKTREE_ID]: [openTab('open-member')] } as never,
      sleepingAgentSessionsByPaneKey: {
        [closedLive.paneKey]: closedLive,
        [closedQuit.paneKey]: closedQuit,
        [open.paneKey]: open
      }
    }

    expect(await listedTabIds(session)).toEqual(['open-member'])
  })

  it('keeps listing a worktree-sleep record, whose wake opens a fresh tab', async () => {
    const slept = record('slept', 'worktree-sleep')
    const session: WorkspaceSessionState = {
      ...getDefaultWorkspaceSession(),
      sleepingAgentSessionsByPaneKey: { [slept.paneKey]: slept }
    }

    expect(await listedTabIds(session)).toEqual(['slept'])
  })
})
