import { useMemo } from 'react'
import { toast } from 'sonner'
import { gameInboxTargetOf } from '@/components/game-inbox/game-owner-questions-client'
import { translate } from '@/i18n/i18n'
import { sendRuntimeAgentPrompt } from '@/runtime/runtime-terminal-inspection'
import { useAppStore } from '@/store'
import { createLeadPromptSender } from './team-lead-prompt-sender'
import { useTeamLeadHandle } from './use-team-panel-model'

/** Resolves true once the lead has the turn; `quiet` leaves the success to the caller's own UI. */
export type SendToLead = (
  key: string,
  prompt: string,
  label: string,
  options?: { quiet?: boolean }
) => Promise<boolean>

const press = createLeadPromptSender(Date.now)

/**
 * Sends the lead a turn, like the terminal band; null with no lead pane to write to.
 * `leadHandle`: a lead the caller found itself, ahead of the panel's last read (ORCA-717).
 */
export function useTeamLeadPrompt(leadHandle?: string | null): SendToLead | null {
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const panelHandle = useTeamLeadHandle()
  const handle = leadHandle ?? panelHandle
  return useMemo(() => {
    if (!handle) {
      return null
    }
    const target = gameInboxTargetOf(hostId)
    return (key, prompt, label, options) =>
      press(key, () => sendRuntimeAgentPrompt(target, handle, prompt)).then((outcome) => {
        if (outcome === 'sent' && !options?.quiet) {
          toast.success(
            translate('teamPanel.leadWork.sent', 'Sent to the lead: {{label}}', { label })
          )
        } else if (outcome === 'failed') {
          toast.error(translate('teamPanel.leadWork.failed', 'Could not send {{label}}', { label }))
        }
        return outcome === 'sent'
      })
  }, [handle, hostId])
}
