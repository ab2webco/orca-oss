import React from 'react'
import { Check } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { NewTabAccountRow } from '../../../../shared/new-tab-account-choice'
import { newTabAccountRowTextOf } from './new-tab-account-row-text'

export type NewTabAgentAccountSubmenuProps = {
  agentLabel: string
  /** The account the row launches on today; shown beside the agent. */
  triggerLabel: string
  rows: readonly NewTabAccountRow[]
  checkedId: string | null
  labelOf: (row: NewTabAccountRow) => string
  onPick: (accountId: string) => void
}

/** The account beside an agent row; opening it lists the provider's managed accounts (ORCA-717). */
export function NewTabAgentAccountSubmenu({
  agentLabel,
  triggerLabel,
  rows,
  checkedId,
  labelOf,
  onPick
}: NewTabAgentAccountSubmenuProps): React.JSX.Element {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        aria-label={translate('newTabMenu.account.choose', 'Choose the {{value}} account', {
          value: agentLabel
        })}
        className="min-w-0 max-w-[55%] gap-1 px-1.5 font-normal text-muted-foreground"
      >
        <span className="truncate">{triggerLabel}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        {rows.map((row) => {
          const text = newTabAccountRowTextOf(row)
          return (
            <DropdownMenuItem
              key={row.id}
              disabled={row.disabled !== null}
              onSelect={() => onPick(row.id)}
              className="items-start gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5"
            >
              <Check
                aria-hidden
                className={cn('mt-0.5 size-3.5 shrink-0', row.id !== checkedId && 'invisible')}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{labelOf(row)}</span>
                <span className="flex gap-2 whitespace-nowrap text-[11px] text-muted-foreground">
                  <span>{text.detail}</span>
                  {text.tag ? <span className="truncate">{text.tag}</span> : null}
                </span>
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
