import { useState } from 'react'
import type { OrchestratorGameConfig } from '../../../../shared/orchestrator-game-config'
import {
  isOrchestratorGameTimezone,
  type OrchestratorGameRender
} from '../../../../shared/orchestrator-game-render'
import { Input } from '../ui/input'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { orchestratorGameInheritLabel } from './orchestrator-game-setting-labels'
import { translate } from '@/i18n/i18n'

export const orchestratorGameRenderLabels = (): Record<OrchestratorGameRender, string> => ({
  classic: translate('auto.components.settings.OrchestratorGameRenderSetting.classic', 'Classic'),
  hd: translate('auto.components.settings.OrchestratorGameRenderSetting.hd', 'HD'),
  'hd-compact': translate(
    'auto.components.settings.OrchestratorGameRenderSetting.hdCompact',
    'HD compact'
  )
})

/** Classic, hd or hd-compact; a project row also offers Inherit and says what it resolves to. */
export function OrchestratorGameRenderRow<V extends OrchestratorGameRender | 'inherit'>({
  value,
  effective,
  disabled,
  onChange
}: {
  value: V
  /** The project's resolved render and its source; set only on a project row. */
  effective?: string
  disabled?: boolean
  onChange: (next: V) => void
}): React.JSX.Element {
  const label = translate('auto.components.settings.OrchestratorGameRenderSetting.label', 'Render')
  const labels = orchestratorGameRenderLabels()
  const options = [
    ...(effective === undefined
      ? []
      : [{ value: 'inherit' as V, label: orchestratorGameInheritLabel() }]),
    { value: 'classic' as V, label: labels.classic },
    { value: 'hd' as V, label: labels.hd },
    { value: 'hd-compact' as V, label: labels['hd-compact'] }
  ]
  return (
    <SettingsRow
      label={label}
      description={
        effective ??
        translate(
          'auto.components.settings.OrchestratorGameRenderSetting.description',
          'Classic is the 5-row pixel art. HD draws a 9 to 14-row scene with light, weather and day and night; HD compact draws it in 7 rows.'
        )
      }
      control={
        <SettingsSegmentedControl
          value={value}
          ariaLabel={label}
          size="sm"
          options={options.map((one) => ({ ...one, disabled }))}
          onChange={onChange}
        />
      }
    />
  )
}

type LookKey = 'render' | 'timezone'
type LookLayer = Partial<Pick<OrchestratorGameConfig, LookKey>>

/** Render and time zone for one layer; `effective` (project rows) adds Inherit and the resolved values. */
export function OrchestratorGameLookRows({
  layer,
  effective,
  disabled,
  onChange
}: {
  layer: LookLayer | undefined
  effective?: { render: string; timezone: string }
  disabled?: boolean
  onChange: <K extends LookKey>(key: K, value: OrchestratorGameConfig[K] | undefined) => void
}): React.JSX.Element {
  const stored = layer?.timezone ?? ''
  return (
    <>
      {effective === undefined ? (
        <OrchestratorGameRenderRow
          value={layer?.render ?? 'classic'}
          disabled={disabled}
          onChange={(next) => onChange('render', next)}
        />
      ) : (
        <OrchestratorGameRenderRow
          value={layer?.render ?? 'inherit'}
          effective={effective.render}
          disabled={disabled}
          onChange={(next) => onChange('render', next === 'inherit' ? undefined : next)}
        />
      )}
      <OrchestratorGameTimezoneRow
        key={stored}
        stored={stored}
        effective={effective?.timezone}
        disabled={disabled}
        onCommit={(value) => onChange('timezone', value)}
      />
    </>
  )
}

/** The zone hd's day and night follow; clearing it goes back to the layer below. */
export function OrchestratorGameTimezoneRow({
  stored,
  effective,
  disabled,
  onCommit
}: {
  /** The value this layer stores; '' when it stores none. */
  stored: string
  /** The project's resolved zone and its source; set only on a project row. */
  effective?: string
  disabled?: boolean
  onCommit: (value: string | undefined) => void
}): React.JSX.Element {
  const label = translate(
    'auto.components.settings.OrchestratorGameRenderSetting.timezone',
    'Time zone'
  )
  const [draft, setDraft] = useState(stored)
  const [isInvalid, setIsInvalid] = useState(false)
  const commit = (): void => {
    const text = draft.trim()
    if (text === stored) {
      setIsInvalid(false)
      return
    }
    if (text === '') {
      setIsInvalid(false)
      onCommit(undefined)
      return
    }
    const isValid = isOrchestratorGameTimezone(text)
    setIsInvalid(!isValid)
    if (isValid) {
      onCommit(text)
    }
  }
  return (
    <SettingsRow
      label={label}
      description={
        <>
          {effective ??
            translate(
              'auto.components.settings.OrchestratorGameRenderSetting.timezoneDescription',
              "When HD turns to night. Empty or local follows this machine's clock."
            )}
          {isInvalid ? (
            <span role="alert" className="block text-destructive">
              {translate(
                'auto.components.settings.OrchestratorGameRenderSetting.timezoneInvalid',
                'Use local or an IANA time zone such as America/Bogota.'
              )}
            </span>
          ) : null}
        </>
      }
      control={
        <Input
          aria-label={label}
          aria-invalid={isInvalid}
          value={draft}
          disabled={disabled}
          placeholder={effective === undefined ? 'local' : orchestratorGameInheritLabel()}
          spellCheck={false}
          className="h-8 w-40 text-xs md:text-xs"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
            }
          }}
        />
      }
    />
  )
}
