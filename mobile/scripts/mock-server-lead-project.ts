import type { GameAction } from '../../src/shared/orchestrator-game-actions'
import type { GameHostCapacity } from '../../src/shared/orchestrator-game-host-capacity'
import type {
  GameProjectItem,
  GameProjectWork
} from '../../src/shared/orchestrator-game-project-work'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'

const PULLS = 'https://github.com/ab2webco/orca-oss/pull'
const pr = (number: number, title: string, extra: Partial<GameProjectItem> = {}) => ({
  id: `#${number}`,
  title,
  url: `${PULLS}/${number}`,
  ...extra
})
const ticket = (id: string, title: string): GameProjectItem => ({
  id,
  title,
  url: `https://plane.example/${id}`,
  group: 'todo',
  status: 'Todo'
})
const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000

// MOCK_REVIEWS=off: a project whose review provider is not read.
function projectWork(): GameProjectWork {
  const long = 'for every region the store sells to'
  return {
    reviews:
      process.env.MOCK_REVIEWS === 'off'
        ? null
        : {
            provider: 'github',
            total: 7,
            url: 'https://git.example.com/acme/acme-web/pulls',
            items: [
              pr(409, 'Checkout: retry the payment sandbox call once', { status: 'success' }),
              pr(415, 'Raise the checkout spec timeout to 90 s', { status: 'failure' }),
              pr(412, `Checkout summary shows the discount line and the tax breakdown ${long}`, {
                status: 'pending'
              }),
              pr(418, 'Docs: webhook signing', { status: 'success', reviewBlock: 'conflict' }),
              pr(420, 'Spike: offline cart', { status: 'pending', reviewBlock: 'draft' })
            ]
          },
    queue: {
      provider: 'github',
      entries: [
        {
          ...pr(409, 'Checkout: retry the payment sandbox call once'),
          position: 1,
          state: 'checks',
          since: minutesAgo(12)
        },
        {
          ...pr(401, 'Release notes for 2.4 with the long list of every change since 2.3'),
          position: 2,
          state: 'waiting',
          since: minutesAgo(300)
        },
        { ...pr(398, 'Bump the payments SDK'), position: 3, state: 'failed', since: minutesAgo(40) }
      ]
    },
    todo: {
      provider: 'plane',
      total: 3,
      url: 'https://plane.example/todo',
      items: [
        ticket('ACME-221', 'Retry policy for the payment sandbox timeout'),
        ticket(
          'ACME-224',
          `Checkout summary: show the discount line and the tax breakdown ${long}`
        ),
        ticket('ACME-230', 'Docs: webhook signing')
      ]
    }
  }
}

const GB = 1024 ** 3
const HOST_CAPACITY: GameHostCapacity[] = [
  {
    host: 'local',
    running: 3,
    cap: 5,
    status: 'ok',
    cpuCoreCount: 10,
    totalMemory: 64 * GB,
    availableMemory: 21 * GB,
    loadAverage1m: 6.2
  },
  {
    host: 'mac-studio',
    running: 2,
    cap: 4,
    status: 'ok',
    cpuCoreCount: 24,
    totalMemory: 128 * GB,
    availableMemory: 80 * GB,
    loadAverage1m: 3.1
  },
  { host: 'build-box-linux-02', running: 0, cap: 3, status: 'unreachable' }
]

const ACTIONS: GameAction[] = [
  {
    id: 'lead:wave',
    label: 'Wave',
    icon: 'launch',
    prompt: '/orca-game:wave',
    command: 'orca-game:wave'
  },
  {
    id: 'lead:status',
    label: 'Status',
    icon: 'pulse',
    prompt: '/orca-game:status',
    command: 'orca-game:status'
  },
  {
    id: 'lead:push',
    label: 'Push',
    icon: 'play',
    prompt: '/orca-game:push',
    command: 'orca-game:push'
  },
  {
    id: 'lead:sweep',
    label: 'Sweep',
    icon: 'check',
    prompt: '/orca-game:sweep',
    command: 'orca-game:sweep'
  },
  {
    id: 'lead:stop',
    label: 'Stop',
    icon: 'stop',
    prompt: '/orca-game:stop',
    command: 'orca-game:stop'
  },
  {
    id: 'action-0',
    label: 'Release notes',
    icon: 'tag',
    prompt: 'Draft the release notes for the merged PRs',
    pin: true
  }
]

const isoMinutesAgo = (minutes: number) => new Date(minutesAgo(minutes)).toISOString()

// MOCK_STOPPED=1: the project's STOP is set, with one paused and one queued member.
const stoppedTeam = (): Partial<OrchestratorGameState> =>
  process.env.MOCK_STOPPED
    ? {
        stopped: { since: isoMinutesAgo(20), by: 'lead' },
        pausedMembers: [
          {
            ticket: 'ACME-230',
            name: 'Kai',
            agent: 'claude',
            account: 'dev@example.com',
            branch: 'acme-230-webhook-docs',
            lastState: 'working',
            resumable: true,
            runId: 'run-acme-230',
            since: isoMinutesAgo(18)
          }
        ],
        queuedMembers: [{ ticket: 'ACME-221', name: 'Nova', position: 1, waitingOn: 'setup' }]
      }
    : {}

/** The lead's To Do, PRs, merge queue, hosts and buttons, in the host's game.state shapes. */
export const leadProjectState = (): Partial<OrchestratorGameState> => ({
  project: projectWork(),
  hostCapacity: HOST_CAPACITY,
  actions: ACTIONS,
  ...stoppedTeam()
})
