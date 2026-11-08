import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type {
  TeamActivityRow,
  TeamLeadCard,
  TeamPanelGameModel,
  TeamPanelSoloModel
} from '../../../../shared/team-panel-model-types'

const openTeamSession = vi.hoisted(() => vi.fn())
vi.mock('./team-session-open', () => ({ openTeamSession }))
const sends = vi.hoisted(() => ({ ask: vi.fn(), message: vi.fn() }))
vi.mock('../native-chat/native-chat-runtime-send', () => ({
  sendNativeChatAskAnswer: sends.ask,
  sendNativeChatMessage: sends.message
}))
vi.mock('@/lib/agent-paste-draft', () => ({ getSettingsForAgentTabRuntimeOwner: () => null }))
let appState: Record<string, unknown> = {}
vi.mock('@/store', () => ({ useAppStore: { getState: () => appState } }))

const {
  answerTeamInboxAgent,
  isOneTapQuestion,
  openTeamInboxAgent,
  teamInboxAgentQuestionsOf,
  teamLeadQuestionOf
} = await import('./team-panel-inbox-agents')

const { toRemoteRuntimePtyId } = await import('@/runtime/runtime-terminal-stream')

const LEAF = '11111111-1111-4111-8111-111111111111'
const ASK = JSON.stringify({
  questions: [
    {
      question: 'Merge #923 now?',
      multiSelect: false,
      options: [{ label: 'Now' }, { label: 'Wait' }]
    }
  ]
})
const asking = (paneKey: string, over: Partial<AgentStatusEntry> = {}): AgentStatusEntry => ({
  state: 'waiting',
  prompt: 'Run home',
  updatedAt: 1,
  stateStartedAt: 1,
  agentType: 'claude',
  paneKey,
  stateHistory: [],
  toolName: 'AskUserQuestion',
  interactivePrompt: ASK,
  ...over
})
const noTabs = { tabsByWorktree: {}, ptyIdsByTabId: {}, terminalLayoutsByTabId: {} }
const lead = (over: Partial<TeamLeadCard> = {}): TeamLeadCard =>
  ({
    paneKey: 'tab-lead:leaf-lead',
    terminalHandle: 'term_lead',
    worktreeId: 'wt-lead',
    host: { kind: 'local' },
    name: 'Run home',
    ...over
  }) as TeamLeadCard
const team = (card: TeamLeadCard): TeamPanelGameModel =>
  ({
    kind: 'team',
    projectName: 'orca-oss',
    lead: card,
    members: []
  }) as unknown as TeamPanelGameModel

function row(over: Partial<TeamActivityRow>): TeamActivityRow {
  return {
    paneKey: 'tab-1:leaf-1',
    terminalHandle: null,
    worktreeId: 'wt-1',
    host: { kind: 'local' },
    name: 'main',
    agentType: 'claude',
    status: 'working',
    condition: 'working',
    since: null,
    liveAction: null,
    model: null,
    account: null,
    repoName: 'orca-oss',
    worktreeName: 'main',
    isPrimary: true,
    prompt: null,
    ticket: null,
    pr: null,
    lastMessage: null,
    cacheExpiresAt: null,
    ports: [],
    note: null,
    subagentCount: 0,
    recentSteps: [],
    advisor: null,
    inTeam: false,
    ...over
  }
}

const solo = (rows: TeamActivityRow[]): TeamPanelSoloModel => ({
  kind: 'solo',
  selectedPaneKey: null,
  rows,
  inbox: { kind: 'loading' },
  prs: null,
  queue: null,
  machines: null
})

beforeEach(() => {
  openTeamSession.mockReset()
  sends.ask.mockReset()
  sends.message.mockReset()
  appState = {}
})

describe('No-team Inbox from agent status', () => {
  it('lists each agent that asks the user, from any project or host', () => {
    const asking = row({
      paneKey: 'tab-2:leaf-1',
      worktreeId: 'wt-2',
      host: { kind: 'remote', name: 'imac', environmentId: 'env-1', reachable: true },
      repoName: 'cineco',
      worktreeName: 'cin-1145',
      status: 'attention',
      condition: 'waiting',
      liveAction: { kind: 'question', text: 'Apply it now?', options: ['Yes', 'No'] }
    })
    const working = row({ liveAction: { kind: 'tool', tool: 'Bash', detail: 'ls' } })

    expect(
      teamInboxAgentQuestionsOf(solo([working, asking]), { ...noTabs, agentStatusByPaneKey: {} })
    ).toEqual([
      {
        paneKey: 'tab-2:leaf-1',
        terminalHandle: null,
        worktreeId: 'wt-2',
        host: { kind: 'remote', name: 'imac', environmentId: 'env-1', reachable: true },
        repoName: 'cineco',
        worktreeName: 'cin-1145',
        text: 'Apply it now?',
        options: ['Yes', 'No']
      }
    ])
  })

  // Why one path: a row and its question must open the same pane on every kind of host.
  it('opens a question the way its Activity row opens', () => {
    const question = {
      paneKey: 'tab-2:leaf-1',
      terminalHandle: 'term-2',
      worktreeId: 'wt-2',
      host: { kind: 'local' } as const,
      repoName: 'cineco',
      worktreeName: 'cin-1145',
      text: 'Apply it now?',
      options: ['Yes', 'No']
    }

    openTeamInboxAgent(question)

    expect(openTeamSession).toHaveBeenCalledWith(question, 'cin-1145')
  })

  // Why (ORCA-1129 D4): a lead's question showed in another project's no-team Inbox.
  it("leaves a team's lead and members to that team's own Inbox", () => {
    const question = { kind: 'question' as const, text: 'Merge #923 now?', options: ['Now'] }
    const rows = [
      row({ paneKey: 'tab-lead:leaf-1', inTeam: true, liveAction: question }),
      row({ paneKey: 'tab-solo:leaf-1', liveAction: question })
    ]

    const shown = teamInboxAgentQuestionsOf(solo(rows), { ...noTabs, agentStatusByPaneKey: {} })

    expect(shown.map((one) => one.paneKey)).toEqual(['tab-solo:leaf-1'])
  })
})

describe("The lead's own question in its team Inbox (ORCA-1129 D4)", () => {
  it("reads the lead's AskUserQuestion from agent status, which game.state never carries", () => {
    const state = {
      ...noTabs,
      agentStatusByPaneKey: { 'tab-lead:leaf-lead': asking('tab-lead:leaf-lead') }
    }

    expect(teamInboxAgentQuestionsOf(team(lead()), state)).toEqual([
      {
        paneKey: 'tab-lead:leaf-lead',
        terminalHandle: 'term_lead',
        worktreeId: 'wt-lead',
        host: { kind: 'local' },
        repoName: 'orca-oss',
        worktreeName: 'Run home',
        asker: 'Run home',
        text: 'Merge #923 now?',
        options: ['Now', 'Wait']
      }
    ])
  })

  it('shows nothing while the lead works', () => {
    const state = {
      ...noTabs,
      agentStatusByPaneKey: {
        'tab-lead:leaf-lead': asking('tab-lead:leaf-lead', {
          state: 'working',
          toolName: 'Bash',
          interactivePrompt: undefined
        })
      }
    }

    expect(teamLeadQuestionOf(team(lead()), state)).toBeNull()
  })

  it("finds a paired host's lead under the tab this window mirrors it in", () => {
    const remoteLead = lead({
      host: { kind: 'remote', name: 'mini', environmentId: 'env-1', reachable: true }
    })
    const state = {
      tabsByWorktree: { 'wt-mirror': [{ id: 'tab-mirror' }] },
      ptyIdsByTabId: {},
      terminalLayoutsByTabId: {
        'tab-mirror': { ptyIdsByLeafId: { [LEAF]: toRemoteRuntimePtyId('term_lead', 'env-1') } }
      },
      agentStatusByPaneKey: { [`tab-mirror:${LEAF}`]: asking(`tab-mirror:${LEAF}`) }
    } as never

    expect(teamLeadQuestionOf(team(remoteLead), state)?.paneKey).toBe(`tab-mirror:${LEAF}`)
  })
})

// Why (ORCA-1141 N1): the card said "Answer in Inbox" while For you listed only the lead.
describe("A member's own question in its team Inbox", () => {
  const member = {
    paneKey: 'tab-m:leaf-m',
    terminalHandle: 'term_m',
    worktreeId: 'wt-m',
    host: { kind: 'local' },
    name: 'Peach'
  }
  const withMembers = (members: unknown[]): TeamPanelGameModel =>
    ({ ...team(lead()), members }) as unknown as TeamPanelGameModel

  it("lists a member's AskUserQuestion after the lead's, under the member's name", () => {
    const state = {
      ...noTabs,
      agentStatusByPaneKey: {
        'tab-lead:leaf-lead': asking('tab-lead:leaf-lead'),
        'tab-m:leaf-m': asking('tab-m:leaf-m')
      }
    }

    const shown = teamInboxAgentQuestionsOf(withMembers([member]), state)

    expect(shown.map((one) => [one.paneKey, one.worktreeName])).toEqual([
      ['tab-lead:leaf-lead', 'Run home'],
      ['tab-m:leaf-m', 'Peach']
    ])
    expect(shown[1]).toMatchObject({ terminalHandle: 'term_m', options: ['Now', 'Wait'] })
  })

  // Why (ORCA-1141): V28's Needs-you card names who asks by its ticket; one with none by its name.
  it('names each asker by its ticket, else its name', () => {
    const state = {
      ...noTabs,
      agentStatusByPaneKey: {
        'tab-m:leaf-m': asking('tab-m:leaf-m'),
        'tab-a:leaf-a': asking('tab-a:leaf-a')
      }
    }
    const ticketed = { ...member, ticket: { identifier: 'ORCA-12' } }
    const adopted = { ...member, paneKey: 'tab-a:leaf-a', name: 'main 2', ticket: null }

    const shown = teamInboxAgentQuestionsOf(withMembers([ticketed, adopted]), state)

    expect(shown.map((one) => one.asker)).toEqual(['ORCA-12', 'main 2'])
  })

  it("finds a paired host's member under the tab this window mirrors it in", () => {
    const remote = {
      ...member,
      host: { kind: 'remote', name: 'mini', environmentId: 'env-1', reachable: true }
    }
    const state = {
      tabsByWorktree: { 'wt-mirror': [{ id: 'tab-mirror' }] },
      ptyIdsByTabId: {},
      terminalLayoutsByTabId: {
        'tab-mirror': { ptyIdsByLeafId: { [LEAF]: toRemoteRuntimePtyId('term_m', 'env-1') } }
      },
      agentStatusByPaneKey: { [`tab-mirror:${LEAF}`]: asking(`tab-mirror:${LEAF}`) }
    } as never

    expect(teamInboxAgentQuestionsOf(withMembers([remote]), state)).toEqual([
      expect.objectContaining({ paneKey: `tab-mirror:${LEAF}`, worktreeName: 'Peach' })
    ])
  })
})

describe('Answering from the Inbox (ORCA-1129 D5)', () => {
  const question = {
    paneKey: `tab-1:${LEAF}`,
    terminalHandle: null,
    worktreeId: 'wt-1',
    host: { kind: 'local' as const },
    repoName: 'orca-oss',
    worktreeName: 'main',
    text: 'Merge #923 now?',
    options: ['Now', 'Wait']
  }
  const withPane = (entry: AgentStatusEntry | undefined, ptyId: string | null): void => {
    appState = {
      agentStatusByPaneKey: entry ? { [entry.paneKey]: entry } : {},
      terminalLayoutsByTabId: { 'tab-1': { ptyIdsByLeafId: ptyId ? { [LEAF]: ptyId } : {} } }
    }
  }

  it("types the option's number into Claude's selector, as the chat card does", () => {
    withPane(asking(`tab-1:${LEAF}`), 'pty-1')

    expect(answerTeamInboxAgent(question, 1)).toBe(true)
    expect(sends.ask).toHaveBeenCalledWith(null, 'pty-1', [{ raw: '2' }], expect.any(Function))
  })

  it('pastes the label for an agent whose prompt takes text', () => {
    withPane(asking(`tab-1:${LEAF}`, { agentType: 'gemini' }), 'pty-1')

    expect(answerTeamInboxAgent(question, 0)).toBe(true)
    expect(sends.message).toHaveBeenCalledWith(null, 'pty-1', 'Now')
  })

  it('sends nothing with no PTY in this window, or once another question replaced it', () => {
    withPane(asking(`tab-1:${LEAF}`), null)
    expect(answerTeamInboxAgent(question, 0)).toBe(false)

    withPane(asking(`tab-1:${LEAF}`), 'pty-1')
    expect(answerTeamInboxAgent({ ...question, text: 'An older question' }, 0)).toBe(false)
    expect(sends.ask).not.toHaveBeenCalled()
  })

  it('offers one-tap answers only for a single single-choice question', () => {
    withPane(asking(`tab-1:${LEAF}`), 'pty-1')
    expect(isOneTapQuestion(question)).toBe(true)

    const multi = JSON.stringify({
      questions: [{ question: 'Which?', multiSelect: true, options: [{ label: 'A' }] }]
    })
    withPane(asking(`tab-1:${LEAF}`, { interactivePrompt: multi }), 'pty-1')
    expect(isOneTapQuestion(question)).toBe(false)
  })
})
