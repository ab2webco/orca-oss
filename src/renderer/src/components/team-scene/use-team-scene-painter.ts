import { useEffect, useMemo, useState } from 'react'
import {
  daylightAt,
  hourOf
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { OrchestratorGameSceneExtension } from '../../../../shared/orchestrator-game-scene'
import { orchestratorGameSceneDrawnStyle } from '../../../../shared/orchestrator-game-scene-native'
import { loadTeamSceneArt } from './team-scene-art-load'
import { createImagePainter, type TeamSceneImageArt } from './team-scene-image-painter'
import type { TeamScenePainter } from './team-scene-painter'
import { createPixelPainter } from './team-scene-pixel-painter'
import { teamScenePixelSceneOf } from './team-scene-pixel-scene'
import { teamSceneQuestArtOf, teamSceneQuestArtUrl } from './team-scene-quest-art'
import { useTeamSceneStatusColors } from './team-scene-status-colors'

const QUEST = 'quest'

/** What the Team model carries as `scene`; a null id reads as Quest, as it does for Pixel. */
type TeamScenePainterScene = {
  id: string | null
  extensions: OrchestratorGameSceneExtension[]
}

export type TeamScenePainterArgs = {
  style: GamePanelStyle
  scene: TeamScenePainterScene
  /** The project's zone, for Pixel's theme of the day and daylight. */
  timezone: string
}

/** The style drawn for this scene: the one asked for when its art can be read here, else Pixel. */
export function teamSceneDrawnStyleOf(args: {
  style: GamePanelStyle
  scene: TeamScenePainterScene
  artFailed?: boolean
}): GamePanelStyle {
  const sceneId = args.scene.id ?? QUEST
  const carried = args.scene.extensions.find((one) => one.id === sceneId)?.definition
  return orchestratorGameSceneDrawnStyle({
    style: args.style,
    sceneId,
    scene: carried,
    // Why: only Quest's art is bundled; the panel cannot read a scene file's images (ORCA-1085).
    artFailed: args.artFailed || carried?.native !== undefined
  })
}

/** The painter for the panel's style; null only while its art decodes, so hold the stage's height. */
export function useTeamScenePainter(args: TeamScenePainterArgs): TeamScenePainter | null {
  const { style, scene, timezone } = args
  const colors = useTeamSceneStatusColors()
  const [failed, setFailed] = useState<GamePanelStyle | null>(null)
  const [loaded, setLoaded] = useState<{ style: GamePanelStyle; art: TeamSceneImageArt } | null>(
    null
  )
  const drawn = teamSceneDrawnStyleOf({ style, scene, artFailed: failed === style })
  const artStyle = drawn === 'figures' || drawn === 'office' ? drawn : null

  useEffect(() => {
    if (artStyle === null) {
      return
    }
    let current = true
    void loadTeamSceneArt(teamSceneQuestArtOf(artStyle), teamSceneQuestArtUrl).then(
      (art) => {
        if (current) {
          setLoaded({ style: artStyle, art })
        }
      },
      () => {
        if (current) {
          setFailed(artStyle)
        }
      }
    )
    return () => {
      current = false
    }
  }, [artStyle])

  // Why by text: each poll hands a new `extensions` array, and a new painter drops the stage's caches.
  const sceneKey = JSON.stringify(scene)
  const pixelScene = useMemo(() => {
    const { id, extensions } = JSON.parse(sceneKey) as TeamScenePainterScene
    const nowMs = Date.now()
    return {
      scene: teamScenePixelSceneOf({
        sceneId: id ?? QUEST,
        extensions: { scenes: extensions },
        nowMs,
        timezone
      }),
      light: daylightAt(hourOf(nowMs, timezone))
    }
  }, [sceneKey, timezone])

  const art = loaded?.style === artStyle ? loaded?.art : null
  return useMemo(() => {
    if (artStyle === null) {
      return createPixelPainter({ ...pixelScene, colors })
    }
    return art ? createImagePainter({ art, colors }) : null
  }, [artStyle, art, pixelScene, colors])
}
