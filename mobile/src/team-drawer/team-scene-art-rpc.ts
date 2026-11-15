import type { RpcClient } from '../transport/rpc-client'

// Mirrors MOBILE_TEAM_SCENE_RUNTIME_CAPABILITY in src/shared/protocol-version.ts.
export const MOBILE_TEAM_SCENE_CAPABILITY = 'mobile.team-scene.v1'

export type TeamSceneArtImage = { uri: string; width: number; height: number }

// Why only these: the host serves no other type (orchestrator-game-scene-art.ts).
const MIME_TYPES = new Set(['image/png', 'image/webp'])

const ascii = (bytes: Uint8Array, from: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(from, from + length))
const be32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0
const le24 = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)

// Why read the header: a sheet is cropped to one frame, which needs the whole sheet's size.
function sizeOf(bytes: Uint8Array): { width: number; height: number } | null {
  if (ascii(bytes, 1, 3) === 'PNG' && ascii(bytes, 12, 4) === 'IHDR') {
    return { width: be32(bytes, 16), height: be32(bytes, 20) }
  }
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return null
  }
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X') {
    return { width: le24(bytes, 24) + 1, height: le24(bytes, 27) + 1 }
  }
  if (chunk === 'VP8 ') {
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff
    }
  }
  if (chunk === 'VP8L') {
    const [b1, b2, b3, b4] = [bytes[21]!, bytes[22]!, bytes[23]!, bytes[24]!]
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0xf) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
    }
  }
  return null
}

/** One image of the lead's scene file, as the desktop panel reads it; rejects on any failure. */
export async function readTeamSceneArtImage(
  client: RpcClient,
  caller: { worktreeId: string; terminalHandle: string },
  sceneId: string,
  src: string
): Promise<TeamSceneArtImage> {
  const response = await client.sendRequest('game.sceneArt', { ...caller, sceneId, src })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  // Why parse: a paired host may run another build.
  const { contentBase64, mimeType } = (response.result ?? {}) as Record<string, unknown>
  if (
    typeof contentBase64 !== 'string' ||
    contentBase64 === '' ||
    !MIME_TYPES.has(mimeType as string)
  ) {
    throw new Error(`no image for ${src}`)
  }
  const head = atob(contentBase64.slice(0, 48))
  const size = sizeOf(Uint8Array.from(head, (one) => one.charCodeAt(0)))
  if (!size || size.width === 0 || size.height === 0) {
    throw new Error(`no size for ${src}`)
  }
  return { uri: `data:${mimeType as string};base64,${contentBase64}`, ...size }
}
