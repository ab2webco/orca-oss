import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from './agent-status-types'
import { teamSoloModelOf, type TeamSoloSession } from './team-panel-activity-rows'

const BRIEF =
  '<pasted_content id="e1f9"> You are working inside Orca Lab, a multi-agent IDE. You are a dispatched worker. Your coordinator\'s terminal handle is: term_1 Your task ID is: task_9 === TASK === Answer the WAINBOX-121 inbox thread'

const rowOf = (over: Partial<AgentStatusEntry>) =>
  teamSoloModelOf({
    sessions: [
      {
        entry: {
          state: 'working',
          prompt: 'Fix the checks tooltip',
          updatedAt: 20,
          stateStartedAt: 10,
          paneKey: 'tab:leaf',
          stateHistory: [],
          ...over
        },
        repoName: 'orca-wa-inbox',
        worktreeName: 'wainbox-121',
        worktreeId: 'repo::/w/wainbox-121',
        isPrimary: false,
        inTeam: false,
        host: { kind: 'local' },
        ticket: null,
        pr: null,
        note: null,
        ports: [],
        account: null,
        cacheExpiresAt: null,
        advisor: null
      } satisfies TeamSoloSession
    ],
    selectedPaneKey: null,
    tabs: {
      inbox: { kind: 'loading' },
      prs: { kind: 'loading' },
      queue: null,
      machines: { kind: 'loading' }
    }
  }).rows[0]!

describe('the request a row shows', () => {
  // Why: 'Pedido' printed the raw brief, wrapper tag and boilerplate included.
  it('names a dispatched task by its title, never by its brief', () => {
    const row = rowOf({
      prompt: BRIEF,
      orchestration: { taskId: 'task_9', taskTitle: 'WAINBOX-121 Answer the inbox thread' }
    })
    expect(row.prompt).toBe('WAINBOX-121 Answer the inbox thread')
  })

  it('falls back to the task body when the dispatch has no title yet', () => {
    expect(rowOf({ prompt: BRIEF }).prompt).toBe('Answer the WAINBOX-121 inbox thread')
  })

  it('shows a person’s own prompt as written', () => {
    expect(rowOf({}).prompt).toBe('Fix the checks tooltip')
  })
})
