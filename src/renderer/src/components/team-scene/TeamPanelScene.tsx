import React, { useMemo } from 'react'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { teamSceneInputOf } from '../../../../shared/team-scene/team-scene-input'
import { TeamSceneCanvas } from './TeamSceneCanvas'
import { teamSceneLeadLineOf } from './team-scene-copy'
import { TEAM_SCENE_ART_HEIGHT } from './team-scene-image-painter'
import { useTeamScenePainter } from './use-team-scene-painter'

type Props = { model: TeamPanelGameModel; style: GamePanelStyle }

/** The live scene for a team in the Game look, drawn from the Team model only. */
export function TeamPanelScene({ model, style }: Props): React.JSX.Element {
  const timezone = model.metrics.kind === 'ready' ? model.metrics.value.timezone : 'local'
  const { drawn, painter } = useTeamScenePainter({ style, scene: model.scene, timezone })
  const input = useMemo(() => teamSceneInputOf(model), [model])
  return (
    <div className="shrink-0 border-b border-border" data-team-scene={drawn}>
      {painter ? (
        <TeamSceneCanvas
          input={input}
          painter={painter}
          leadLine={teamSceneLeadLineOf(model.lead)}
        />
      ) : (
        <div style={{ height: TEAM_SCENE_ART_HEIGHT }} />
      )}
    </div>
  )
}
