import React from 'react'
import { translate } from '@/i18n/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

// Why (ORCA-717): below 120 px the scroll chevrons hide; this count keeps the other tabs one click away.
export function TabStripHiddenTabsMenu({
  tabs,
  onSelect
}: {
  tabs: readonly { id: string; label: string }[]
  onSelect: (id: string) => void
}): React.JSX.Element | null {
  if (tabs.length === 0) {
    return null
  }
  const label = translate('tabStrip.hiddenTabs', '{{count}} more tabs', {
    count: tabs.length
  })
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hidden @max-[120px]/tab-bar:flex ml-1 my-auto h-6 shrink-0 items-center rounded-md px-1 text-xs tabular-nums text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          aria-label={label}
          title={label}
        >
          +{tabs.length}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="max-w-[calc(100vw-1rem)]">
        {tabs.map((tab) => (
          <DropdownMenuItem key={tab.id} onSelect={() => onSelect(tab.id)}>
            <span className="truncate">{tab.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
