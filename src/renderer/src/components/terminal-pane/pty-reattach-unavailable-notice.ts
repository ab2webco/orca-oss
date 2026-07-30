import { translate } from '@/i18n/i18n'
import { isRequiredPtyReattachUnavailableMessage } from '../../../../shared/pty-reattach-unavailable'

/**
 * Actionable text for a pane whose surviving agent process can no longer be
 * reattached — the app update crossed a daemon protocol boundary and the old
 * daemon is gone. Without it the pane just restores blank (ORCA-124).
 */
export function getPtyReattachUnavailableNotice(message: string): string | null {
  if (!isRequiredPtyReattachUnavailableMessage(message)) {
    return null
  }
  return translate(
    'auto.components.terminal.pane.pty.reattachUnavailable',
    'This session requires relaunching the agent: its process could not be reattached after the update. Committed work and transcripts are safe — start the agent again to resume.'
  )
}
