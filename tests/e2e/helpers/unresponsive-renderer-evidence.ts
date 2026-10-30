/**
 * Why this exists: an `expect.poll` over `page.evaluate` only ever sees one sample when the
 * renderer stops answering, so a hung renderer reads as a bare "Timeout exceeded while waiting
 * on the predicate" and the teardown's force-kill then prints `signal=SIGKILL` and
 * `renderer-process-gone` — a renderer death the harness caused, not the product (ORCA-826).
 * Bounding the evaluate and asking main what the renderer was doing names the stall instead.
 */
import type { ElectronApplication } from '@stablyai/playwright-test'
import { withTimeout } from './electron-process-shutdown'

/** A sync store read answers in milliseconds; this only trips on a renderer that is not answering. */
export const RENDERER_EVALUATE_BUDGET_MS = 15_000
const MAIN_EVIDENCE_TIMEOUT_MS = 5_000
const CPU_SAMPLE_MS = 1_000
/** A main thread spinning in JS pins one core; a waiting one sits near zero. */
const BUSY_CORE_PERCENT = 80

export type RendererWindowEvidence = {
  url: string
  crashed: boolean
  loading: boolean
  pid: number | null
  /** Percent of one core over the sample; 100 is a pinned thread on any core count. */
  cpuCorePercent: number | null
  workingSetKb: number | null
}

export type UnresponsiveRendererEvidence =
  | { mainResponsive: false }
  | { mainResponsive: true; windows: RendererWindowEvidence[] }

export type UnresponsiveRendererVerdict =
  | 'main-unresponsive'
  | 'no-window'
  | 'renderer-crashed'
  | 'renderer-loading'
  | 'renderer-busy'
  | 'renderer-waiting'

export function classifyUnresponsiveRenderer(
  evidence: UnresponsiveRendererEvidence
): UnresponsiveRendererVerdict {
  if (!evidence.mainResponsive) {
    return 'main-unresponsive'
  }
  const { windows } = evidence
  if (windows.length === 0) {
    return 'no-window'
  }
  if (windows.some((window) => window.crashed)) {
    return 'renderer-crashed'
  }
  if (windows.some((window) => window.loading)) {
    return 'renderer-loading'
  }
  return windows.some((window) => (window.cpuCorePercent ?? 0) >= BUSY_CORE_PERCENT)
    ? 'renderer-busy'
    : 'renderer-waiting'
}

function describeWindow(window: RendererWindowEvidence): string {
  const cpu = window.cpuCorePercent === null ? '?' : `${Math.round(window.cpuCorePercent)}%ofCore`
  const workingSet =
    window.workingSetKb === null ? '?' : `${Math.round(window.workingSetKb / 1024)}MB`
  return `pid=${window.pid ?? '?'} cpu=${cpu} workingSet=${workingSet} crashed=${window.crashed} loading=${window.loading} url=${window.url}`
}

function describeUnresponsiveRenderer(
  label: string,
  budgetMs: number,
  evidence: UnresponsiveRendererEvidence
): string {
  const verdict = classifyUnresponsiveRenderer(evidence)
  const windows = evidence.mainResponsive
    ? evidence.windows.map(describeWindow).join(' | ') || 'no windows'
    : `main did not answer within ${MAIN_EVIDENCE_TIMEOUT_MS}ms either`
  return `${label}: renderer did not answer page.evaluate within ${budgetMs}ms (${verdict}); ${windows}`
}

/** Run one renderer evaluate; past the budget, throw what main saw instead of hanging the caller. */
export async function evaluateWithinRendererBudget<T>(
  evaluate: () => Promise<T>,
  collectEvidence: () => Promise<UnresponsiveRendererEvidence>,
  { label, budgetMs = RENDERER_EVALUATE_BUDGET_MS }: { label: string; budgetMs?: number }
): Promise<T> {
  const stalled = Symbol('stalled')
  let timeout: NodeJS.Timeout | null = null
  const result = await Promise.race([
    evaluate(),
    new Promise<typeof stalled>((resolve) => {
      timeout = setTimeout(() => resolve(stalled), budgetMs)
      timeout.unref?.()
    })
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout)
    }
  })
  if (result !== stalled) {
    return result as T
  }
  throw new Error(describeUnresponsiveRenderer(label, budgetMs, await collectEvidence()))
}

export async function collectUnresponsiveRendererEvidence(
  app: ElectronApplication
): Promise<UnresponsiveRendererEvidence> {
  try {
    const windows = await withTimeout(
      app.evaluate(async ({ app: electronApp, BrowserWindow }, sampleMs) => {
        // Why CPU seconds: percentCPUUsage is spread over every core, so a pinned thread reads ~25% on 4 cores.
        const cpuSecondsByPid = (): Map<number, number | undefined> =>
          new Map(
            electronApp.getAppMetrics().map((metric) => [metric.pid, metric.cpu.cumulativeCPUUsage])
          )
        const before = cpuSecondsByPid()
        await new Promise((resolve) => setTimeout(resolve, sampleMs))
        const after = cpuSecondsByPid()
        const metrics = electronApp.getAppMetrics()
        return BrowserWindow.getAllWindows().map((window) => {
          const contents = window.webContents
          const pid = contents.getOSProcessId() || null
          const startSeconds = pid === null ? undefined : before.get(pid)
          const endSeconds = pid === null ? undefined : after.get(pid)
          return {
            url: contents.getURL(),
            crashed: contents.isCrashed(),
            loading: contents.isLoading(),
            pid,
            cpuCorePercent:
              startSeconds === undefined || endSeconds === undefined
                ? null
                : ((endSeconds - startSeconds) * 100_000) / sampleMs,
            workingSetKb:
              metrics.find((candidate) => candidate.pid === pid)?.memory.workingSetSize ?? null
          }
        })
      }, CPU_SAMPLE_MS),
      MAIN_EVIDENCE_TIMEOUT_MS,
      'main did not answer'
    )
    return { mainResponsive: true, windows }
  } catch {
    return { mainResponsive: false }
  }
}
