import { useEffect, useRef, useState } from 'react'
import type { OrchestratorGameSceneNativeStyle } from '../../../src/shared/orchestrator-game-scene-native'
import type { RpcClient } from '../transport/rpc-client'
import { readTeamSceneArtImage, type TeamSceneArtImage } from './team-scene-art-rpc'
import type { TeamSceneBand, TeamSceneBandActor } from './team-scene-band'

export type TeamSceneArtLoad =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; images: ReadonlyMap<string, TeamSceneArtImage> }

type Role = OrchestratorGameSceneNativeStyle['roles']['lead']

/** The art and sheet an actor wears; Jev wears the member art when the scene has none for it. */
export function teamSceneRoleOf(
  native: OrchestratorGameSceneNativeStyle,
  actor: TeamSceneBandActor
): { role: Role; sheet: string } {
  const role =
    actor.role === 'lead'
      ? native.roles.lead
      : actor.role === 'advisor'
        ? (native.roles.advisor ?? native.roles.member)
        : native.roles.member
  return { role, sheet: role.sheets[actor.seed % role.sheets.length]! }
}

// Why only these: a scene may hold eight 2 MB sheets per role, and the band draws one per actor.
function srcsOf(band: Extract<TeamSceneBand, { kind: 'scene' }>): string[] {
  const sheets = band.actors.map((actor) => teamSceneRoleOf(band.native, actor).sheet)
  return [...new Set([...band.native.layers.map((layer) => layer.src), ...sheets])]
}

/** The scene file's images the band draws, read once per scene and style from the lead's host. */
export function useTeamSceneArt(
  client: RpcClient | null,
  caller: { worktreeId: string; terminalHandle: string } | null,
  band: TeamSceneBand | null
): TeamSceneArtLoad | null {
  const srcs = band?.kind === 'scene' ? srcsOf(band) : null
  const request =
    band?.kind === 'scene' && srcs && client && caller
      ? {
          key: JSON.stringify([caller, band.sceneId, srcs]),
          client,
          caller,
          sceneId: band.sceneId,
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
