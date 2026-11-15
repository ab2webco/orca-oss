import { ActionSheetModal } from '../components/ActionSheetModal'
import type { useFreshLead } from './use-fresh-lead'

type FreshLead = ReturnType<typeof useFreshLead>

/** Start fresh lead's two steps; each closes before the next opens, as iOS needs. */
export function FreshLeadSheets({ account, confirm }: Pick<FreshLead, 'account' | 'confirm'>) {
  return (
    <>
      <ActionSheetModal {...account} />
      <ActionSheetModal {...confirm} />
    </>
  )
}
