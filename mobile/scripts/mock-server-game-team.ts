import { getRepoIdFromWorktreeId } from '../../src/shared/worktree/id'
import type {
  GameOwnerQuestion,
  GameOwnerQuestionProject
} from '../../src/shared/orchestrator-game-owner-questions'
import type { RpcRequest, RpcRespond, RpcResponse } from './mock-server-rpc-handlers'
import {
  createShowcaseQuestionProjects,
  isShowcaseScenario,
  LEAD_WORKTREE_ID,
  SHOWCASE_MEMBERS,
  SHOWCASE_METRICS_MERGED,
  showcaseIncomingQuestion
} from './mock-server-showcase-scenario'
import { createShowcaseInboxThreads } from './mock-server-showcase-inbox'
import { showcaseAnswerChunks } from './mock-server-showcase-terminal'
import { queueTerminalOutput } from './mock-server-terminal-stream'

// Every terminal is the lead of a project with five members, so the Team drawer (ORCA-952) has data.
const member = (paneKey: string, name: string, state: string, extra: Record<string, unknown>) => ({
  paneKey,
  displayName: name,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true,
  launch: { model: 'opus', effort: null },
  ...extra
})

const workItem = (id: string, title: string, status: string) => ({
  provider: 'plane',
  identifier: id,
  title,
  url: `https://plane.example/${id}`,
  status,
  statusGroup: 'started'
})

const review = (number: number, ci: string, state = 'open') => ({
  provider: 'github',
  number,
  title: `PR ${number}`,
  url: `https://github.com/ab2webco/orca-oss/pull/${number}`,
  state,
  ci
})

const DEFAULT_MEMBERS = [
  member('tab-9:a', 'Cipher Wren', 'idle', {
    workItem: workItem('ORCA-950', 'Metrics undercount merged per day', 'In Review'),
    review: review(845, 'success', 'merged')
  }),
  member('tab-9:b', 'Alex', 'working', {
    workItem: workItem('ORCA-949', 'Panel visual redesign for the Fleet pane', 'In Progress'),
    review: review(844, 'pending'),
    remote: { host: 'iMac', stateKnown: true },
    account: { email: 'lab-account-b' }
  }),
  member('tab-9:c', 'Nova', 'waiting', {
    workItem: workItem('ORCA-948', "Fleet lists other projects' found agents", 'In Progress')
  }),
  member('tab-1:d', 'Juno', 'working', {
    workItem: workItem('ORCA-946', 'Paired-remote pane stays recovering on restart', 'In Progress'),
    review: review(843, 'failure'),
    toolName: 'Edit',
    toolInput: 'remote-restart.spec.ts'
  }),
  member('tab-9:f', 'Kiro', 'idle', {
    workItem: workItem('ORCA-947', 'Release notes for lab.116', 'In Progress'),
    account: { email: 'lab-account-a' },
    limit: { resetsAt: Date.now() + 2 * 3_600_000 }
  }),
  member('tab-9:e', 'Rho', 'done', {
    workItem: workItem('ORCA-943', 'Every agent talks both ways with the lead', 'Done'),
    review: review(840, 'success', 'merged')
  })
]

const DEFAULT_QUESTIONS: GameOwnerQuestion[] = [
  {
    id: 'q1',
    ticket: 'ORCA-946',
    question: 'The restart spec needs a longer host relaunch budget on Linux CI. Raise it to 90 s?',
    options: ['Raise to 90 s', 'Keep 60 s'],
    context: 'https://github.com/ab2webco/orca-oss/pull/843',
    askedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    answer: null
  },
  {
    id: 'q2',
    ticket: null,
    question: 'Release lab.113 tonight or wait for ORCA-949?',
    options: ['Tonight', 'Wait'],
    context: null,
    askedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    answer: null
  }
]

// Showcase projects are fixed; the default one follows whichever worktree is active.
let showcaseProjects = isShowcaseScenario ? createShowcaseQuestionProjects() : []
let defaultQuestions = DEFAULT_QUESTIONS

function questionProjects(activeWorktreeId: string): GameOwnerQuestionProject[] {
  if (isShowcaseScenario) {
    return showcaseProjects.filter((project) => project.questions.length > 0)
  }
  const repoId = getRepoIdFromWorktreeId(activeWorktreeId)
  return defaultQuestions.length
    ? [{ repoId, repoName: 'orca-oss', worktreeId: activeWorktreeId, questions: defaultQuestions }]
    : []
}

function openQuestionCount(): number {
  return isShowcaseScenario
    ? (showcaseProjects.find((one) => one.worktreeId === LEAD_WORKTREE_ID)?.questions.length ?? 0)
    : defaultQuestions.length
}

function leadState(worktreeId: unknown): unknown {
  if (isShowcaseScenario && worktreeId !== LEAD_WORKTREE_ID) {
    // A root pane with no lead config: the phone shows no Team button over it.
    return { role: 'lead', agents: [] }
  }
  return {
    role: 'lead',
    lead: { autostart: false, cap: 5, agent: 'claude', label: 'Lead' },
    agents: isShowcaseScenario ? SHOWCASE_MEMBERS : DEFAULT_MEMBERS,
    worktree: { id: worktreeId },
    // Why: MOCK_GAME_LOCALE=es checks the cards follow the host's language.
    locale: process.env.MOCK_GAME_LOCALE,
    inboxes: [
      {
        key: 'ORCA-949',
        unread: 0,
        last: { at: '', from: 'ORCA-949', subject: 'Fleet pane redesign pushed, CI running' },
        waiting: []
      }
    ],
    openOwnerQuestions: openQuestionCount(),
    metrics: {
      claudeAccounts: [
        { email: 'lab-account-a', sessionPercent: 100, weeklyPercent: 71 },
        { email: 'lab-account-b', sessionPercent: 42, weeklyPercent: 18 }
      ],
      computedAt: new Date().toISOString(),
      timezone: 'America/Bogota',
      mergedPerDay: isShowcaseScenario
        ? SHOWCASE_METRICS_MERGED
        : [
            { day: '2026-10-30', merged: 5 },
            { day: '2026-10-31', merged: 7 },
            { day: '2026-11-01', merged: 3 },
            { day: '2026-11-02', merged: 4 }
          ],
      leadTime: isShowcaseScenario
        ? { medianMs: 3.2 * 3_600_000, measured: 29 }
        : { medianMs: 5.5 * 3_600_000, measured: 19 }
    }
  }
}

function answerShowcaseQuestion(id: string, params: Record<string, unknown>): void {
  for (const project of showcaseProjects) {
    const found = project.questions.find((one) => one.id === id)
    if (!found) {
      continue
    }
    // The option is 1-based, as the host's owner board reads it.
    const answer =
      typeof params.option === 'number'
        ? found.options[params.option - 1]
        : String(params.text ?? '')
    if (project.worktreeId === LEAD_WORKTREE_ID && answer) {
      // Why by ticket: the lead relays the answer to whoever owns it, not a fixed member.
      const owner = SHOWCASE_MEMBERS.find((one) => one.workItem.identifier === found.ticket)
      queueTerminalOutput(
        'term-lead',
        showcaseAnswerChunks(found.ticket, answer, owner?.displayName ?? null)
      )
    }
  }
  showcaseProjects = showcaseProjects.map((project) => ({
    ...project,
    questions: project.questions.filter((one) => one.id !== id)
  }))
}

/** Adds a fresh question to the showcase lead's project; null outside the showcase. */
export function addShowcaseOwnerQuestion(): {
  question: GameOwnerQuestion
  worktreeId: string
  repoName: string
} | null {
  const project = showcaseProjects.find((one) => one.worktreeId === LEAD_WORKTREE_ID)
  if (!isShowcaseScenario || !project) {
    return null
  }
  const question = showcaseIncomingQuestion()
  project.questions = [question, ...project.questions]
  return { question, worktreeId: LEAD_WORKTREE_ID, repoName: project.repoName }
}

export function handleMockGameTeamRequest(
  request: RpcRequest,
  respond: RpcRespond,
  success: (id: string, result: unknown) => RpcResponse,
  activeWorktreeId: () => string | undefined
): boolean {
  if (request.method === 'game.state') {
    respond(success(request.id, leadState(request.params?.worktreeId)))
    return true
  }
  if (request.method === 'game.inboxThreads') {
    const empty = { threads: [], waiting: [], answered: [] }
    respond(success(request.id, isShowcaseScenario ? createShowcaseInboxThreads() : empty))
    return true
  }
  if (request.method === 'game.ownerQuestionsAll') {
    respond(success(request.id, { projects: questionProjects(activeWorktreeId() ?? 'mock') }))
    return true
  }
  if (request.method === 'game.ownerAnswer') {
    const id = request.params?.id
    if (isShowcaseScenario) {
      answerShowcaseQuestion(String(id), request.params ?? {})
    } else {
      defaultQuestions = defaultQuestions.filter((one) => one.id !== id)
    }
    respond(success(request.id, { answered: true }))
    return true
  }
  return false
}
