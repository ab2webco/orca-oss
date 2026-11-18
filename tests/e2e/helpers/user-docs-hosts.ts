// Made-up hosts for the docs' Machines capture, in game.state's hostCapacity shape.
const GB = 1024 ** 3
const hostReading = (
  cores: number,
  memGb: [number, number],
  load: number,
  cpu: number,
  diskGb: [number, number]
) => ({
  status: 'ok',
  cpuCoreCount: cores,
  totalMemory: memGb[0] * GB,
  availableMemory: memGb[1] * GB,
  loadAverage1m: load,
  cpuUsagePercent: cpu,
  workspaceDiskTotal: diskGb[0] * GB,
  workspaceDiskFree: diskGb[1] * GB
})
const READY = { launch: { kind: 'ready' } }
// The three Lumen members run on local; buildbox is busy and low on memory; atelier lacks the repo.
export const DOCS_HOSTS = [
  { host: 'local', running: 3, cap: 4, ...hostReading(12, [32, 14], 3.4, 41, [512, 210]) },
  {
    host: 'studio',
    running: 0,
    cap: 4,
    ...READY,
    ...hostReading(10, [64, 51], 0.8, 9, [1000, 640])
  },
  {
    host: 'buildbox',
    running: 0,
    cap: 3,
    ...READY,
    ...hostReading(8, [16, 1.5], 9.1, 95, [460, 140])
  },
  {
    host: 'atelier',
    running: 0,
    cap: 4,
    ...hostReading(8, [32, 20], 0.4, 6, [500, 320]),
    launch: { kind: 'unregistered', project: 'lumen-app', reason: 'not on atelier' }
  },
  { host: 'nas-02', running: 0, cap: 2, status: 'unreachable', launch: { kind: 'unanswered' } }
]
