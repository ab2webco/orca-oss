import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { resolvePluginPanelIcon } from '../right-sidebar/plugin-panel-icon'
import PluginPanel from '../right-sidebar/PluginPanel'
import { useEnabledPluginNavPanels } from './plugin-surface-pages'

function isEditableElement(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/** Full-page surface for a panel contributed with `surface: 'nav'`. The box is
 *  explicit because `PluginPanel` only fills the height it is handed. */
export default function PluginNavPage(): React.JSX.Element | null {
  const tabKey = useAppStore((s) => s.activePluginNavTabKey)
  const closePluginNavPage = useAppStore((s) => s.closePluginNavPage)
  const panel = useEnabledPluginNavPanels().find((entry) => entry.tabKey === tabKey) ?? null
  const Icon = panel ? resolvePluginPanelIcon(panel) : null

  // Why: keys pressed inside the sandboxed frame never reach this window; the
  // panel handles its own Escape and can call `panel.close`.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      const target = event.target
      if (isEditableElement(target)) {
        event.preventDefault()
        target.blur()
        return
      }
      event.preventDefault()
      closePluginNavPage()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePluginNavPage])

  if (!tabKey) {
    return null
  }
  const closeLabel = panel
    ? translate('auto.components.plugins.PluginNavPage.closePanel', 'Close {{title}}', {
        title: panel.title
      })
    : translate('auto.components.plugins.PluginNavPage.close', 'Close')

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-5 pb-3 pt-1.5 md:px-8">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 rounded-full"
              onClick={closePluginNavPage}
              aria-label={closeLabel}
            >
              <X className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.components.plugins.PluginNavPage.closeTooltip', 'Close · Esc')}
          </TooltipContent>
        </Tooltip>
        {panel && Icon ? (
          <>
            <div className="mx-1 h-5 w-px bg-border/50" aria-hidden />
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <h1 className="min-w-0 truncate text-sm font-semibold">{panel.title}</h1>
          </>
        ) : null}
      </header>
      <PluginPanel key={tabKey} tabKey={tabKey} onCloseRequested={closePluginNavPage} />
    </div>
  )
}
