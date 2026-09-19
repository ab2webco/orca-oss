import { useCallback } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { PluginPanelApproval } from '@/store/plugin-panels'
import { Button } from '../ui/button'

type PluginPendingApprovalNoticeProps = {
  pluginName: string
  approval: Exclude<PluginPanelApproval, 'approved'>
}

/** Shown over the panel surface of a plugin the host refuses to activate.
 *  Serving the real panel here would impersonate a working plugin: it accepts
 *  input and writes storage while no worker ever answers. */
export function PluginPendingApprovalNotice({
  pluginName,
  approval
}: PluginPendingApprovalNoticeProps): React.JSX.Element {
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const openPluginSettings = useCallback((): void => {
    openSettingsTarget({ pane: 'plugins', repoId: null })
    openSettingsPage()
  }, [openSettingsPage, openSettingsTarget])

  const title =
    approval === 'pending-update'
      ? translate(
          'auto.components.plugins.PluginPendingApprovalNotice.updateTitle',
          '{{value0}} was updated and needs your approval again',
          { value0: pluginName }
        )
      : translate(
          'auto.components.plugins.PluginPendingApprovalNotice.installTitle',
          '{{value0}} is waiting for your approval',
          { value0: pluginName }
        )
  const description =
    approval === 'pending-update'
      ? translate(
          'auto.components.plugins.PluginPendingApprovalNotice.updateDescription',
          'The new version changed what the plugin declares, so it stays off until you review it. Nothing here runs in the meantime.'
        )
      : translate(
          'auto.components.plugins.PluginPendingApprovalNotice.installDescription',
          'Review what this plugin is allowed to do before it runs for the first time. Nothing here runs in the meantime.'
        )

  return (
    <div
      role="status"
      data-testid="plugin-pending-approval"
      className="flex min-h-[220px] w-full min-w-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center"
    >
      <ShieldAlert className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-sm text-balance text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-balance text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      <Button size="sm" onClick={openPluginSettings}>
        {translate(
          'auto.components.plugins.PluginPendingApprovalNotice.reviewAndEnable',
          'Review & enable'
        )}
      </Button>
    </div>
  )
}
