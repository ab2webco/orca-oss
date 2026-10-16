import { useEffect, useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '../ui/select'
import { ensurePluginPanelsLoaded, usePluginPanelsStore } from '../../store/plugin-panels'
import {
  orchestratorGameSceneOptions,
  type OrchestratorGameSceneOption
} from './orchestrator-game-scene-options'
import type { OrchestratorGameBuiltInScene } from '../../../../shared/orchestrator-game-config'
import { translate } from '@/i18n/i18n'

export const INHERIT_SCENE = 'inherit'
export const CUSTOM_SCENE_FILE = 'custom-file'

const builtInLabels = (): Record<OrchestratorGameBuiltInScene, string> => ({
  quest: translate(
    'auto.components.settings.OrchestratorGameSetting.sceneQuest',
    'Quest (built-in)'
  ),
  vigilante: translate(
    'auto.components.settings.OrchestratorGameSetting.sceneVigilante',
    'Night Watch (built-in)'
  ),
  jrpg: translate(
    'auto.components.settings.OrchestratorGameSetting.sceneJrpg',
    'Crystal Saga (built-in)'
  ),
  tamer: translate(
    'auto.components.settings.OrchestratorGameSetting.sceneTamer',
    'Beast Tamer (built-in)'
  )
})

export const sceneLabel = (option: OrchestratorGameSceneOption): string => {
  if (option.kind === 'built-in') {
    return builtInLabels()[option.scene]
  }
  if (option.kind === 'file') {
    return option.path
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

/** `value` is a scene id, `inherit` when `inheritLabel` is given, or `custom-file` when
 *  `onCustomFile` is; `null` asks to inherit. */
export function OrchestratorGameSceneSelect({
  value,
  ariaLabel,
  inheritLabel,
  disabled,
  onChange,
  onCustomFile
}: {
  value: string
  ariaLabel: string
  inheritLabel?: string
  disabled?: boolean
  onChange: (scene: string | null) => void
  onCustomFile?: () => void
}): React.JSX.Element {
  const customLabel = translate(
    'auto.components.settings.OrchestratorGameSetting.sceneCustomFile',
    'Custom file…'
  )
  const plugins = usePluginPanelsStore((state) => state.plugins)
  useEffect(() => {
    ensurePluginPanelsLoaded()
  }, [])
  const options = useMemo(
    () =>
      orchestratorGameSceneOptions(
        plugins,
        (value === INHERIT_SCENE && inheritLabel) || (value === CUSTOM_SCENE_FILE && onCustomFile)
          ? undefined
          : value
      ),
    [plugins, value, inheritLabel, onCustomFile]
  )
  const selected = options.find((option) => option.value === value)
  const title = selected
    ? sceneLabel(selected)
    : value === CUSTOM_SCENE_FILE && onCustomFile
      ? customLabel
      : inheritLabel

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === CUSTOM_SCENE_FILE && onCustomFile) {
          onCustomFile()
        } else {
          onChange(next === INHERIT_SCENE ? null : next)
        }
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        title={title}
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
        {onCustomFile ? (
          <>
            <SelectSeparator />
            <SelectItem value={CUSTOM_SCENE_FILE}>{customLabel}</SelectItem>
          </>
        ) : null}
      </SelectContent>
    </Select>
  )
}
