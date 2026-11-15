import { describe, expect, it, vi } from 'vitest'
import type { RpcClient, RpcResponse } from '../transport/rpc-client'
import { readTeamSceneArtImage } from './team-scene-art-rpc'

const caller = { worktreeId: 'repo::/lead', terminalHandle: 'term_1' }

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes))
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const png = (width: number, height: number) =>
  b64([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    0,
    0,
    0,
    13,
    73,
    72,
    68,
    82,
    ...be32(width),
    ...be32(height)
  ])
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255]
const ascii = (text: string) => [...text].map((one) => one.charCodeAt(0))
const webpVp8x = (width: number, height: number) =>
  b64([
    ...ascii('RIFF'),
    0,
    0,
    0,
    0,
    ...ascii('WEBPVP8X'),
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...le24(width - 1),
    ...le24(height - 1)
  ])

const replying = (result: unknown) => {
  const sendRequest = vi.fn(
    async () => ({ id: 'x', ok: true, result, _meta: { runtimeId: 'rt' } }) as RpcResponse
  )
  return { client: { sendRequest } as unknown as RpcClient, sendRequest }
}

describe('readTeamSceneArtImage', () => {
  it("reads one image of the lead's scene with its size, as the desktop panel asks for it", async () => {
    const contentBase64 = png(1024, 896)
    const { client, sendRequest } = replying({ contentBase64, mimeType: 'image/png' })
    await expect(readTeamSceneArtImage(client, caller, 'mario', 'sky.png')).resolves.toEqual({
      uri: `data:image/png;base64,${contentBase64}`,
      width: 1024,
      height: 896
    })
    expect(sendRequest).toHaveBeenCalledWith('game.sceneArt', {
      ...caller,
      sceneId: 'mario',
      src: 'sky.png'
    })
  })

  it('reads the size of an extended WebP', async () => {
    const { client } = replying({ contentBase64: webpVp8x(640, 352), mimeType: 'image/webp' })
    await expect(readTeamSceneArtImage(client, caller, 'mario', 'sky.webp')).resolves.toMatchObject(
      {
        width: 640,
        height: 352
      }
    )
  })

  it('rejects a reply that is not an image it can size, or a refusal', async () => {
    for (const result of [
      { contentBase64: png(4, 4), mimeType: 'image/gif' },
      { contentBase64: '' },
      null
    ]) {
      const { client } = replying(result)
      await expect(readTeamSceneArtImage(client, caller, 'mario', 'a.png')).rejects.toThrow()
    }
    const sendRequest = vi.fn(async () => ({
      id: 'x',
      ok: false,
      error: { code: 'forbidden', message: 'forbidden' },
      _meta: { runtimeId: 'rt' }
    }))
    await expect(
      readTeamSceneArtImage({ sendRequest } as unknown as RpcClient, caller, 'mario', 'a.png')
    ).rejects.toThrow()
  })
})
