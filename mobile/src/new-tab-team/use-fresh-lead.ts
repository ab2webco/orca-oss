import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import { decodeAccountsSnapshot } from '../components/accounts-snapshot'
import { triggerError, triggerSuccess } from '../platform/haptics'
import { sessionTabForHostOpen, type HostTerminalOpenRequest } from '../session/host-terminal-open'
import type { MobileSessionTab } from '../session/mobile-session-route-types'
import type { RpcClient } from '../transport/rpc-client'
import { addMemberAccountsOf } from './add-member-options'
import { freshLeadOperationIdOf, startFreshLeadFromPhone } from './fresh-lead-start'
import {
  freshLeadAccountActionsOf,
  freshLeadConfirmOf,
  type FreshLeadAccountChoice,
  type FreshLeadAccountsRead
} from './fresh-lead-steps'

type Sheet = { visible: boolean; title: string; actions: ActionSheetAction[]; onClose: () => void }

/** Start fresh lead from the + sheet: account step, confirm, then the lead's tab (p06). */
export function useFreshLead(args: {
  client: RpcClient | null
  hostName: string
  worktreeId: string
  showToast: (message: string, durationMs?: number) => void
  sessionTabs: readonly MobileSessionTab[]
  selectTab: (tab: MobileSessionTab) => void
}): { start: () => void; account: Sheet; confirm: Sheet } {
  const { client, hostName, worktreeId, showToast, sessionTabs, selectTab } = args
  const [accountOpen, setAccountOpen] = useState(false)
  const [accounts, setAccounts] = useState<FreshLeadAccountsRead>({ status: 'loading' })
  const [choice, setChoice] = useState<FreshLeadAccountChoice | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const openingRef = useRef<HostTerminalOpenRequest | null>(null)
  const tabsRef = useRef({ sessionTabs, selectTab })

  useEffect(() => {
    if (!accountOpen || !client) {
      return
    }
    let stale = false
    setAccounts({ status: 'loading' })
    void client
      .sendRequest('accounts.list')
      .then((response) => {
        if (stale) {
          return
        }
        setAccounts(
          response.ok
            ? {
                status: 'ready',
                value: addMemberAccountsOf(
                  decodeAccountsSnapshot(response.result),
                  'claude',
                  Date.now()
                )
              }
            : { status: 'failed' }
        )
      })
      .catch(() => {
        if (!stale) {
          setAccounts({ status: 'failed' })
        }
      })
    return () => {
      stale = true
    }
  }, [accountOpen, client])

  // Why: the new tab usually reaches the phone in a later tabs snapshot, not in the create answer.
  const selectOpening = useCallback(() => {
    const opening = openingRef.current
    const { sessionTabs: tabs, selectTab: select } = tabsRef.current
    const tab = opening
      ? sessionTabForHostOpen(tabs, { terminal: opening.terminal, tabId: opening.tabId })
      : null
    if (tab) {
      openingRef.current = null
      select(tab)
    }
  }, [])

  useEffect(() => {
    tabsRef.current = { sessionTabs, selectTab }
    selectOpening()
  }, [selectOpening, selectTab, sessionTabs])

  const onPick = useCallback((picked: FreshLeadAccountChoice) => {
    setChoice(picked)
    setConfirmOpen(true)
  }, [])

  const onStart = useCallback(() => {
    if (!client || !choice) {
      return
    }
    const operationId = freshLeadOperationIdOf(Date.now(), Math.random)
    void startFreshLeadFromPhone(client, { worktreeId, accountId: choice.id, operationId }).then(
      (outcome) => {
        if (outcome.kind === 'failed') {
          triggerError()
          showToast(`Could not start the lead: ${outcome.reason}`, 2400)
          return
        }
        triggerSuccess()
        if (outcome.lead?.worktreeId === worktreeId) {
          openingRef.current = outcome.lead
          selectOpening()
        }
      }
    )
  }, [choice, client, selectOpening, showToast, worktreeId])

  const confirm = choice
    ? freshLeadConfirmOf(choice, hostName, onStart, () => setConfirmOpen(false))
    : { title: '', actions: [] }

  return {
    start: () => setAccountOpen(true),
    account: {
      visible: accountOpen,
      title: "Choose the lead's account",
      actions: freshLeadAccountActionsOf(accounts, hostName, onPick),
      onClose: () => setAccountOpen(false)
    },
    confirm: { visible: confirmOpen, ...confirm, onClose: () => setConfirmOpen(false) }
  }
}
