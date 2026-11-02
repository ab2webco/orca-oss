import type {
  RuntimeWorktreeAgentRow,
  RuntimeWorktreePsSummary
} from '../../src/shared/runtime-types'
import type { GameOwnerQuestionProject } from '../../src/shared/orchestrator-game-owner-questions'
import type { MockRepo } from './mobile-lag-scenario'

// MOCK_SCENARIO=showcase: invented demo data for the README recordings (ORCA-955).
// Every name, ticket, host and URL here is made up; keep it that way.
export const isShowcaseScenario = process.env.MOCK_SCENARIO === 'showcase'

const ROOT = '/Users/demo/code'
const PLANE = 'https://plane.example.com/acme'
const GIT = 'https://git.example.com/acme'

export const SHOWCASE_REPOS: MockRepo[] = [
  { id: 'repo-web', displayName: 'acme-web', path: `${ROOT}/acme-web`, badgeColor: '#6366f1' },
  { id: 'repo-api', displayName: 'acme-api', path: `${ROOT}/acme-api`, badgeColor: '#06b6d4' },
  { id: 'repo-field', displayName: 'field-app', path: `${ROOT}/field-app`, badgeColor: '#f97316' }
].map((repo) => ({ ...repo, connectionId: null }))

const worktreeIdOf = (repo: MockRepo, name: string | null): string =>
  name ? `${repo.id}::${repo.path}/worktrees/${name}` : `${repo.id}::${repo.path}`

const [WEB, API, FIELD] = SHOWCASE_REPOS as [MockRepo, MockRepo, MockRepo]
export const LEAD_WORKTREE_ID = worktreeIdOf(WEB, null)
const CHECKOUT_WORKTREE_ID = worktreeIdOf(WEB, 'checkout-summary')
const API_WORKTREE_ID = worktreeIdOf(API, null)
const FIELD_WORKTREE_ID = worktreeIdOf(FIELD, null)

/** One terminal per worktree so each subscribe knows whose output to stream. */
const TERMINAL_HANDLES = new Map([
  [LEAD_WORKTREE_ID, 'term-lead'],
  [CHECKOUT_WORKTREE_ID, 'term-checkout'],
  [API_WORKTREE_ID, 'term-api'],
  [FIELD_WORKTREE_ID, 'term-field']
])

export function showcaseTerminalHandle(worktreeId: string): string {
  return TERMINAL_HANDLES.get(worktreeId) ?? 'term-checkout'
}

export function showcaseTerminalTitle(handle: string): string {
  return handle === 'term-lead' ? 'Lead — acme-web' : 'Claude — ACME-212'
}

function agentRow(
  paneKey: string,
  state: RuntimeWorktreeAgentRow['state'],
  title: string,
  ageMs: number,
  now: number
): RuntimeWorktreeAgentRow {
  return {
    paneKey,
    parentPaneKey: null,
    state,
    agentType: 'claude',
    prompt: title,
    taskTitle: title,
    displayName: title,
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: now - ageMs,
    updatedAt: now - ageMs
  }
}

export function createShowcaseWorktrees(now = Date.now()): RuntimeWorktreePsSummary[] {
  const row = (
    repo: MockRepo,
    worktreeId: string,
    fields: Partial<RuntimeWorktreePsSummary> & Pick<RuntimeWorktreePsSummary, 'displayName'>
  ): RuntimeWorktreePsSummary => ({
    worktreeId,
    repoId: repo.id,
    repo: repo.displayName,
    path: worktreeId.split('::')[1]!,
    branch: 'main',
    isArchived: false,
    isMainWorktree: false,
    hasHostSidebarActivity: true,
    parentWorktreeId: null,
    childWorktreeIds: [],
    workspaceStatus: 'in-progress',
    sortOrder: now,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    comment: '',
    isPinned: false,
    isActive: false,
    unread: false,
    liveTerminalCount: 1,
    hasAttachedPty: true,
    lastOutputAt: now - 4_000,
    preview: '',
    status: 'working',
    agents: [],
    ...fields
  })
  return [
    row(WEB, LEAD_WORKTREE_ID, {
      displayName: 'acme-web',
      isMainWorktree: true,
      isActive: true,
      preview: 'Lead · 5 members · 2 questions for you',
      agents: [agentRow('tab-lead:1', 'working', 'Lead · acme-web', 60_000, now)]
    }),
    row(WEB, CHECKOUT_WORKTREE_ID, {
      displayName: 'checkout-summary',
      branch: 'acme-212-checkout-summary',
      sortOrder: now - 1_000,
      linkedPR: { number: 412, state: 'open' },
      preview: '● Bash pnpm test checkout',
      agents: [agentRow('tab-co:1', 'working', 'ACME-212 Checkout summary', 180_000, now)]
    }),
    row(API, API_WORKTREE_ID, {
      displayName: 'acme-api',
      isMainWorktree: true,
      sortOrder: now - 2_000,
      status: 'active',
      preview: 'Waiting on you: rate limit',
      agents: [agentRow('tab-api:1', 'waiting', 'ACME-208 Public API limits', 420_000, now)]
    }),
    row(FIELD, FIELD_WORKTREE_ID, {
      displayName: 'field-app',
      isMainWorktree: true,
      sortOrder: now - 3_000,
      status: 'done',
      linkedPR: { number: 77, state: 'merged' },
      preview: 'FLD-41 merged',
      agents: [agentRow('tab-field:1', 'done', 'FLD-41 Offline sync', 900_000, now)]
    })
  ]
}

const member = (
  paneKey: string,
  name: string,
  state: string,
  ticket: [string, string, string],
  extra: Record<string, unknown> = {}
) => ({
  paneKey,
  displayName: name,
  agentType: 'claude',
  state,
  toolName: null,
  isLeader: false,
  isMember: true,
  launch: { model: 'opus', effort: null },
  workItem: {
    provider: 'plane',
    identifier: ticket[0],
    title: ticket[1],
    url: `${PLANE}/${ticket[0]}`,
    status: ticket[2],
    statusGroup: ticket[2] === 'Done' ? 'completed' : 'started'
  },
  ...extra
})

const review = (number: number, ci: string, state = 'open') => ({
  provider: 'github',
  number,
  title: `PR ${number}`,
  url: `${GIT}/acme-web/pull/${number}`,
  state,
  ci
})

export const SHOWCASE_MEMBERS = [
  member('tab-9:a', 'Maya', 'working', ['ACME-212', 'Checkout summary card', 'In Progress'], {
    review: review(412, 'pending')
  }),
  member('tab-9:b', 'Leo', 'working', ['ACME-214', 'Payment sandbox on CI', 'In Progress'], {
    review: review(415, 'failure'),
    remote: { host: 'build-box', stateKnown: true }
  }),
  member('tab-9:c', 'Iris', 'waiting', ['ACME-216', 'Webhook retry policy', 'In Progress']),
  member('tab-9:d', 'Theo', 'idle', ['ACME-205', 'Dark mode for invoices', 'In Review'], {
    review: review(409, 'success')
  }),
  member('tab-9:e', 'Sana', 'done', ['ACME-201', 'Faster product search', 'Done'], {
    review: review(401, 'success', 'merged')
  })
]

export const SHOWCASE_METRICS_MERGED = [
  { day: '2026-10-27', merged: 3 },
  { day: '2026-10-28', merged: 5 },
  { day: '2026-10-29', merged: 4 },
  { day: '2026-10-30', merged: 6 },
  { day: '2026-10-31', merged: 4 },
  { day: '2026-11-01', merged: 2 },
  { day: '2026-11-02', merged: 5 }
]

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString()

const question = (
  id: string,
  ticket: string | null,
  text: string,
  options: string[],
  context: string | null,
  minutes: number
) => ({ id, ticket, question: text, options, context, askedAt: minutesAgo(minutes), answer: null })

export function createShowcaseQuestionProjects(): GameOwnerQuestionProject[] {
  return [
    {
      repoId: WEB.id,
      repoName: WEB.displayName,
      worktreeId: LEAD_WORKTREE_ID,
      questions: [
        question(
          'q-web-1',
          'ACME-214',
          'The payment sandbox is slow on CI. Raise the checkout spec timeout to 90 s?',
          ['Raise to 90 s', 'Keep 60 s'],
          `${GIT}/acme-web/pull/415`,
          14
        ),
        question(
          'q-web-2',
          null,
          'Ship v2.4 to staging tonight, or wait for ACME-212?',
          ['Tonight', 'Wait'],
          null,
          6
        )
      ]
    },
    {
      repoId: API.id,
      repoName: API.displayName,
      worktreeId: API_WORKTREE_ID,
      questions: [
        question(
          'q-api-1',
          'ACME-208',
          'Public API rate limit for free accounts: 100 or 300 requests a minute?',
          ['100 / min', '300 / min'],
          `${PLANE}/ACME-208`,
          31
        )
      ]
    },
    {
      repoId: FIELD.id,
      repoName: FIELD.displayName,
      worktreeId: FIELD_WORKTREE_ID,
      questions: [
        question(
          'q-field-1',
          'FLD-44',
          'Offline edit conflict: keep the phone copy or the server copy?',
          ['Phone wins', 'Server wins', 'Ask each time'],
          null,
          52
        )
      ]
    }
  ]
}

/** The question the notification trigger adds to the lead's project. */
export function showcaseIncomingQuestion() {
  return question(
    `q-web-${Date.now()}`,
    'ACME-216',
    'Webhook retries: give up after 3 attempts or 5?',
    ['3 attempts', '5 attempts'],
    `${PLANE}/ACME-216`,
    0
  )
}
