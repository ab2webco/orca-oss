import { useCallback, useState } from 'react'
import { triggerError, triggerSuccess } from '../platform/haptics'
import type { RpcClient } from '../transport/rpc-client'
import type { AddMemberRoster } from './add-member-options'
import { createAddMemberSender, type AddMemberChoice } from './add-member-send'

const sendAddMember = createAddMemberSender(Date.now)

type Target = { roster: AddMemberRoster; terminal: string }

/** The Add member sheet's state: opened from the Team group, it sends the lead one ticket. */
export function useAddMember(args: {
  client: RpcClient | null
  showToast: (message: string, durationMs?: number) => void
}) {
  const { client, showToast } = args
  const [target, setTarget] = useState<Target | null>(null)
  const [open, setOpen] = useState(false)
  const start = useCallback((roster: AddMemberRoster, terminal: string) => {
    setTarget({ roster, terminal })
    setOpen(true)
  }, [])

  const onSend = useCallback(
    (choice: AddMemberChoice) => {
      if (!client || !target) {
        return
      }
      const label = choice.ticket.identifier
      void sendAddMember(client, { ...choice, terminal: target.terminal }).then((outcome) => {
        if (outcome === 'sent') {
          triggerSuccess()
          showToast(`Sent to the lead: ${label}`)
          setOpen(false)
        } else if (outcome === 'failed') {
          triggerError()
          showToast(`Could not send ${label}`, 2400)
        }
      })
    },
    [client, showToast, target]
  )

  return {
    start,
    sheet: target
      ? { visible: open, roster: target.roster, onSend, onClose: () => setOpen(false) }
      : null
  }
}
