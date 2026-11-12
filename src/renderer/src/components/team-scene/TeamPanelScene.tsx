import React, { useCallback, useMemo, useState } from 'react'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { teamSceneInputOf } from '../../../../shared/team-scene/team-scene-input'
import { TeamSceneBuilding, teamSceneHasFloors } from './TeamSceneBuilding'
import { TeamSceneCanvas } from './TeamSceneCanvas'
import { teamSceneLeadLineOf } from './team-scene-copy'
import { TEAM_SCENE_ART_HEIGHT } from './team-scene-image-painter'
import { useTeamScenePainter } from './use-team-scene-painter'
import { TeamScenePainterContext } from './team-scene-painter-context'
import { TeamSceneLeadLineContext } from './team-scene-lead-line-context'
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
  const { drawn, art, painter, makePainter } = useTeamScenePainter({
    style,
    scene: model.scene,
    timezone
  })
  const input = useMemo(() => teamSceneInputOf(model), [model])
  // Why agent status: game.state names the lead's question tool, never its question.
  const question = useAppStore((s) => teamLeadQuestionOf(model, s)?.text ?? null)
  const lead = question
    ? { ...model.lead, liveAction: { kind: 'question' as const, text: question, options: [] } }
    : model.lead
  const leadLine = teamSceneLeadLineOf(lead)
  // Why: like the advisor's, a lead's line with no room for its bubble shows in its card (ORCA-1139).
  const [leadUnplaced, setLeadUnplaced] = useState(false)
  const onUnplaced = useCallback((keys: string[]) => setLeadUnplaced(keys.includes('lead')), [])
  return (
    <TeamScenePainterContext.Provider value={painter}>
      <TeamSceneLeadLineContext.Provider value={painter && leadUnplaced ? leadLine : null}>
        <div
          className="shrink-0 border-b border-border"
          data-team-scene={drawn}
          data-team-scene-art={art}
        >
          {/* Why Office only: the building is desks on floors, and one machine stays as today. */}
          {painter && drawn === 'office' && teamSceneHasFloors(model) ? (
            <TeamSceneBuilding
              model={model}
              makePainter={makePainter}
              leadLine={leadLine}
              onUnplaced={onUnplaced}
            />
          ) : painter ? (
            <TeamSceneCanvas
              input={input}
              painter={painter}
              leadLine={leadLine}
              onUnplaced={onUnplaced}
            />
          ) : (
            <div style={{ height: TEAM_SCENE_ART_HEIGHT }} />
          )}
        </div>
        {children}
      </TeamSceneLeadLineContext.Provider>
    </TeamScenePainterContext.Provider>
  )
}
