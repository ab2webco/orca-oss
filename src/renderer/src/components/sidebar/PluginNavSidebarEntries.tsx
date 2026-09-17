import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { useEnabledPluginNavPanels } from '../plugins/plugin-surface-pages'
import { resolvePluginPanelIcon } from '../right-sidebar/plugin-panel-activity-items'

/** One first-level destination per `surface: 'nav'` panel of an enabled plugin. */
export function PluginNavSidebarEntries(): React.JSX.Element | null {
  const panels = useEnabledPluginNavPanels()
  const openPluginNavPage = useAppStore((s) => s.openPluginNavPage)
  const activeView = useAppStore((s) => s.activeView)
  const activeTabKey = useAppStore((s) => s.activePluginNavTabKey)
  if (panels.length === 0) {
    return null
  }
  return (
    <>
      {panels.map((panel) => {
        const active = activeView === 'plugin' && activeTabKey === panel.tabKey
        const Icon = resolvePluginPanelIcon(panel.icon)
        return (
          <button
            key={panel.tabKey}
            type="button"
            onClick={() => openPluginNavPage(panel.tabKey)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
              active
                ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
                : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
            )}
          >
            {/* Why: the curated icon type exposes size/className only, so no strokeWidth. */}
            <Icon
              className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')}
            />
            {/* Why: panel titles come from plugin manifests, not the app catalog. */}
            <span className="min-w-0 flex-1 truncate">{panel.title}</span>
          </button>
        )
      })}
    </>
  )
}
