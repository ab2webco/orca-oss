import type { GameAgent, GameCi, GameState, GameStatusGroup } from '../types'
import { DEMO_ACTIONS, demoProjectOf } from './demo-project'
import { gameStrings, type ArtStrings } from './game-strings'
import type { Action, FlowPhase } from './quest-policy'
import { levelOf } from './rewards'

export const DEMO_STEP_TICKS = 40

export type DemoFrame = {
  state: GameState
  xp: number
  phase: FlowPhase
  action: Action | undefined
  caption: string
  isResting: boolean
  isLevelUp: boolean
}

type Seat = readonly [name: string, state: GameAgent['state'], tool: string | null]

type Step = {
  seats: readonly Seat[]
  ci: GameCi
  merged?: boolean
  group: GameStatusGroup
  xp: number
  phase: FlowPhase
  action: Action | undefined
  caption: (art: ArtStrings) => string
  isResting?: boolean
  /** Seats stopped by their account's usage limit, back in 90 minutes. */
  limited?: readonly string[]
}

const SCRIPT: readonly Step[] = [
  {
    seats: [
      ['builder', 'working', 'Read'],
      ['tester', 'working', 'Edit'],
      ['scribe', 'waiting', null],
      ['scout', 'working', 'Grep'],
      ['ranger', 'idle', null]
    ],
    ci: 'pending',
    group: 'in_progress',
    xp: 80,
    phase: 'docs',
    action: 'read',
    caption: (art) => `DEMO · ${art.reading} quest.tsx`
  },
  {
    seats: [
      ['builder', 'working', 'Edit'],
      ['tester', 'working', 'Bash'],
      ['scribe', 'waiting', null],
      ['scout', 'working', 'Read'],
      ['ranger', 'working', 'Edit']
    ],
    ci: 'failure',
    group: 'in_progress',
    xp: 80,
    phase: 'build',
    action: 'edit',
    caption: (art) => `DEMO · ${art.editing} scene.ts`
  },
  {
    seats: [
      ['builder', 'working', 'Bash'],
      ['tester', 'working', 'Bash'],
      ['scribe', 'working', 'Read'],
      ['scout', 'waiting', null],
      ['ranger', 'working', 'Bash']
    ],
    ci: 'failure',
    group: 'in_progress',
    xp: 80,
    phase: 'verify',
    action: 'test',
    caption: () => 'DEMO · pnpm test'
  },
  {
    seats: [
      ['builder', 'working', 'Bash'],
      ['tester', 'working', 'Bash'],
      ['scribe', 'working', 'Grep'],
      ['scout', 'working', 'Edit'],
      ['ranger', 'working', 'Bash']
    ],
    ci: 'pending',
    group: 'in_progress',
    xp: 80,
    phase: 'build',
    action: 'commit',
    caption: () => 'DEMO · git commit'
  },
  {
    seats: [
      ['builder', 'working', 'Bash'],
      ['tester', 'idle', null],
      ['scribe', 'working', 'Write'],
      ['scout', 'working', 'Bash'],
      ['ranger', 'waiting', null]
    ],
    ci: 'success',
    group: 'review',
    xp: 80,
    phase: 'pr',
    action: 'push',
    limited: ['tester'],
    caption: () => 'DEMO · git push'
  },
  {
    seats: [
      ['builder', 'working', 'Bash'],
      ['tester', 'idle', null],
      ['scribe', 'done', null],
      ['scout', 'working', 'Bash'],
      ['ranger', 'working', 'Read']
    ],
    ci: 'success',
    merged: true,
    group: 'review',
    xp: 130,
    phase: 'pr',
    action: 'merge',
    caption: () => 'DEMO · gh pr merge'
  },
  {
    seats: [
      ['builder', 'working', 'Bash'],
      ['tester', 'done', null],
      ['scribe', 'done', null],
      ['scout', 'done', null],
      ['ranger', 'working', 'Edit']
    ],
    ci: 'success',
    merged: true,
    group: 'done',
    xp: 130,
    phase: 'handoff',
    action: 'track',
    caption: (art) => `DEMO · ${art.movingTo('ORCA-1', 'Done')}`
  },
  {
    seats: [
      ['builder', 'working', 'Bash'],
      ['tester', 'done', null],
      ['scribe', 'done', null],
      ['scout', 'working', 'Bash'],
      ['ranger', 'working', 'Bash']
    ],
    ci: 'failure',
    group: 'done',
    xp: 130,
    phase: 'build',
    action: 'commit',
    caption: () => 'DEMO · git revert'
  },
  {
    seats: [
      ['builder', 'done', null],
      ['tester', 'done', null],
      ['scribe', 'done', null],
      ['scout', 'done', null],
      ['ranger', 'done', null]
    ],
    ci: 'success',
    merged: true,
    group: 'done',
    xp: 180,
    phase: 'handoff',
    action: undefined,
    caption: () => '',
    isResting: true
  }
]

export const DEMO_FRAMES = SCRIPT.length

const DEMO_LIMIT_MS = 90 * 60_000

// Members on other agents and managed accounts, so the Panel shows each card's tag.
const DEMO_SEAT_AGENTS: Readonly<Record<string, Pick<GameAgent, 'agentType' | 'account'>>> = {
  builder: {
    agentType: 'claude',
    account: { provider: 'claude', id: 'demo-ana', email: 'ana.lopez@example.invalid' }
  },
  tester: {
    agentType: 'codex',
    account: { provider: 'codex', id: 'demo-bo', email: 'bo@example.invalid' }
  },
  scribe: { agentType: 'claude' }
}
const stateOf = (step: Step): GameState => ({
  config: {},
  warnings: [],
  extensions: { scenes: [] },
  links: [],
  activity: null,
  worktree: { id: 'demo', path: '', branch: 'demo', displayName: 'demo' },
  agents: [
    {
      paneKey: 'demo-lead',
      displayName: 'lead',
      agentType: 'claude',
      state: 'working',
      toolName: null,
      isLeader: true
    },
    ...step.seats.map(([name, state, tool]) => ({
      paneKey: `demo-${name}`,
      displayName: name,
      ...(DEMO_SEAT_AGENTS[name] ?? { agentType: 'claude' }),
      state,
      toolName: tool,
      isLeader: false,
      ...(step.limited?.includes(name) ? { limit: { resetsAt: Date.now() + DEMO_LIMIT_MS } } : {})
    }))
  ],
  review: {
    provider: 'github',
    number: 901,
    title: 'demo: scripted pull request',
    url: 'https://example.invalid/demo/901',
    state: step.merged === true ? 'merged' : 'open',
    ci: step.ci
  },
  workItem: {
    provider: 'plane',
    identifier: 'ORCA-1',
    title: 'Demo work item',
    url: 'https://example.invalid/demo/ORCA-1',
    status: step.group === 'done' ? 'Done' : step.group === 'review' ? 'In Review' : 'In Progress',
    statusGroup: step.group
  },
  project: demoProjectOf(step.ci),
  actions: DEMO_ACTIONS
})

export const demoFrameOf = (step: number): DemoFrame => {
  const at = ((step % SCRIPT.length) + SCRIPT.length) % SCRIPT.length
  const frame = SCRIPT[at] ?? SCRIPT[0]
  const before = SCRIPT[(at + SCRIPT.length - 1) % SCRIPT.length] ?? frame
  if (frame === undefined || before === undefined) {
    throw new Error('the demo script is empty')
  }
  return {
    state: stateOf(frame),
    xp: frame.xp,
    phase: frame.phase,
    action: frame.action,
    caption: frame.caption(gameStrings().art),
    isResting: frame.isResting === true,
    isLevelUp: at !== 0 && levelOf(frame.xp).level > levelOf(before.xp).level
  }
}
