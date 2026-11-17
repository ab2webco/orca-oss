// The showcase lead's members and questions as a take changes them (ORCA-1176): a question stops
// the member it names, and the owner's answer, relayed by the lead, starts it again.
import { gameMemberLaunchOf } from '../../src/shared/orchestrator-game-member-launch'
import type {
  GameOwnerQuestion,
  GameOwnerQuestionProject
} from '../../src/shared/orchestrator-game-owner-questions'
import {
  statusGroupOfName,
  type GameAgent,
  type GameReview
} from '../../src/shared/orchestrator-game-state'
import {
  createShowcaseQuestionProjects,
  GIT,
  isShowcaseScenario,
  LEAD_WORKTREE_ID,
  PLANE,
  showcaseIncomingQuestion
} from './mock-server-showcase-scenario'
import { showcaseAnswerChunks } from './mock-server-showcase-terminal'
import { queueTerminalOutput } from './mock-server-terminal-stream'

// Why the host's builder: it turns the CLI id into the label the cards show (Opus 5.5).
function launchOf(model: string, effort: string): NonNullable<GameAgent['launch']> {
  const launch = gameMemberLaunchOf({ model, effort, source: 'launch' })
  if (!launch) {
    throw new Error(`mock launch refused: ${model} ${effort}`)
  }
  return launch
}

const member = (
  paneKey: string,
  name: string,
  state: GameAgent['state'],
  ticket: [string, string, string],
  extra: Partial<GameAgent> = {}
): GameAgent => ({
  paneKey,
  displayName: name,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true,
  launch: launchOf('claude-opus-5-5', 'high'),
  workItem: {
    provider: 'plane',
    identifier: ticket[0],
    title: ticket[1],
    url: `${PLANE}/${ticket[0]}`,
    status: ticket[2],
    statusGroup: statusGroupOfName(ticket[2])
  },
  ...extra
})

const review = (
  number: number,
  ci: GameReview['ci'],
  state: GameReview['state'] = 'open'
): GameReview => ({
  provider: 'github',
  number,
  title: `PR ${number}`,
  url: `${GIT}/lumen-app/pull/${number}`,
  state,
  ci
})

// The lumen team of the desktop clips (tests/e2e/team-panel-showcase.spec.ts), by the same names.
const SHOWCASE_MEMBERS = [
  member('tab-9:a', 'Pico', 'working', ['LUM-14', 'Offline cache for the feed', 'In Progress'], {
    review: review(42, 'pending'),
    toolName: 'Bash',
    toolInput: 'pnpm test feed-cache'
  }),
  member('tab-9:b', 'Orin', 'working', ['LUM-23', 'Push opt-in screen', 'In Progress'], {
    remote: { host: 'render-01', stateKnown: true },
    toolName: 'Edit',
    toolInput: 'PushOptIn.tsx'
  }),
  member('tab-9:c', 'Nova', 'working', ['LUM-25', 'Retry failed photo uploads', 'In Progress'], {
    review: review(47, 'failure'),
    remote: { host: 'ci-runner', stateKnown: true },
    toolName: 'Read',
    toolInput: 'UploadQueue.ts'
  }),
  member('tab-9:d', 'Vega', 'idle', ['LUM-21', 'Dark mode tokens', 'In Review'], {
    review: review(45, 'success'),
    remote: { host: 'studio', stateKnown: true },
    launch: launchOf('claude-sonnet-5-5', 'medium')
  }),
  member('tab-9:e', 'Kai', 'done', ['LUM-19', 'Onboarding copy refresh', 'Done'], {
    review: review(44, 'success', 'merged')
  })
]

// What each member does once the owner's answer reaches it.
const RESUMED: Record<string, Pick<GameAgent, 'toolName' | 'toolInput'>> = {
  'LUM-23': { toolName: 'Edit', toolInput: 'PushOptIn.tsx' },
  'LUM-25': { toolName: 'Edit', toolInput: 'UploadQueue.ts' }
}

/** The member stops while its question is open, as a session waiting on mail does. */
function showcaseMemberAsking(one: GameAgent): GameAgent {
  const { toolInput: _input, ...rest } = one
  return { ...rest, state: 'idle', toolName: null }
}

/** The member back at work after the lead relays the owner's answer. */
function showcaseMemberResumed(one: GameAgent): GameAgent {
  const ticket = one.workItem?.identifier ?? ''
  return { ...one, state: 'working', ...(RESUMED[ticket] ?? { toolName: null }) }
}

let showcaseProjects = isShowcaseScenario ? createShowcaseQuestionProjects() : []
let showcaseMembers = SHOWCASE_MEMBERS

function updateShowcaseMember(ticket: string | null, next: (one: GameAgent) => GameAgent): void {
  showcaseMembers = showcaseMembers.map((one) =>
    ticket && one.workItem?.identifier === ticket ? next(one) : one
  )
}

export function showcaseMembersNow(): GameAgent[] {
  return showcaseMembers
}

export function showcaseQuestionProjects(): GameOwnerQuestionProject[] {
  return showcaseProjects.filter((project) => project.questions.length > 0)
}

export function showcaseLeadQuestionCount(): number {
  return showcaseProjects.find((one) => one.worktreeId === LEAD_WORKTREE_ID)?.questions.length ?? 0
}

export function answerShowcaseQuestion(id: string, params: Record<string, unknown>): void {
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
      const owner = showcaseMembers.find((one) => one.workItem?.identifier === found.ticket)
      queueTerminalOutput(
        'term-lead',
        showcaseAnswerChunks(found.ticket, answer, owner?.displayName ?? null)
      )
      updateShowcaseMember(found.ticket, showcaseMemberResumed)
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
  updateShowcaseMember(question.ticket, showcaseMemberAsking)
  return { question, worktreeId: LEAD_WORKTREE_ID, repoName: project.repoName }
}
