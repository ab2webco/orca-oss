import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import type { RuntimeTerminalShow } from '../../../../shared/runtime-types'
import { focusRendererTerminalHandle } from './terminal-handle-links'

// Why: a freshly activated remote worktree mirrors its host's tabs after one session-tabs round trip.
const MIRROR_WAIT_MS = 10_000
// Why: what a host answers for a handle whose terminal ended, which names nothing the owner can act on.
const GONE_TERMINAL_CODES = new Set([
  'terminal_handle_stale',
  'terminal_gone',
  'terminal_exited',
  'selector_not_found'
])

function failed(description: string): false {
  toast.error(
    translate(
      'auto.components.terminal-pane.paired-terminal-reveal.failed',
      "Could not open the member's terminal on its host"
    ),
    { description }
  )
  return false
}

function focusOnceMirrored(target: { environmentId: string; handle: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let unsubscribe = (): void => {}
    const timer = setTimeout(() => {
      unsubscribe()
      resolve(false)
    }, MIRROR_WAIT_MS)
    // Why: focusing sets store state, which re-enters this listener synchronously.
    let isFocusing = false
    unsubscribe = useAppStore.subscribe(() => {
      if (isFocusing) {
        return
      }
      isFocusing = true
      const isFocused = focusRendererTerminalHandle(target.handle, target.environmentId)
      isFocusing = false
      if (isFocused) {
        clearTimeout(timer)
        unsubscribe()
        resolve(true)
      }
    })
  })
}

/** Opens a connected server's terminal in this window, activating its worktree when no tab mirrors it yet (ORCA-839). */
export async function revealPairedTerminal(target: {
  environmentId: string
  handle: string
}): Promise<boolean> {
  if (focusRendererTerminalHandle(target.handle, target.environmentId)) {
    return true
  }
  let worktreeId: string
  try {
    const shown = await callRuntimeRpc<{ terminal: RuntimeTerminalShow }>(
      { kind: 'environment', environmentId: target.environmentId },
      'terminal.show',
      { terminal: target.handle }
    )
    worktreeId = shown.terminal.worktreeId
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    return failed(
      typeof code === 'string' && GONE_TERMINAL_CODES.has(code)
        ? translate(
            'auto.components.terminal-pane.paired-terminal-reveal.terminalGone',
            'The host no longer has this terminal; the member may have finished or been released.'
          )
        : error instanceof Error
          ? error.message
          : String(error)
    )
  }
  const activated = activateAndRevealWorktree(worktreeId, {
    executionHostId: toRuntimeExecutionHostId(target.environmentId)
  })
  if (activated === false) {
    return failed(
      translate(
        'auto.components.terminal-pane.paired-terminal-reveal.repoMissing',
        "Add the host's repository to this window to open its terminals."
      )
    )
  }
  return (
    (await focusOnceMirrored(target)) ||
    failed(
      translate(
        'auto.components.terminal-pane.paired-terminal-reveal.notMirrored',
        'Its worktree is open, but the terminal has not appeared in this window.'
      )
    )
  )
}
