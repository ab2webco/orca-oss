// The showcase lead's PRs, merge queue, To Do and hosts for the Team clip (ORCA-1271).
// Every name, URL and host here is made up; keep it that way.
import type { GameHostCapacity } from '../../src/shared/orchestrator-game-host-capacity'
import type {
  GameProjectItem,
  GameProjectWork
} from '../../src/shared/orchestrator-game-project-work'
import type { OrchestratorGameState } from '../../src/shared/orchestrator-game-state'
import { LEAD_ACTIONS } from './mock-server-lead-project'
import { GIT, PLANE } from './mock-server-showcase-scenario'

const pr = (number: number, title: string, extra: Partial<GameProjectItem> = {}) => ({
  id: `#${number}`,
  title,
  url: `${GIT}/lumen-app/pull/${number}`,
  ...extra
})
const ticket = (id: string, title: string): GameProjectItem => ({
  id,
  title,
  url: `${PLANE}/${id}`,
  group: 'todo',
  status: 'Todo'
})
const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000

const PROJECT: () => GameProjectWork = () => ({
  reviews: {
    provider: 'github',
    total: 4,
    url: `${GIT}/lumen-app/pulls`,
    items: [
      pr(47, 'Retry failed photo uploads', { status: 'failure' }),
      pr(42, 'Offline cache for the feed', { status: 'pending' }),
      pr(45, 'Dark mode tokens', { status: 'success' }),
      pr(48, 'Push opt-in screen', { status: 'pending', reviewBlock: 'draft' })
    ]
  },
  queue: {
    provider: 'github',
    entries: [
      { ...pr(45, 'Dark mode tokens'), position: 1, state: 'checks', since: minutesAgo(6) },
      {
        ...pr(43, 'Export settings as a file'),
        position: 2,
        state: 'waiting',
        since: minutesAgo(9)
      }
    ]
  },
  todo: {
    provider: 'plane',
    total: 3,
    url: `${PLANE}/todo`,
    items: [
      ticket('LUM-27', 'Share sheet for albums'),
      ticket('LUM-28', 'Cap the image cache at 200 MB'),
      ticket('LUM-29', 'Accessibility labels on the feed')
    ]
  }
})

const GB = 1024 ** 3
const READY = {
  kind: 'ready',
  repo: {
    id: 'repo-app',
    displayName: 'lumen-app',
    path: '/Users/demo/code/lumen-app',
    remoteKey: null
  }
} as const
const host = (
  name: string,
  running: number,
  cap: number,
  reading: [cores: number, memoryGb: number, freeGb: number, load: number, cpu: number]
): GameHostCapacity => ({
  host: name,
  running,
  cap,
  status: 'ok',
  cpuCoreCount: reading[0],
  totalMemory: reading[1] * GB,
  availableMemory: reading[2] * GB,
  loadAverage1m: reading[3],
  cpuUsagePercent: reading[4],
  workspaceDiskTotal: 1000 * GB,
  workspaceDiskFree: 610 * GB,
  ...(name === 'local' ? {} : { launch: READY })
})

// The members' hosts: this desktop, a busy CI box, a calm studio Mac and the render node.
const HOSTS: GameHostCapacity[] = [
  host('local', 2, 5, [10, 64, 30, 3.8, 34]),
  host('ci-runner', 1, 4, [16, 32, 3, 14.2, 91]),
  host('studio', 1, 4, [24, 128, 96, 1.6, 9]),
  host('render-01', 1, 3, [8, 32, 18, 2.4, 22])
]

/** The showcase lead's To Do, PRs, merge queue, hosts and buttons, in the host's game.state shapes. */
export const showcaseProjectState = (): Partial<OrchestratorGameState> => ({
  project: PROJECT(),
  hostCapacity: HOSTS,
  actions: LEAD_ACTIONS
})
