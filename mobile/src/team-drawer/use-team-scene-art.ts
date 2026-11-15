import { useEffect, useRef, useState } from 'react'
import { orchestratorGameSceneArtFiles } from '../../../src/shared/orchestrator-game-scene-native'
import type { RpcClient } from '../transport/rpc-client'
import { readTeamSceneArtImage, type TeamSceneArtImage } from './team-scene-art-rpc'
import type { TeamSceneArtPick, TeamSceneBand } from './team-scene-band'

export type TeamSceneArtLoad =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; images: ReadonlyMap<string, TeamSceneArtImage> }

// Why every file: the stage animates each sheet and draws the desks, as the desktop loads them all.
function srcsOf(art: Extract<TeamSceneArtPick, { kind: 'scene' }>): string[] {
  return orchestratorGameSceneArtFiles({ [art.style]: art.native })
}

/** The scene file's images the band draws, read once per scene and style from the lead's host. */
export function useTeamSceneArt(
  client: RpcClient | null,
  caller: { worktreeId: string; terminalHandle: string } | null,
  band: TeamSceneBand | null
): TeamSceneArtLoad | null {
  const art = band?.kind === 'stage' && band.art.kind === 'scene' ? band.art : null
  const srcs = art ? srcsOf(art) : null
  const request =
    art && srcs && client && caller
      ? {
          key: JSON.stringify([caller, art.sceneId, srcs]),
          client,
          caller,
          sceneId: art.sceneId,
          srcs
        }
      : null
  // Why keyed by text: every 20 s poll hands a new band, and re-reading the art would cost megabytes.
  const requestRef = useRef(request)
  const key = request?.key ?? null
  const [loaded, setLoaded] = useState<{ key: string; load: TeamSceneArtLoad } | null>(null)

  // Why declared first: effects run in order, so the read below sees this render's request.
  useEffect(() => {
    requestRef.current = request
  })

  useEffect(() => {
    const request = requestRef.current
    if (!request || key === null) {
      return
    }
    let stale = false
    void Promise.all(
      request.srcs.map(async (src) => {
        const image = await readTeamSceneArtImage(
          request.client,
          request.caller,
          request.sceneId,
          src
        )
        return [src, image] as const
      })
    ).then(
      (entries) => {
        if (!stale) {
          setLoaded({ key, load: { kind: 'ready', images: new Map(entries) } })
        }
      },
      // Why whole or nothing: a scene missing one image draws its fallback, as the desktop's does.
      () => {
        if (!stale) {
          setLoaded({ key, load: { kind: 'failed' } })
        }
      }
    )
    return () => {
      stale = true
    }
  }, [key])

  if (key === null) {
    return null
  }
  return loaded?.key === key ? loaded.load : { kind: 'loading' }
}
