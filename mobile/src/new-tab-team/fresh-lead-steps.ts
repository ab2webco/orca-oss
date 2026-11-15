import { Crown, User, X } from 'lucide-react-native'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import type { AddMemberAccount, AddMemberAccounts } from './add-member-options'

/** id null is the agent's own login: the session starts with no claudeAccountId. */
export type FreshLeadAccountChoice = { id: string | null; email: string | null }

export type FreshLeadAccountsRead =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; value: AddMemberAccounts }

const noop = (): void => {}

const usageOf = (account: AddMemberAccount): string[] => [
  ...(account.usedPercent !== null ? [`5 h ${account.usedPercent}%`] : []),
  ...(account.weeklyPercent !== null ? [`7 d ${account.weeklyPercent}%`] : [])
]

/** The account step: the lead desktop's Claude accounts, then System default (p06). */
export function freshLeadAccountActionsOf(
  read: FreshLeadAccountsRead,
  hostName: string,
  onPick: (choice: FreshLeadAccountChoice) => void
): ActionSheetAction[] {
  const accounts: ActionSheetAction[] =
    read.status === 'loading'
      ? [{ label: 'Reading accounts…', icon: User, disabled: true, loading: true, onPress: noop }]
      : read.status === 'ready'
        ? read.value.accounts.map((account) => ({
            label: account.email,
            hint: [hostName, ...usageOf(account)].join(' · '),
            icon: User,
            closeBeforePress: true,
            onPress: () => onPick({ id: account.id, email: account.email })
          }))
        : []
  return [
    ...accounts,
    {
      label: 'System default',
      hint: "Use the agent's own login",
      icon: User,
      closeBeforePress: true,
      onPress: () => onPick({ id: null, email: null })
    }
  ]
}

/** The confirm step: starting fresh retires the kept lead, so it asks first (desktop's confirm). */
export function freshLeadConfirmOf(
  choice: FreshLeadAccountChoice,
  hostName: string,
  onStart: () => void,
  onCancel: () => void
): { title: string; actions: ActionSheetAction[] } {
  const account = choice.email ?? "the agent's own login"
  return {
    title: 'Start a fresh lead?',
    actions: [
      {
        label: 'Start',
        hint: `Lead on ${account} · ${hostName}`,
        icon: Crown,
        closeBeforePress: true,
        onPress: onStart
      },
      { label: 'Cancel', icon: X, onPress: onCancel }
    ]
  }
}
