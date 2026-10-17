import type {
  OrchestratorGameMode,
  OrchestratorGameSource
} from '../../../../shared/orchestrator-game-config'
import { translate } from '@/i18n/i18n'

export const orchestratorGameModeLabels = (): Record<OrchestratorGameMode, string> => ({
  on: translate('auto.components.settings.OrchestratorGameSetting.on', 'On'),
  zen: translate('auto.components.settings.OrchestratorGameSetting.zen', 'Zen'),
  off: translate('auto.components.settings.OrchestratorGameSetting.off', 'Off')
})

export const orchestratorGameInheritLabel = (): string =>
  translate('auto.components.settings.OrchestratorGameSetting.inherit', 'Inherit')

export const orchestratorGameSourceLabel = (source: OrchestratorGameSource): string =>
  ({
    default: translate('auto.components.settings.OrchestratorGameSetting.sourceDefault', 'default'),
    global: translate(
      'auto.components.settings.OrchestratorGameSetting.sourceGlobal',
      'global setting'
    ),
    project: translate(
      'auto.components.settings.OrchestratorGameSetting.sourceProject',
      'from orca.yaml'
    ),
    local: translate('auto.components.settings.OrchestratorGameSetting.sourceLocal', 'this machine')
  })[source]
