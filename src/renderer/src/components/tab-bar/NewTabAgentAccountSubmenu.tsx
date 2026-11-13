import React from 'react'
import { Check } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { NewTabAccountRow } from '../../../../shared/new-tab-account-choice'
import { newTabAccountRowTextOf } from './new-tab-account-row-text'
import { keepSubmenuOpenOnParentMenuFocus } from './new-tab-submenu-fit'
import { useSubmenuOffsetsInWindow } from './use-submenu-offsets-in-window'

// Why: the list's widest, max-w 22rem; reserving it keeps any narrower list inside the window too.
const ACCOUNT_LIST_MAX_WIDTH_PX = 352

export type NewTabAgentAccountSubmenuProps = {
  provider: 'claude' | 'codex'
  ariaLabel: string
  /** The account the row launches on today; shown beside the agent. */
  triggerLabel: string
  rows: readonly NewTabAccountRow[]
  checkedId: string | null
  labelOf: (row: NewTabAccountRow) => string
  onPick: (accountId: string) => void
  /** A team row only sets the account; its own item does the launch. */
  keepOpen?: boolean
}

/** The account beside an agent row; opening it lists the provider's managed accounts (ORCA-717). */
export function NewTabAgentAccountSubmenu({
  provider,
  ariaLabel,
  triggerLabel,
  rows,
  checkedId,
  labelOf,
  onPick,
  keepOpen = false
}: NewTabAgentAccountSubmenuProps): React.JSX.Element {
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const listFit = useSubmenuOffsetsInWindow(ACCOUNT_LIST_MAX_WIDTH_PX, 6)
  // Why: beside a row the whole email was cut to 'name@ko…'; its name part fits, the list shows it whole.
  const at = triggerLabel.indexOf('@')
  const shortLabel = at > 0 ? triggerLabel.slice(0, at) : triggerLabel
  return (
    <DropdownMenuSub onOpenChange={listFit.onOpenChange}>
      <DropdownMenuSubTrigger
        ref={listFit.triggerRef}
        aria-label={ariaLabel}
        title={triggerLabel}
        className="min-w-0 max-w-[55%] gap-1 px-1.5 font-normal text-muted-foreground"
      >
        <span className="truncate">{shortLabel}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        {...listFit.offsets}
        onFocusOutside={keepSubmenuOpenOnParentMenuFocus}
        className="w-max min-w-64 max-w-[min(22rem,calc(100vw-16px))]"
      >
        <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">
          {provider === 'claude'
            ? translate('newTabMenu.account.claudeAccounts', 'Claude accounts')
            : translate('newTabMenu.account.codexAccounts', 'Codex accounts')}
        </DropdownMenuLabel>
        {rows.map((row) => {
          const text = newTabAccountRowTextOf(row)
          return (
            <DropdownMenuItem
              key={row.id}
              disabled={row.disabled !== null}
              onSelect={(event) => {
                if (keepOpen) {
                  event.preventDefault()
                }
                onPick(row.id)
              }}
              className="items-start gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5"
            >
              <Check
                aria-hidden
                className={cn('mt-0.5 size-3.5 shrink-0', row.id !== checkedId && 'invisible')}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="break-all font-medium">{labelOf(row)}</span>
                <span className="flex gap-2 whitespace-nowrap text-[11px] text-muted-foreground">
                  <span>{text.detail}</span>
                  {text.tag ? <span className="truncate">{text.tag}</span> : null}
                </span>
              </span>
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="rounded-[7px] px-2 py-1.5 text-[12px] leading-5"
          onSelect={() => {
            openSettingsTarget({
              pane: 'accounts',
              repoId: null,
              sectionId: `accounts-${provider}`
            })
            openSettingsPage()
          }}
        >
          {translate('newTabMenu.account.manage', 'Manage accounts…')}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
