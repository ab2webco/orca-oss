import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  daylightAt,
  hourOf
} from '../../../../../resources/claude-plugins/orca-game/hooks/hd-daylight'
import type { GamePanelStyle } from '../../../../shared/orchestrator-game-panel'
import type { OrchestratorGameSceneExtension } from '../../../../shared/orchestrator-game-scene'
import {
  orchestratorGameSceneArtOf,
  type OrchestratorGameSceneArt,
  type OrchestratorGameSceneArtSource
} from '../../../../shared/orchestrator-game-scene-native'
import { loadTeamSceneArt } from './team-scene-art-load'
import {
  readTeamSceneArtUrl,
  teamSceneArtHostKeyOf,
  useTeamSceneArtHost,
  type TeamSceneArtHost
} from './team-scene-art-host'
import { createImagePainter, type TeamSceneImageArt } from './team-scene-image-painter'
import { OFFICE_BACK_SEAT } from './team-scene-office-back'
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

const carriedOf = (scene: TeamScenePainterScene) =>
  scene.extensions.find((one) => one.id === (scene.id ?? QUEST))?.definition

/** The style drawn for this scene and where its art comes from; Pixel only when picked or broken. */
export function teamSceneArtOf(args: {
  style: GamePanelStyle
  scene: TeamScenePainterScene
  sceneArtFailed?: boolean
  bundledArtFailed?: boolean
}): OrchestratorGameSceneArt {
  return orchestratorGameSceneArtOf({
    style: args.style,
    sceneId: args.scene.id ?? QUEST,
    scene: carriedOf(args.scene),
    sceneArtFailed: args.sceneArtFailed,
    bundledArtFailed: args.bundledArtFailed
  })
}

/** The style really drawn, where its art came from, and its painter; null only while art decodes. */
export type TeamSceneStage = {
  drawn: GamePanelStyle
  art: OrchestratorGameSceneArtSource
  painter: TeamScenePainter | null
  /** A fresh painter of the same art, for a building floor that draws apart from the stage's. */
  makePainter: () => TeamScenePainter | null
}

type ArtRequest = { key: string; own: boolean; load: () => Promise<TeamSceneImageArt> }

function artRequestOf(args: {
  art: OrchestratorGameSceneArtSource
  style: 'figures' | 'office'
  sceneKey: string
  host: TeamSceneArtHost | null
}): ArtRequest | null {
  const { art, style, sceneKey, host } = args
  if (art === 'bundled') {
    return {
      key: `bundled|${style}`,
      own: false,
      load: () => loadTeamSceneArt(teamSceneQuestArtOf(style), teamSceneQuestArtUrl)
    }
  }
  const scene = JSON.parse(sceneKey) as TeamScenePainterScene
  const native = carriedOf(scene)?.native?.[style]
  if (art !== 'scene' || !native || !host) {
    return null
  }
  const sceneId = scene.id ?? QUEST
  return {
    key: ownArtKeyOf(style, sceneKey, host),
    own: true,
    load: () => loadTeamSceneArt(native, (src) => readTeamSceneArtUrl(host, sceneId, src))
  }
}

const ownArtKeyOf = (style: GamePanelStyle, sceneKey: string, host: TeamSceneArtHost | null) =>
  `scene|${style}|${teamSceneArtHostKeyOf(host)}|${sceneKey}`

/** The stage for the panel's style; while the painter is null, hold `TEAM_SCENE_ART_HEIGHT`. */
export function useTeamScenePainter(args: TeamScenePainterArgs): TeamSceneStage {
  const { style, scene, timezone } = args
  const colors = useTeamSceneStatusColors()
  const host = useTeamSceneArtHost()
  // Why by text: each poll hands a new `extensions` array, and a new painter drops the stage's caches.
  const sceneKey = JSON.stringify(scene)
  const [ownFailed, setOwnFailed] = useState<string | null>(null)
  const [bundledFailed, setBundledFailed] = useState<GamePanelStyle | null>(null)
  const [loaded, setLoaded] = useState<{ key: string; art: TeamSceneImageArt } | null>(null)
  const art = teamSceneArtOf({
    style,
    scene,
    // Why: without the lead's host there is nowhere to read the scene's own art from.
    sceneArtFailed: host === null || ownFailed === ownArtKeyOf(style, sceneKey, host),
    bundledArtFailed: bundledFailed === style
  })
  const artStyle = art.drawn === 'figures' || art.drawn === 'office' ? art.drawn : null

  const request = useMemo(
    () =>
      artStyle === null ? null : artRequestOf({ art: art.art, style: artStyle, sceneKey, host }),
    [art.art, artStyle, sceneKey, host]
  )

  useEffect(() => {
    if (request === null) {
      return
    }
    let current = true
    void request.load().then(
      (loadedArt) => {
        if (current) {
          setLoaded({ key: request.key, art: loadedArt })
        }
      },
      () => {
        if (!current) {
          return
        }
        if (request.own) {
          setOwnFailed(request.key)
        } else if (artStyle !== null) {
          setBundledFailed(artStyle)
        }
      }
    )
    return () => {
      current = false
    }
  }, [request, artStyle])

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

  const image = request !== null && loaded?.key === request.key ? loaded.art : null
  // Why a maker: each floor of the building draws with its own painter, which keeps its own effects.
  const makePainter = useCallback((): TeamScenePainter | null => {
    if (artStyle === null) {
      return createPixelPainter({ ...pixelScene, colors })
    }
    const builds = artStyle === 'figures' ? 'castle' : 'office'
    // Why only Orca's own desk: the back view knows where its art's side chair ends.
    const back = artStyle === 'office' && request?.own === false ? OFFICE_BACK_SEAT : null
    return image ? createImagePainter({ art: image, colors, builds, back }) : null
  }, [artStyle, image, pixelScene, colors, request])
  const painter = useMemo(makePainter, [makePainter])
  return { drawn: art.drawn, art: art.art, painter, makePainter }
}
