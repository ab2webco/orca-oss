import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { PluginHostListEntry } from '../../../../preload/api-types'
import { translate } from '@/i18n/i18n'
import { Input } from '../ui/input'
import { SettingsRow, SettingsSwitch } from './SettingsFormControls'

type PluginSetting = NonNullable<PluginHostListEntry['settings']>[number]

export type PluginSettingsFormState = {
  savingKeys: ReadonlySet<string>
  errorsByKey: Readonly<Record<string, string>>
}

type PluginSettingsFormProps = {
  pluginKey: string
  settings: readonly PluginSetting[]
  state?: PluginSettingsFormState
  onSave: (pluginKey: string, key: string, value: string | number | boolean) => void
}

function settingDescription(setting: PluginSetting): string | undefined {
  if (setting.description) {
    return setting.description
  }
  return setting.required && !setting.configured
    ? translate('auto.components.settings.PluginSettingsForm.requiredHint', 'Required to run.')
    : undefined
}

/**
 * Text/number fields persist on blur or Enter rather than per keystroke: a
 * secret written per keystroke would leave partial tokens in the vault, and not
 * echoing the store mid-edit keeps IME composition intact.
 */
function PluginSettingDraftInput({
  setting,
  disabled,
  onCommit
}: {
  setting: PluginSetting
  disabled: boolean
  onCommit: (raw: string) => void
}): React.JSX.Element {
  const incoming = setting.value === undefined ? '' : String(setting.value)
  const [draft, setDraft] = useState(incoming)
  const lastIncomingRef = useRef(incoming)

  useEffect(() => {
    if (lastIncomingRef.current !== incoming) {
      lastIncomingRef.current = incoming
      setDraft(incoming)
    }
  }, [incoming])

  const commit = (): void => {
    if (draft !== lastIncomingRef.current) {
      onCommit(draft)
    }
  }

  return (
    <Input
      className="h-8 w-56 text-xs"
      type={setting.secret ? 'password' : setting.type === 'number' ? 'number' : 'text'}
      value={draft}
      disabled={disabled}
      aria-label={setting.label}
      data-setting-key={setting.key}
      placeholder={
        setting.secret && setting.configured
          ? translate(
              'auto.components.settings.PluginSettingsForm.secretStored',
              'Stored — type to replace'
            )
          : setting.placeholder
      }
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      }}
    />
  )
}

export function PluginSettingsForm({
  pluginKey,
  settings,
  state,
  onSave
}: PluginSettingsFormProps): React.JSX.Element {
  return (
    <div
      className="mt-3 overflow-hidden rounded-md border border-border bg-muted/40 px-3"
      data-plugin-settings-form={pluginKey}
    >
      {settings.map((setting) => {
        const saving = state?.savingKeys.has(setting.key) === true
        const error = state?.errorsByKey[setting.key]
        return (
          <SettingsRow
            key={setting.key}
            label={
              <span className="flex items-center gap-1.5">
                {setting.label}
                {saving ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
              </span>
            }
            description={
              error ? (
                <span className="flex items-start gap-1.5 text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {error}
                </span>
              ) : (
                settingDescription(setting)
              )
            }
            control={
              setting.type === 'boolean' ? (
                <SettingsSwitch
                  checked={setting.value === true}
                  disabled={saving}
                  ariaLabel={setting.label}
                  onChange={() => onSave(pluginKey, setting.key, setting.value !== true)}
                />
              ) : (
                <PluginSettingDraftInput
                  setting={setting}
                  disabled={saving}
                  onCommit={(raw) => {
                    if (setting.type === 'number') {
                      const parsed = Number(raw)
                      if (raw.trim() === '' || !Number.isFinite(parsed)) {
                        return
                      }
                      onSave(pluginKey, setting.key, parsed)
                      return
                    }
                    onSave(pluginKey, setting.key, raw)
                  }}
                />
              )
            }
          />
        )
      })}
    </div>
  )
}
