import type { PluginHostListEntry } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'

/** Single source of the badge a plugin card shows; the order below is the
 *  precedence the user must read it in — a killed plugin is never merely
 *  "disabled", and an unconfigured one is never merely "running". */
export function pluginStatusPresentation(plugin: PluginHostListEntry): {
  label: string
  className: string
} {
  if (plugin.blockedByKillList) {
    return {
      label: translate('auto.components.settings.PluginSettingsRow.blocked', 'Blocked'),
      className: 'border-destructive/25 bg-destructive/8 text-destructive'
    }
  }
  if (plugin.needsReconsent || plugin.status === 'pending') {
    return {
      label: translate('auto.components.settings.PluginSettingsRow.needsReview', 'Needs review'),
      className: 'border-foreground/20 bg-foreground/8 text-foreground'
    }
  }
  if (plugin.needsSetup) {
    return {
      label: translate('auto.components.settings.PluginSettingsRow.needsSetup', 'Needs setup'),
      className: 'border-foreground/20 bg-foreground/8 text-foreground'
    }
  }
  if (plugin.status === 'restarting') {
    return {
      label: translate('auto.components.settings.PluginSettingsRow.restarting', 'Restarting'),
      className: 'border-foreground/20 bg-foreground/8 text-foreground'
    }
  }
  if (plugin.status === 'errored' || plugin.status === 'invalid') {
    return {
      label:
        plugin.status === 'invalid'
          ? translate('auto.components.settings.PluginSettingsRow.invalid', 'Invalid')
          : translate('auto.components.settings.PluginSettingsRow.error', 'Error'),
      className: 'border-destructive/25 bg-destructive/8 text-destructive'
    }
  }
  if (plugin.status === 'disabled') {
    return {
      label: translate('auto.components.settings.PluginSettingsRow.disabled', 'Disabled'),
      className: 'border-border bg-muted/40 text-muted-foreground'
    }
  }
  return {
    label:
      plugin.status === 'running'
        ? translate('auto.components.settings.PluginSettingsRow.running', 'Running')
        : translate('auto.components.settings.PluginSettingsRow.enabled', 'Enabled'),
    className: 'border-status-success-border bg-status-success-background text-status-success'
  }
}
