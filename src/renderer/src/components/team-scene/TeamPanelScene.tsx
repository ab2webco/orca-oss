import React, { useCallback, useMemo, useState } from 'react'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { TeamPanelGameModel } from '../../../../shared/team-panel-model-types'
import { teamSceneInputOf } from '../../../../shared/team-scene/team-scene-input'
import { TeamSceneBuilding, teamSceneHasFloors } from './TeamSceneBuilding'
import { TeamSceneCanvas } from './TeamSceneCanvas'
import { TeamSceneDiorama } from './TeamSceneDiorama'
import { TeamSceneOffice3d } from './TeamSceneOffice3d'
import { useTeamSceneDioramaLook } from './use-team-scene-style'
import { teamSceneLeadLineOf } from './team-scene-copy'
import { TEAM_SCENE_ART_HEIGHT } from './team-scene-image-painter'
import { useTeamScenePainter } from './use-team-scene-painter'
import { teamSceneWhoOf } from './team-scene-who'
import { TeamScenePainterContext } from './team-scene-painter-context'
import { TeamSceneLeadLineContext } from './team-scene-lead-line-context'
import { useAppStore } from '@/store'
import { teamLeadQuestionOf } from '../team-panel/team-panel-inbox-agents'

type Props = {
  model: TeamPanelGameModel
  style: GamePanelStyle
  /** The panel's last team, shown while a read confirms it. */
  unconfirmed?: boolean
  /** Figures as the 3D diorama (ORCA-1296, behind `panel.diorama` until it draws everything). */
  diorama?: boolean
  /** The panel below the scene; its card faces draw with the scene's painter. */
  children?: React.ReactNode
}

/** The live scene for a team in the Game look, drawn from the Team model only. */
export function TeamPanelScene({
  model,
  style,
  unconfirmed,
  diorama,
  children
}: Props): React.JSX.Element {
  const timezone = model.metrics.kind === 'ready' ? model.metrics.value.timezone : 'local'
  const { drawn, art, painter, makePainter } = useTeamScenePainter({
    style,
    scene: model.scene,
    timezone
  })
  const input = useMemo(
    () => ({ ...teamSceneInputOf(model), ...(unconfirmed ? { unconfirmed: true as const } : {}) }),
    [model, unconfirmed]
  )
  const members = useMemo(() => teamSceneWhoOf(model.members), [model.members])
  // Why agent status: game.state names the lead's question tool, never its question.
  const question = useAppStore((s) => teamLeadQuestionOf(model, s)?.text ?? null)
  const lead = question
    ? { ...model.lead, liveAction: { kind: 'question' as const, text: question, options: [] } }
    : model.lead
  const leadLine = teamSceneLeadLineOf(lead)
  // Why: like the advisor's, a lead's line with no room for its bubble shows in its card (ORCA-1139).
  const [leadUnplaced, setLeadUnplaced] = useState(false)
  const onUnplaced = useCallback((keys: string[]) => setLeadUnplaced(keys.includes('lead')), [])
  // Why a fallback: with hardware acceleration off there is no WebGL, and Figures still draws.
  const [noWebgl, setNoWebgl] = useState(false)
  const onNoWebgl = useCallback(() => setNoWebgl(true), [])
  // Why quality, not a flag of its own: Illustrated draws the Office in 3D, Low resources keeps the 2D one.
  const { quality } = useTeamSceneDioramaLook()
  const office3d = drawn === 'office' && quality === 'high'
  const webgl = (diorama && drawn === 'figures') || office3d
  return (
    <TeamScenePainterContext.Provider value={painter}>
      <TeamSceneLeadLineContext.Provider value={painter && leadUnplaced ? leadLine : null}>
        <div
          className="shrink-0 border-b border-border"
          data-team-scene={drawn}
          data-team-scene-art={art}
          data-team-scene-webgl={webgl ? (noWebgl ? 'off' : 'on') : undefined}
        >
          {/* Why Office and Pixel: a floor per machine; one machine keeps its single stage. */}
          {diorama && drawn === 'figures' && !noWebgl ? (
            <TeamSceneDiorama model={model} onNoWebgl={onNoWebgl} members={members} />
          ) : office3d && !noWebgl ? (
            <TeamSceneOffice3d model={model} onNoWebgl={onNoWebgl} members={members} />
          ) : painter && (drawn === 'office' || drawn === 'pixel') && teamSceneHasFloors(model) ? (
            <TeamSceneBuilding
              model={model}
              unconfirmed={unconfirmed}
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
              members={members}
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
