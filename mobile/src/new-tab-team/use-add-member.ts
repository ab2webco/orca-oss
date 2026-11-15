import { useCallback, useEffect, useState } from 'react'
import { decodeAccountsSnapshot } from '../components/accounts-snapshot'
import { triggerError, triggerSuccess } from '../platform/haptics'
import type { RpcClient } from '../transport/rpc-client'
import {
  addMemberAccountsOf,
  type AddMemberAccounts,
  type AddMemberRoster
} from './add-member-options'
import { createAddMemberSender, type AddMemberChoice } from './add-member-send'

const sendAddMember = createAddMemberSender(Date.now)

type Target = { roster: AddMemberRoster; terminal: string }

/** The Add member sheet's state: opened from the Team group, it reads accounts and sends the lead one ticket. */
export function useAddMember(args: {
  client: RpcClient | null
  showToast: (message: string, durationMs?: number) => void
}) {
  const { client, showToast } = args
  const [target, setTarget] = useState<Target | null>(null)
  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState<AddMemberAccounts | null>(null)
  const provider = target?.roster.provider ?? null

  useEffect(() => {
    setAccounts(null)
    if (!open || !client || !provider) {
      return
    }
    let stale = false
    void client
      .sendRequest('accounts.list')
      .then((response) => {
        if (!stale && response.ok) {
          setAccounts(
            addMemberAccountsOf(decodeAccountsSnapshot(response.result), provider, Date.now())
          )
        }
      })
      // Why ignored: without accounts the sheet leaves the pick to the lead's host.
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [client, open, provider])

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
      ? { visible: open, roster: target.roster, accounts, onSend, onClose: () => setOpen(false) }
      : null
  }
}
