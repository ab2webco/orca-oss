import { useMemo } from 'react'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { OrchestratorGameSceneExtension } from '../../../../shared/orchestrator-game-scene'
import type { TeamSceneInput } from '../../../../shared/team-scene/team-scene-types'
import { TeamSceneCanvas } from '../team-scene/TeamSceneCanvas'
import { TEAM_SCENE_ART_HEIGHT } from '../team-scene/team-scene-image-painter'
import { useTeamScenePainter } from '../team-scene/use-team-scene-painter'
import { translate } from '@/i18n/i18n'

/** The Team panel's stage in the chosen style, drawn by the panel's own painter. */
export function GamePanelStylePreview({
  style,
  scene
}: {
  style: GamePanelStyle
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
  return (
    <div
      data-slot="game-panel-style-preview"
      data-style={drawn}
      data-scene={scene.id}
      className="mt-2 mb-3 max-w-[512px] overflow-hidden rounded-md border border-border"
    >
      {painter ? (
        <TeamSceneCanvas input={input} painter={painter} leadLine={null} />
      ) : (
        <div style={{ height: TEAM_SCENE_ART_HEIGHT }} />
      )}
    </div>
  )
}
