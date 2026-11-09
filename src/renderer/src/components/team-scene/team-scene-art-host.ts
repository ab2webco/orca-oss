import { create } from 'zustand'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'

/** The host and lead caller the Team panel read game.state from; scene art comes from the same. */
export type TeamSceneArtHost = {
  target: RuntimeClientTarget
  caller: { worktreeId: string; terminalHandle: string }
}

// Why 30 s: one image is at most 2 MB, read once per scene and style.
const SCENE_ART_TIMEOUT_MS = 30_000
const MIME_TYPES = new Set(['image/png', 'image/webp'])

export const useTeamSceneArtHostStore = create<{ host: TeamSceneArtHost | null }>(() => ({
  host: null
}))

export const teamSceneArtHostKeyOf = (host: TeamSceneArtHost | null): string =>
  host ? JSON.stringify([host.target, host.caller.worktreeId, host.caller.terminalHandle]) : 'none'

// Why compare: the poller publishes every 20 s, and a new object would reload the art each time.
export function publishTeamSceneArtHost(host: TeamSceneArtHost): void {
  const current = useTeamSceneArtHostStore.getState().host
  if (teamSceneArtHostKeyOf(current) !== teamSceneArtHostKeyOf(host)) {
    useTeamSceneArtHostStore.setState({ host })
  }
}

export const useTeamSceneArtHost = (): TeamSceneArtHost | null =>
  useTeamSceneArtHostStore((state) => state.host)

/** A data URL of one image of the scene's art; rejects on any failure, older hosts included. */
export async function readTeamSceneArtUrl(
  host: TeamSceneArtHost,
  sceneId: string,
  src: string
): Promise<string> {
  const reply = await callRuntimeRpc<{ contentBase64?: unknown; mimeType?: unknown }>(
    host.target,
    'game.sceneArt',
    { ...host.caller, sceneId, src },
    { timeoutMs: SCENE_ART_TIMEOUT_MS }
  )
  // Why parse: a paired host may run another build.
  const { contentBase64, mimeType } = reply ?? {}
  if (
    typeof contentBase64 !== 'string' ||
    contentBase64 === '' ||
    typeof mimeType !== 'string' ||
    !MIME_TYPES.has(mimeType)
  ) {
    throw new Error(`no image for ${src}`)
  }
  return `data:${mimeType};base64,${contentBase64}`
}
