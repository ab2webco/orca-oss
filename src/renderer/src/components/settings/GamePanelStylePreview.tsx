import { useCallback, useMemo, useState } from 'react'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { OrchestratorGameSceneExtension } from '../../../../shared/orchestrator-game-scene'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import { TeamSceneCanvas } from '../team-scene/TeamSceneCanvas'
import { TEAM_SCENE_ART_HEIGHT } from '../team-scene/team-scene-image-painter'
import { useTeamScenePainter } from '../team-scene/use-team-scene-painter'
import { translate } from '@/i18n/i18n'
import { GamePanelDioramaPreview } from './GamePanelDioramaPreview'
import { GamePanelOffice3dPreview } from './GamePanelOffice3dPreview'

/** The Team panel's stage in the chosen style, drawn by the panel's own painter. */
export function GamePanelStylePreview({
  style,
  scene,
  diorama = false,
  lite = false
}: {
  style: GamePanelStyle
  /** Figures as the 3D diorama; without WebGL the preview draws Figures in 2D, as the panel does. */
  diorama?: boolean
  /** Low resources: the diorama flat, and the Office in 2D as before. */
  lite?: boolean
  /** The chosen scene; a custom file carries its definition so the panel draws its own cast. */
  scene: { id: string; extensions: OrchestratorGameSceneExtension[] }
}): React.JSX.Element {
  const { drawn, painter } = useTeamScenePainter({ style, scene, timezone: 'local' })
  const leadName = translate('auto.components.settings.GamePanelStylePreview.lead', 'Lead')
  // Why the lead alone: a stage needs its lead, and a preview has no team to read.
  const input = useMemo<TeamSceneInput>(
    () => ({
      lead: { key: 'lead', name: leadName, characterKey: null, activity: 'working' },
      advisor: null,
      members: []
    }),
    [leadName]
  )
  const [noWebgl, setNoWebgl] = useState(false)
  const onNoWebgl = useCallback(() => setNoWebgl(true), [])
  const threeD = diorama && drawn === 'figures' && !noWebgl
  const office3d = drawn === 'office' && !lite && !noWebgl
  return (
    <div
      data-slot="game-panel-style-preview"
      data-style={drawn}
      data-scene={scene.id}
      className="mt-2 mb-3 max-w-[512px] overflow-hidden rounded-md border border-border"
    >
      {threeD ? (
        <GamePanelDioramaPreview lite={lite} onNoWebgl={onNoWebgl} />
      ) : office3d ? (
        <GamePanelOffice3dPreview onNoWebgl={onNoWebgl} />
      ) : painter ? (
        <TeamSceneCanvas input={input} painter={painter} leadLine={null} />
      ) : (
        <div style={{ height: TEAM_SCENE_ART_HEIGHT }} />
      )}
    </div>
  )
}
