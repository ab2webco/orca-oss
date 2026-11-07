import { useMemo } from 'react'
import { toast } from 'sonner'
import { gameInboxTargetOf } from '@/components/game-inbox/game-owner-questions-client'
import { translate } from '@/i18n/i18n'
import { sendRuntimeAgentPrompt } from '@/runtime/runtime-terminal-inspection'
import { useAppStore } from '@/store'
import { createLeadPromptSender } from './team-lead-prompt-sender'
import { useTeamLeadHandle } from './use-team-panel-model'

export type SendToLead = (key: string, prompt: string, label: string) => void

const press = createLeadPromptSender(Date.now)

/** Sends the lead a turn, like the terminal band; null with no lead pane to write to. */
export function useTeamLeadPrompt(): SendToLead | null {
  const hostId = useAppStore((s) => s.activeWorkspaceExecutionHostId)
  const handle = useTeamLeadHandle()
  return useMemo(() => {
    if (!handle) {
      return null
    }
    const target = gameInboxTargetOf(hostId)
    return (key, prompt, label) => {
      void press(key, () => sendRuntimeAgentPrompt(target, handle, prompt)).then((outcome) => {
        if (outcome === 'sent') {
          toast.success(
            translate('teamPanel.leadWork.sent', 'Sent to the lead: {{label}}', { label })
          )
        } else if (outcome === 'failed') {
          toast.error(translate('teamPanel.leadWork.failed', 'Could not send {{label}}', { label }))
        }
      })
    }
  }, [handle, hostId])
}
