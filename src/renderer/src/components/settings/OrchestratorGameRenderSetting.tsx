import { useState } from 'react'
import {
  isOrchestratorGameTimezone,
  type OrchestratorGameRender
} from '../../../../shared/orchestrator-game-render'
import { Input } from '../ui/input'
import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { InheritedSourceLine, type InheritedChoice } from './InheritableSettingRow'
import { translate } from '@/i18n/i18n'

export const orchestratorGameRenderLabels = (): Record<OrchestratorGameRender, string> => ({
  classic: translate('auto.components.settings.OrchestratorGameRenderSetting.classic', 'Classic'),
  hd: translate('auto.components.settings.OrchestratorGameRenderSetting.hd', 'HD'),
  'hd-compact': translate(
    'auto.components.settings.OrchestratorGameRenderSetting.hdCompact',
    'HD compact'
  )
})

export const renderLabel = (): string =>
  translate('auto.components.settings.OrchestratorGameRenderSetting.label', 'Render')

/** Classic, hd or hd-compact for every project; a project row is an InheritableSegmentedRow. */
export function OrchestratorGameRenderRow({
  value,
  onChange
}: {
  value: OrchestratorGameRender
  onChange: (next: OrchestratorGameRender) => void
}): React.JSX.Element {
  const label = renderLabel()
  const labels = orchestratorGameRenderLabels()
  return (
    <SettingsRow
      label={label}
      description={translate(
        'auto.components.settings.OrchestratorGameRenderSetting.description',
        'Classic is the 5-row pixel art. HD draws a 9 to 14-row scene with light, weather and day and night; HD compact draws it in 7 rows.'
      )}
      control={
        <SettingsSegmentedControl
          value={value}
          ariaLabel={label}
          size="sm"
          options={(['classic', 'hd', 'hd-compact'] as const).map((one) => ({
            value: one,
            label: labels[one]
          }))}
          onChange={onChange}
        />
      }
    />
  )
}

/** The project row's applied zone, its layer and what clearing it gives back. */
export type TimezoneRowSource = {
  applied: string
  source: string
  inherited: InheritedChoice
}

/** The zone the scenes' day and night follow; clearing it goes back to the layer below. */
export function OrchestratorGameTimezoneRow({
  stored,
  project,
  disabled,
  onCommit
}: {
  /** The value this layer stores; '' when it stores none. */
  stored: string
  /** Set only on a project row. */
  project?: TimezoneRowSource
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
          <span className="block">
            {translate(
              'auto.components.settings.OrchestratorGameRenderSetting.timezoneDescription',
              "When the scenes turn to night and the day's numbers start. Empty or local follows this machine's clock."
            )}
          </span>
          {project ? (
            <InheritedSourceLine
              applied={project.applied}
              source={project.source}
              inherited={project.inherited}
              isOverridden={stored !== ''}
              onReset={() => {
                setDraft('')
                setIsInvalid(false)
                onCommit(undefined)
              }}
            />
          ) : null}
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
          placeholder={project?.inherited.value ?? 'local'}
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
