import { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
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
  const panels = useEnabledPluginNavPanels()
  const panel = panels.find((entry) => entry.tabKey === tabKey) ?? null
  const Icon = panel ? resolvePluginPanelIcon(panel) : null

  // Why: keyboard events fired inside the panel's sandboxed iframe never
  // bubble to this window (separate document/frame boundary), so this only
  // ever sees Escape from the host chrome itself, never from panel content.
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <Button
          variant="outline"
          size="sm"
          onClick={closePluginNavPage}
          className="shrink-0 gap-1.5"
        >
          <ArrowLeft className="size-3.5" />
          {translate('auto.components.plugins.PluginNavPage.back', 'Back')}
        </Button>
        {panel && Icon ? (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/30">
              <Icon className="size-4 text-muted-foreground" />
            </div>
            <h1 className="min-w-0 truncate text-base font-semibold text-foreground">
              {panel.title}
            </h1>
          </div>
        ) : null}
      </div>
      <PluginPanel key={tabKey} tabKey={tabKey} />
    </div>
  )
}
