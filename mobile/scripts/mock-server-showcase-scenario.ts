import type {
  RuntimeWorktreeAgentRow,
  RuntimeWorktreePsSummary
} from '../../src/shared/runtime-types'
import type { GameOwnerQuestionProject } from '../../src/shared/orchestrator-game-owner-questions'
import type { MockRepo } from './mobile-lag-scenario'

// MOCK_SCENARIO=showcase: invented demo data for the README and site recordings (ORCA-955, ORCA-1176).
// Every name, ticket, host and URL here is made up; keep it that way.
export const isShowcaseScenario = process.env.MOCK_SCENARIO === 'showcase'

const ROOT = '/Users/demo/code'
export const PLANE = 'https://plane.example.com/lumen'
export const GIT = 'https://git.example.com/lumen'

export const SHOWCASE_REPOS: MockRepo[] = [
  { id: 'repo-app', displayName: 'lumen-app', path: `${ROOT}/lumen-app`, badgeColor: '#6366f1' },
  { id: 'repo-api', displayName: 'lumen-api', path: `${ROOT}/lumen-api`, badgeColor: '#06b6d4' },
  { id: 'repo-web', displayName: 'lumen-web', path: `${ROOT}/lumen-web`, badgeColor: '#f97316' }
].map((repo) => ({ ...repo, connectionId: null }))

const worktreeIdOf = (repo: MockRepo, name: string | null): string =>
  name ? `${repo.id}::${repo.path}/worktrees/${name}` : `${repo.id}::${repo.path}`

const [APP, API, WEB] = SHOWCASE_REPOS as [MockRepo, MockRepo, MockRepo]
export const LEAD_WORKTREE_ID = worktreeIdOf(APP, null)
const FEED_WORKTREE_ID = worktreeIdOf(APP, 'offline-feed')
const API_WORKTREE_ID = worktreeIdOf(API, null)
const WEB_WORKTREE_ID = worktreeIdOf(WEB, null)

/** The lead's own worktree as game.state names it. */
export const SHOWCASE_LEAD_WORKTREE = {
  id: LEAD_WORKTREE_ID,
  path: APP.path,
  branch: 'main',
  displayName: APP.displayName
}

/** The site and desktop clips call this lead Atlas. */
export const SHOWCASE_LEAD_LABEL = 'Atlas'

/** One terminal per worktree so each subscribe knows whose output to stream. */
const TERMINAL_HANDLES = new Map([
  [LEAD_WORKTREE_ID, 'term-lead'],
  [FEED_WORKTREE_ID, 'term-feed'],
  [API_WORKTREE_ID, 'term-api'],
  [WEB_WORKTREE_ID, 'term-web']
])

export function showcaseTerminalHandle(worktreeId: string): string {
  return TERMINAL_HANDLES.get(worktreeId) ?? 'term-feed'
}

export function showcaseTerminalTitle(handle: string): string {
  return handle === 'term-lead' ? 'Atlas — lumen-app' : 'Claude — LUM-14'
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
    row(APP, LEAD_WORKTREE_ID, {
      displayName: 'lumen-app',
      isMainWorktree: true,
      isActive: true,
      preview: 'Atlas · 5 members · 2 questions for you',
      agents: [agentRow('tab-lead:1', 'working', 'Atlas · lumen-app', 60_000, now)]
    }),
    row(APP, FEED_WORKTREE_ID, {
      displayName: 'offline-feed',
      branch: 'lum-14-offline-feed',
      sortOrder: now - 1_000,
      linkedPR: { number: 42, state: 'open' },
      preview: '● Bash pnpm test feed-cache',
      agents: [agentRow('tab-feed:1', 'working', 'LUM-14 Offline cache for the feed', 180_000, now)]
    }),
    row(API, API_WORKTREE_ID, {
      displayName: 'lumen-api',
      isMainWorktree: true,
      sortOrder: now - 2_000,
      status: 'active',
      preview: 'Waiting on you: rate limit',
      agents: [agentRow('tab-api:1', 'waiting', 'API-208 Public API limits', 420_000, now)]
    }),
    row(WEB, WEB_WORKTREE_ID, {
      displayName: 'lumen-web',
      isMainWorktree: true,
      sortOrder: now - 3_000,
      status: 'done',
      linkedPR: { number: 77, state: 'merged' },
      preview: 'WEB-41 merged',
      agents: [agentRow('tab-web:1', 'done', 'WEB-41 Pricing page', 900_000, now)]
    })
  ]
}

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
      repoId: APP.id,
      repoName: APP.displayName,
      worktreeId: LEAD_WORKTREE_ID,
      questions: [
        question(
          'q-app-1',
          'LUM-23',
          'Push opt-in: ask on first launch, or after the first saved post?',
          ['First launch', 'After first post'],
          `${PLANE}/LUM-23`,
          14
        ),
        question(
          'q-app-2',
          null,
          'Ship 3.2 to TestFlight tonight, or wait for LUM-14?',
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
          'API-208',
          'Public API rate limit for free accounts: 100 or 300 requests a minute?',
          ['100 / min', '300 / min'],
          `${PLANE}/API-208`,
          31
        )
      ]
    },
    {
      repoId: WEB.id,
      repoName: WEB.displayName,
      worktreeId: WEB_WORKTREE_ID,
      questions: [
        question(
          'q-web-1',
          'WEB-44',
          'Pricing page on a slow connection: the video or a still?',
          ['Still', 'Video', 'Ask each time'],
          null,
          52
        )
      ]
    }
  ]
}

/** The question the notification trigger adds to the lead's project: the site's step 6. */
export function showcaseIncomingQuestion() {
  return question(
    `q-app-${Date.now()}`,
    'LUM-25',
    'Retry uploads on cellular?',
    ['Yes', 'Wi-Fi only'],
    `${PLANE}/LUM-25`,
    0
  )
}
