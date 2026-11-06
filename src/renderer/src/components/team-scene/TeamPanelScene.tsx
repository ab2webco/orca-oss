import React, { useMemo } from 'react'
import {
  daylightAt,
  hourOf
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import {
  orchestratorGameSceneDrawnStyle,
  type OrchestratorGameSceneStyle
} from '../../../../shared/orchestrator-game-scene-native'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { teamSceneInputOf } from '../../../../shared/team-scene/team-scene-input'
import { TeamSceneCanvas } from './TeamSceneCanvas'
import { teamSceneLeadLineOf } from './team-scene-copy'
import { createFiguresPainter } from './team-scene-figures-painter'
import { createOfficePainter } from './team-scene-office-painter'
import type { TeamScenePainter } from './team-scene-painter'
import { createPixelPainter } from './team-scene-pixel-painter'
import { teamScenePixelSceneOf } from './team-scene-pixel-scene'
import { useTeamSceneStatusColors } from './team-scene-status-colors'

type Props = { model: TeamPanelGameModel; style: OrchestratorGameSceneStyle }

/** The live scene for a team in the Game look, drawn from the Team model only. */
export function TeamPanelScene({ model, style }: Props): React.JSX.Element {
  const colors = useTeamSceneStatusColors()
  const sceneId = model.scene.id ?? 'quest'
  const carried = model.scene.extensions.find((one) => one.id === sceneId)
  // A scene without art for the asked style draws in Pixel, which every scene has (ORCA-1052).
  const drawn = orchestratorGameSceneDrawnStyle({ style, sceneId, scene: carried?.definition })
  const timezone = model.metrics.kind === 'ready' ? model.metrics.value.timezone : 'local'
  // Why a key: the model is rebuilt on every poll, but a painter rebuild drops its caches.
  const sceneKey = `${drawn}|${sceneId}|${timezone}|${carried ? JSON.stringify(carried.definition) : ''}`
  const painter = useMemo((): TeamScenePainter => {
    if (drawn === 'office') {
      return createOfficePainter(colors)
    }
    if (drawn === 'pixel') {
      const now = Date.now()
      const scene = teamScenePixelSceneOf({
        sceneId,
        extensions: { scenes: model.scene.extensions },
        nowMs: now,
        timezone
      })
      return createPixelPainter({ scene, light: daylightAt(hourOf(now, timezone)), colors })
    }
    return createFiguresPainter(colors)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sceneKey stands for the scene fields
  }, [sceneKey, colors])
  const input = useMemo(() => teamSceneInputOf(model), [model])
  return (
    <div className="shrink-0 border-b border-border" data-team-scene={drawn}>
      <TeamSceneCanvas input={input} painter={painter} leadLine={teamSceneLeadLineOf(model.lead)} />
    </div>
  )
}
