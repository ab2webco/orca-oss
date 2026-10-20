import type {
  GameAction,
  GameCi,
  GameLinkTone,
  GameProjectItem,
  GameProjectWork,
  GameStatusGroup
} from '../types'

const DEMO_URL = 'https://example.invalid/demo'

const DEMO_TONES: Readonly<Record<GameCi, GameLinkTone>> = {
  failure: 'danger',
  success: 'success',
  pending: 'pending',
  neutral: 'neutral',
  none: 'neutral'
}

const todoOf = (
  id: string,
  title: string,
  group: GameStatusGroup,
  status: string
): GameProjectItem => ({
  id,
  title,
  url: `${DEMO_URL}/${id}`,
  status,
  group,
  prompt: `Work on ${id}: ${title}`,
  ...(group === 'in_progress' ? { tone: 'pending' } : group === 'review' ? { tone: 'success' } : {})
})

// Pressing either during /quest demo only toasts; the MCP server named here is never called.
export const DEMO_ACTIONS: GameAction[] = [
  { id: 'action-0', label: 'Open a PR', prompt: 'Open a PR for the demo work item' },
  { id: 'action-1', label: 'Test runs', mcp: { server: 'demo', tool: 'list_test_runs' } }
]

// The project lists follow the scripted PR's CI so the PRs chip changes color with it.
export const demoProjectOf = (ci: GameCi): GameProjectWork => ({
  reviews: {
    provider: 'github',
    total: 2,
    url: `${DEMO_URL}/pulls`,
    items: [
      {
        id: '#901',
        title: 'demo: scripted pull request',
        url: `${DEMO_URL}/901`,
        status: ci,
        tone: DEMO_TONES[ci]
      },
      { id: '#902', title: 'demo: second pull request', url: `${DEMO_URL}/902`, tone: 'success' }
    ]
  },
  todo: {
    provider: 'plane',
    total: 7,
    url: `${DEMO_URL}/todo`,
    items: [
      todoOf('ORCA-3', 'Another demo ticket', 'in_progress', 'In Progress'),
      todoOf('ORCA-4', 'Demo ticket in QA', 'review', 'QA'),
      todoOf('ORCA-5', 'Second ticket in QA', 'review', 'QA'),
      todoOf('ORCA-2', 'Demo ticket', 'todo', 'Todo')
    ],
    groups: { in_progress: 1, review: 2, todo: 3, backlog: 1 }
  }
})
