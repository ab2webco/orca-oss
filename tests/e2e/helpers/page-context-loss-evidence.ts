/**
 * Why this exists: `page.evaluate: Execution context was destroyed` has at least
 * three causes that look identical from the error text, and ORCA-300 burned five
 * hypotheses because nothing on the Page side was recorded.
 *
 * `renderer-recovery-evidence.ts` already answers "did the renderer die?" from
 * the main-process side (`crash-reports.json`). When it reports `did not fire`,
 * the renderer did *not* die — and that is exactly where the remaining three
 * causes live, none of which leave a trace today:
 *
 *   - the main frame navigated somewhere else
 *   - the main frame reloaded (same URL) — Orca reloads its own window on
 *     several paths, and a reload destroys the context without a crash
 *   - the handle points at a window that is no longer the app's, so nothing
 *     died at all and the `evaluate` asked the wrong page
 *
 * The three are separated by what the Page reported, not by reading the message.
 */
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'

export type PageNavigationRecord = {
  /** ms since the recorder attached, so records read as a timeline. */
  atMs: number
  url: string
}

export type PageContextLossObservation = {
  /** The main frame's URL when the recorder attached. */
  initialUrl: string
  mainFrameNavigations: PageNavigationRecord[]
  loads: number
  /** Playwright's own `crash` event for this page (distinct from a crash record). */
  crashed: boolean
  closed: boolean
  windowsAtAttach: number
  windowsAtReport: number
  /**
   * Index of the handle's page in `electronApp.windows()` at report time.
   * `-1` means the app no longer lists it — the handle outlived its window.
   */
  handleWindowIndex: number
  windowUrlsAtReport: string[]
}

export type PageContextLossVerdict =
  /** The main frame went to a different URL. */
  | 'navigated'
  /** The main frame went to the same URL — a reload, not a route change. */
  | 'reloaded'
  /** Playwright reported the page crashed. */
  | 'page-crashed'
  /** The page closed under the test. */
  | 'page-closed'
  /** No navigation on this page, and the app no longer lists it. */
  | 'wrong-window'
  /** Nothing observed — the loss came from somewhere this recorder cannot see. */
  | 'no-navigation'

/**
 * The verdict, from the observation alone.
 *
 * Kept pure and separate from the recorder so the classification can be tested
 * without a browser — the recorder is I/O, this is the part that can be wrong.
 *
 * Order matters: a crashed or closed page also stops navigating, so those are
 * read before the absence of navigation is given any meaning.
 */
export function classifyPageContextLoss(
  observation: PageContextLossObservation
): PageContextLossVerdict {
  if (observation.crashed) {
    return 'page-crashed'
  }
  if (observation.closed) {
    return 'page-closed'
  }
  const last = observation.mainFrameNavigations.at(-1)
  if (last) {
    // Same URL is the tell for a reload: a route change inside the SPA does not
    // navigate the main frame at all, so any main-frame event back to the same
    // URL is the document being replaced.
    return last.url === observation.initialUrl ? 'reloaded' : 'navigated'
  }
  if (observation.handleWindowIndex < 0) {
    return 'wrong-window'
  }
  return 'no-navigation'
}

/** One log line, in the shape `renderer-recovery-evidence` already prints. */
export function formatPageContextLossLine(
  testTitle: string,
  observation: PageContextLossObservation,
  verdict: PageContextLossVerdict
): string {
  const nav = observation.mainFrameNavigations
    .map((record) => `${record.atMs}ms→${record.url}`)
    .join(', ')
  const detail =
    verdict === 'no-navigation'
      ? 'the page never navigated, never reloaded, and is still the app window — this recorder cannot see the cause'
      : `navigations: [${nav || 'none'}], loads: ${observation.loads}, ` +
        `windows ${observation.windowsAtAttach}→${observation.windowsAtReport}, ` +
        `handle index ${observation.handleWindowIndex}`
  return `[page-context-loss] ${testTitle} :: ${verdict} — ${detail}`
}

type Recorder = {
  observe: (app: ElectronApplication) => PageContextLossObservation
}

const recorders = new WeakMap<Page, Recorder>()

/**
 * Starts recording main-frame navigation for a page.
 *
 * Listener-only: it never navigates, evaluates, or waits, so it cannot change
 * the timing of the thing it is measuring.
 */
export function recordPageContextLoss(page: Page, app: ElectronApplication): void {
  const attachedAt = Date.now()
  const initialUrl = page.url()
  const windowsAtAttach = app.windows().length
  const mainFrameNavigations: PageNavigationRecord[] = []
  let loads = 0
  let crashed = false
  let closed = false

  page.on('framenavigated', (frame) => {
    // Child frames (webviews, the embedded browser) navigate constantly and
    // never destroy the main frame's context.
    if (frame === page.mainFrame()) {
      mainFrameNavigations.push({ atMs: Date.now() - attachedAt, url: frame.url() })
    }
  })
  page.on('load', () => {
    loads += 1
  })
  page.on('crash', () => {
    crashed = true
  })
  page.on('close', () => {
    closed = true
  })

  recorders.set(page, {
    observe: (currentApp) => {
      const windows = currentApp.windows()
      return {
        initialUrl,
        mainFrameNavigations,
        loads,
        crashed,
        closed,
        windowsAtAttach,
        windowsAtReport: windows.length,
        handleWindowIndex: windows.indexOf(page),
        // A closed page throws on url(); the handle's own record is enough.
        windowUrlsAtReport: windows.map((window) => {
          try {
            return window.url()
          } catch {
            return '<unreadable>'
          }
        })
      }
    }
  })
}

/**
 * Prints and attaches the observation when the test did not pass.
 *
 * Silent on success by design: this is diagnosis for a failure, and a line per
 * passing test would bury it.
 */
export async function reportPageContextLoss(
  page: Page,
  app: ElectronApplication,
  testInfo: TestInfo
): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) {
    return
  }
  const recorder = recorders.get(page)
  if (!recorder) {
    return
  }
  let observation: PageContextLossObservation
  try {
    observation = recorder.observe(app)
  } catch {
    // Never let diagnosis mask the assertion that actually failed.
    return
  }
  const verdict = classifyPageContextLoss(observation)
  console.log(formatPageContextLossLine(testInfo.titlePath.join(' > '), observation, verdict))
  await testInfo.attach('page-context-loss.json', {
    body: JSON.stringify({ verdict, ...observation }, null, 2),
    contentType: 'application/json'
  })
}
