import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { StatusColorTheme } from '../../../../shared/status-colors'
import { STATUS_TONES, type StatusTone } from '@/components/status-tone'
import { Button } from '../ui/button'
import { SettingsSegmentedControl } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'
import {
  STATUS_COLOR_BACKGROUND,
  STATUS_COLOR_DEFAULTS,
  applyStatusColorOverrides,
  statusColorWarning
} from '@/lib/status-color-overrides'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

// Why: a colour picker fires on every drag step; paint live, persist once it settles.
const PERSIST_DELAY_MS = 250

function toneCopy(tone: StatusTone): { name: string; meaning: string } {
  switch (tone) {
    case 'attention':
      return {
        name: translate('settings.appearance.statusColors.attention.name', 'Needs you'),
        meaning: translate(
          'settings.appearance.statusColors.attention.meaning',
          'Needs you, or something failed.'
        )
      }
    case 'warning':
      return {
        name: translate('settings.appearance.statusColors.warning.name', 'At risk'),
        meaning: translate(
          'settings.appearance.statusColors.warning.meaning',
          'Does not need you yet.'
        )
      }
    case 'info':
      return {
        name: translate('settings.appearance.statusColors.info.name', 'Working'),
        meaning: translate(
          'settings.appearance.statusColors.info.meaning',
          'An agent is on it now.'
        )
      }
    case 'success':
      return {
        name: translate('settings.appearance.statusColors.success.name', 'Verified'),
        meaning: translate('settings.appearance.statusColors.success.meaning', 'Done and checked.')
      }
    case 'idle':
      return {
        name: translate('settings.appearance.statusColors.idle.name', 'Idle'),
        meaning: translate(
          'settings.appearance.statusColors.idle.meaning',
          'No activity, or no data.'
        )
      }
  }
}

function currentTheme(): StatusColorTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function StatusColorsSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const [theme, setTheme] = useState<StatusColorTheme>(currentTheme)
  const [draft, setDraft] = useState(settings.statusColors ?? {})
  const persistTimer = useRef<number | null>(null)

  useEffect(() => {
    setDraft(settings.statusColors ?? {})
  }, [settings.statusColors])

  useEffect(
    () => () => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current)
      }
    },
    []
  )

  const commit = (next: GlobalSettings['statusColors'], immediate: boolean): void => {
    setDraft(next ?? {})
    applyStatusColorOverrides(next)
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current)
    }
    if (immediate) {
      updateSettings({ statusColors: next })
      return
    }
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null
      updateSettings({ statusColors: next })
    }, PERSIST_DELAY_MS)
  }

  const palette = { ...STATUS_COLOR_DEFAULTS[theme], ...draft[theme] }
  const edited = Object.keys(draft[theme] ?? {}).length > 0

  return (
    <div className="space-y-1 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <p className="text-sm font-medium">
            {translate('settings.appearance.statusColors.title', 'Status colors')}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate(
              'settings.appearance.statusColors.description',
              'Each color keeps its meaning in every project. Light and dark have their own.'
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SettingsSegmentedControl
            ariaLabel={translate('settings.appearance.statusColors.themeLabel', 'Theme to edit')}
            value={theme}
            onChange={setTheme}
            size="sm"
            options={[
              {
                value: 'light',
                label: translate('settings.appearance.statusColors.themeLight', 'Light')
              },
              {
                value: 'dark',
                label: translate('settings.appearance.statusColors.themeDark', 'Dark')
              }
            ]}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!edited}
            aria-label={translate(
              'settings.appearance.statusColors.resetLabel',
              'Reset status colors'
            )}
            onClick={() => {
              const { [theme]: _reset, ...rest } = draft
              commit(rest, true)
            }}
          >
            {translate('settings.appearance.statusColors.reset', 'Reset')}
          </Button>
        </div>
      </div>
      <ul className="divide-y divide-border/40">
        {STATUS_TONES.map((tone) => {
          const { name, meaning } = toneCopy(tone)
          const warning = statusColorWarning(tone, palette, STATUS_COLOR_BACKGROUND[theme])
          return (
            <li key={tone} className="flex min-h-11 items-center gap-3 py-1.5">
              <input
                type="color"
                value={palette[tone]}
                aria-label={translate(
                  'settings.appearance.statusColors.pickerLabel',
                  '{{value0}} color',
                  { value0: name }
                )}
                onChange={(event) =>
                  commit(
                    { ...draft, [theme]: { ...draft[theme], [tone]: event.target.value } },
                    false
                  )
                }
                className="size-7 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{name}</span>
                <span className="block text-xs text-muted-foreground">{meaning}</span>
                {/* Why: a line of its own, so Spanish copy still fits at 320px. */}
                {warning ? (
                  <span role="status" className="block text-xs text-status-warning">
                    {warning.kind === 'close'
                      ? translate(
                          'settings.appearance.statusColors.tooClose',
                          'Too close to {{value0}}',
                          {
                            value0: toneCopy(warning.other).name
                          }
                        )
                      : translate('settings.appearance.statusColors.lowContrast', 'Low contrast')}
                  </span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
