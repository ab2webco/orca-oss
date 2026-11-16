import React from 'react'
import { ArrowUpDown, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { PROJECT_ORDER_MENU_OPTIONS, isProjectOrderOffDefault } from './project-order-menu-options'

type SidebarProjectOrderMenuProps = {
  onMenuOpenChange: (open: boolean) => void
}

/** ORCA-1216 §5: the Projects header's sort button; it owns `projectOrderBy`. */
const SidebarProjectOrderMenu = React.memo(function SidebarProjectOrderMenu({
  onMenuOpenChange
}: SidebarProjectOrderMenuProps) {
  useTranslation()
  const projectOrderBy = useAppStore((s) => s.projectOrderBy)
  const setProjectOrderBy = useAppStore((s) => s.setProjectOrderBy)
  const title = translate('auto.components.sidebar.SidebarProjectOrderMenu.title', 'Order projects')
  const defaultTag = translate(
    'auto.components.sidebar.SidebarProjectOrderMenu.defaultTag',
    'default'
  )

  return (
    <DropdownMenu modal={false} onOpenChange={onMenuOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              className="relative text-muted-foreground"
              aria-label={title}
              data-project-order-trigger={projectOrderBy}
              data-workspace-board-preserve-open=""
            >
              <ArrowUpDown className="size-3.5" strokeWidth={2.25} />
              {isProjectOrderOffDefault(projectOrderBy) && (
                <span
                  aria-hidden
                  data-project-order-dot=""
                  className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
                />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {title}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="w-72"
        data-project-order-menu=""
        data-workspace-board-preserve-open=""
      >
        <DropdownMenuLabel className="uppercase tracking-wide">{title}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={projectOrderBy}
          onValueChange={(value) => {
            const option = PROJECT_ORDER_MENU_OPTIONS.find((candidate) => candidate.id === value)
            if (option) {
              setProjectOrderBy(option.id)
            }
          }}
        >
          {PROJECT_ORDER_MENU_OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <DropdownMenuRadioItem
                key={option.id}
                value={option.id}
                data-project-order-option={option.id}
                indicator={<Check className="size-3.5" />}
                className="data-[state=checked]:bg-black/8 dark:data-[state=checked]:bg-white/10"
              >
                {option.id !== projectOrderBy && (
                  <Icon
                    aria-hidden
                    className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {!isProjectOrderOffDefault(option.id) && (
                  <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground">
                    {defaultTag}
                  </span>
                )}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p
          data-project-order-footer=""
          className="px-2 pt-0.5 pb-1 text-[11px] leading-4 text-muted-foreground"
        >
          {translate(
            'auto.components.sidebar.SidebarProjectOrderMenu.footer',
            'Saved for your user. Idle stays by age.'
          )}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

export default SidebarProjectOrderMenu
