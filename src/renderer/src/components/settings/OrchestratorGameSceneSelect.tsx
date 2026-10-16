import { useEffect, useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { ensurePluginPanelsLoaded, usePluginPanelsStore } from '../../store/plugin-panels'
import {
  orchestratorGameSceneOptions,
  type OrchestratorGameSceneOption
} from './orchestrator-game-scene-options'
import { translate } from '@/i18n/i18n'

export const INHERIT_SCENE = 'inherit'

export const sceneLabel = (option: OrchestratorGameSceneOption): string => {
  if (option.kind === 'built-in') {
    return translate(
      'auto.components.settings.OrchestratorGameSetting.sceneQuest',
      'Quest (built-in)'
    )
  }
  if (option.kind === 'missing') {
    return translate(
      'auto.components.settings.OrchestratorGameSetting.sceneMissing',
      '{{value0}} (not installed)',
      { value0: option.scene }
    )
  }
  return `${option.scene} · ${option.pluginName}`
}

/** `value` is a scene id, or `inherit` when `inheritLabel` is given; `null` asks to inherit. */
export function OrchestratorGameSceneSelect({
  value,
  ariaLabel,
  inheritLabel,
  disabled,
  onChange
}: {
  value: string
  ariaLabel: string
  inheritLabel?: string
  disabled?: boolean
  onChange: (scene: string | null) => void
}): React.JSX.Element {
  const plugins = usePluginPanelsStore((state) => state.plugins)
  useEffect(() => {
    ensurePluginPanelsLoaded()
  }, [])
  const options = useMemo(
    () =>
      orchestratorGameSceneOptions(
        plugins,
        value === INHERIT_SCENE && inheritLabel ? undefined : value
      ),
    [plugins, value, inheritLabel]
  )
  const selected = options.find((option) => option.value === value)

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next === INHERIT_SCENE ? null : next)}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        title={selected ? sceneLabel(selected) : inheritLabel}
        // Why: plugin ids can outgrow the trigger; end them with an ellipsis instead of a hard cut.
        className="w-48 max-w-full *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" side="bottom" sideOffset={4}>
        {inheritLabel ? <SelectItem value={INHERIT_SCENE}>{inheritLabel}</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {sceneLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
