import React, { useMemo } from 'react'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { teamSceneInputOf } from '../../../../shared/team-scene/team-scene-input'
import { TeamSceneCanvas } from './TeamSceneCanvas'
import { teamSceneLeadLineOf } from './team-scene-copy'
import { TEAM_SCENE_ART_HEIGHT } from './team-scene-image-painter'
import { useTeamScenePainter } from './use-team-scene-painter'
import { TeamScenePainterContext } from './team-scene-painter-context'
import { useAppStore } from '@/store'
import { teamLeadQuestionOf } from '../team-panel/team-panel-inbox-agents'

type Props = {
  model: TeamPanelGameModel
  style: GamePanelStyle
  /** The panel below the scene; its card faces draw with the scene's painter. */
  children?: React.ReactNode
}

/** The live scene for a team in the Game look, drawn from the Team model only. */
export function TeamPanelScene({ model, style, children }: Props): React.JSX.Element {
  const timezone = model.metrics.kind === 'ready' ? model.metrics.value.timezone : 'local'
  const { drawn, painter } = useTeamScenePainter({ style, scene: model.scene, timezone })
  const input = useMemo(() => teamSceneInputOf(model), [model])
  // Why agent status: game.state names the lead's question tool, never its question.
  const question = useAppStore((s) => teamLeadQuestionOf(model, s)?.text ?? null)
  const lead = question
    ? { ...model.lead, liveAction: { kind: 'question' as const, text: question, options: [] } }
    : model.lead
  return (
    <TeamScenePainterContext.Provider value={painter}>
      <div className="shrink-0 border-b border-border" data-team-scene={drawn}>
        {painter ? (
          <TeamSceneCanvas input={input} painter={painter} leadLine={teamSceneLeadLineOf(lead)} />
        ) : (
          <div style={{ height: TEAM_SCENE_ART_HEIGHT }} />
        )}
      </div>
      {children}
    </TeamScenePainterContext.Provider>
  )
}
