import { BrowserWindow } from 'electron'

/**
 * Last-resort reclamation of the OS process behind a closed offscreen browser page.
 *
 * Why this exists: destroying the BrowserWindow normally takes its renderer down with
 * it, but #14552 reported pages whose renderer had stopped answering — `orca tab close`
 * came back `runtime_error`, the page stayed listed, and the process kept its 220-480 MB.
 * A renderer that is wedged (or stopped) never processes the shutdown IPC, so the close
 * has to be able to finish the job at the OS level.
 */

// Why a grace window rather than an immediate kill: a healthy renderer exits on its own
// within a few milliseconds of the window being destroyed, and SIGKILLing it first would
// skip the ordinary teardown for every close.
const RENDERER_EXIT_GRACE_MS = 1_000
const RENDERER_EXIT_POLL_MS = 25

export type RendererProcessControl = {
  isAlive: (osProcessId: number) => boolean
  kill: (osProcessId: number) => void
}

export const nodeRendererProcessControl: RendererProcessControl = {
  isAlive: (osProcessId) => {
    try {
      process.kill(osProcessId, 0)
      return true
    } catch (error) {
      // Why EPERM counts as alive: the signal was refused, which only a live process can do.
      return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
  },
  kill: (osProcessId) => {
    try {
      process.kill(osProcessId, 'SIGKILL')
    } catch {
      // Already gone between the liveness check and the signal.
    }
  }
}

/**
 * True while any live window still renders in this process. Chromium reuses one renderer
 * across same-site pages — #14552 saw 9 tabs backed by 6 renderers — so killing a shared
 * process would take out tabs nobody asked to close.
 */
function rendererProcessIsShared(osProcessId: number): boolean {
  return BrowserWindow.getAllWindows().some(
    (window) => !window.isDestroyed() && window.webContents.getOSProcessId() === osProcessId
  )
}

export type RendererReclaimOutcome = 'exited' | 'killed' | 'shared'

/** Waits out the renderer's own exit, then forces it if it never came. */
export async function reclaimRendererProcess(
  osProcessId: number,
  options: {
    control?: RendererProcessControl
    isShared?: (osProcessId: number) => boolean
    graceMs?: number
    pollMs?: number
  } = {}
): Promise<RendererReclaimOutcome> {
  const control = options.control ?? nodeRendererProcessControl
  const isShared = options.isShared ?? rendererProcessIsShared
  const pollMs = options.pollMs ?? RENDERER_EXIT_POLL_MS
  const deadline = Date.now() + (options.graceMs ?? RENDERER_EXIT_GRACE_MS)
  while (control.isAlive(osProcessId)) {
    if (isShared(osProcessId)) {
      return 'shared'
    }
    if (Date.now() >= deadline) {
      control.kill(osProcessId)
      return 'killed'
    }
    const poll = Promise.withResolvers<void>()
    setTimeout(poll.resolve, pollMs)
    await poll.promise
  }
  return 'exited'
}
