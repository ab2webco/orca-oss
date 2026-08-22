import { useState, type MutableRefObject } from 'react'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import type { PluginSettingsFormState } from './PluginSettingsForm'

type PluginSettingsEditor = {
  openSettings: ReadonlySet<string>
  formStateByPlugin: Readonly<Record<string, PluginSettingsFormState>>
  toggleSettings: (pluginKey: string) => void
  saveSetting: (pluginKey: string, key: string, value: string | number | boolean) => void
}

function withoutUninstalled<T>(
  current: Readonly<Record<string, T>>,
  installedKeys: ReadonlySet<string>
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(current).filter(([pluginKey]) => installedKeys.has(pluginKey))
  )
}

export function usePluginSettingsEditor(
  mounted: boolean,
  mountedRef: MutableRefObject<boolean>,
  plugins: readonly PluginHostListEntry[],
  applyCompletedMutation: (nextPlugins: PluginHostListEntry[]) => void
): PluginSettingsEditor {
  const [openSettings, setOpenSettings] = useState<Set<string>>(() => new Set())
  const [savingByPlugin, setSavingByPlugin] = useState<Record<string, Set<string>>>({})
  const [errorsByPlugin, setErrorsByPlugin] = useState<Record<string, Record<string, string>>>({})

  // Why: adjusting this during render (not in an effect) discards the stale commit outright
  // instead of painting the previous pane's state for one frame before an effect corrects it.
  const [prevMounted, setPrevMounted] = useState(mounted)
  const [prevPlugins, setPrevPlugins] = useState(plugins)
  if (mounted !== prevMounted || plugins !== prevPlugins) {
    setPrevMounted(mounted)
    setPrevPlugins(plugins)
    if (!mounted) {
      setOpenSettings(new Set())
      setSavingByPlugin({})
      setErrorsByPlugin({})
    } else {
      const installedKeys = new Set(plugins.map((plugin) => plugin.pluginKey))
      setOpenSettings(
        (current) => new Set([...current].filter((pluginKey) => installedKeys.has(pluginKey)))
      )
      setSavingByPlugin((current) => withoutUninstalled(current, installedKeys))
      setErrorsByPlugin((current) => withoutUninstalled(current, installedKeys))
    }
  }

  const markSaving = (pluginKey: string, key: string, saving: boolean): void => {
    setSavingByPlugin((current) => {
      const next = new Set(current[pluginKey] ?? [])
      if (saving) {
        next.add(key)
      } else {
        next.delete(key)
      }
      return { ...current, [pluginKey]: next }
    })
  }

  const setSaveError = (pluginKey: string, key: string, message: string | null): void => {
    setErrorsByPlugin((current) => {
      const forPlugin = { ...current[pluginKey] }
      if (message === null) {
        delete forPlugin[key]
      } else {
        forPlugin[key] = message
      }
      return { ...current, [pluginKey]: forPlugin }
    })
  }

  const saveSetting = (pluginKey: string, key: string, value: string | number | boolean): void => {
    markSaving(pluginKey, key, true)
    setSaveError(pluginKey, key, null)
    void window.api.plugins
      .setSetting({ pluginKey, key, value })
      .then((nextPlugins: PluginHostListEntry[]) => {
        // Why: the returned list is authoritative — adopting it is what proves
        // the write landed, instead of trusting the call not to have thrown.
        applyCompletedMutation(nextPlugins)
      })
      .catch((cause: unknown) => {
        console.warn('[plugins] setting write failed:', cause)
        if (mountedRef.current) {
          setSaveError(
            pluginKey,
            key,
            translate(
              'auto.components.settings.PluginsSettingsSection.settingSaveFailed',
              'Could not save this setting.'
            )
          )
        }
      })
      .finally(() => {
        if (mountedRef.current) {
          markSaving(pluginKey, key, false)
        }
      })
  }

  const toggleSettings = (pluginKey: string): void => {
    setOpenSettings((current) => {
      const next = new Set(current)
      if (!next.delete(pluginKey)) {
        next.add(pluginKey)
      }
      return next
    })
  }

  const formStateByPlugin: Record<string, PluginSettingsFormState> = Object.fromEntries(
    plugins.map((plugin) => [
      plugin.pluginKey,
      {
        savingKeys: savingByPlugin[plugin.pluginKey] ?? new Set<string>(),
        errorsByKey: errorsByPlugin[plugin.pluginKey] ?? {}
      }
    ])
  )

  return { openSettings, formStateByPlugin, toggleSettings, saveSetting }
}
