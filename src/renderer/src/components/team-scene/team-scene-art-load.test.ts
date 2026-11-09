import { describe, expect, it, vi } from 'vitest'
import type { OrchestratorGameSceneNativeStyle } from '../../../../shared/orchestrator-game-scene-native'
import { loadTeamSceneArt } from './team-scene-art-load'
import type { TeamSceneArtImage } from './team-scene-image-painter'

const role = (sheet: string): OrchestratorGameSceneNativeStyle['roles']['lead'] => ({
  sheets: [sheet],
  frame: { width: 8, height: 8 },
  size: 32,
  animations: { idle: { row: 0, frames: 1, fps: 8 } }
})

const STYLE: OrchestratorGameSceneNativeStyle = {
  layers: [{ src: 'sky.png' }],
  roles: { lead: role('sheet.png'), member: role('sheet.png') },
  props: { station: 'desk.png' }
}

const decoded = { width: 8, height: 8 } as TeamSceneArtImage

describe('loadTeamSceneArt', () => {
  it('decodes every image the style names, each once', async () => {
    const decode = vi.fn(async (_url: string) => decoded)
    const art = await loadTeamSceneArt(STYLE, (src) => `url:${src}`, decode)
    expect(decode.mock.calls.map(([url]) => url).sort()).toEqual([
      'url:desk.png',
      'url:sheet.png',
      'url:sky.png'
    ])
    expect(art.style).toBe(STYLE)
    expect([...art.images.keys()].sort()).toEqual(['desk.png', 'sheet.png', 'sky.png'])
  })

  it('fails when an image has no url', async () => {
    const decode = vi.fn(async () => decoded)
    await expect(
      loadTeamSceneArt(STYLE, (src) => (src === 'desk.png' ? undefined : src), decode)
    ).rejects.toThrow('desk.png')
  })

  it('fails when an image does not decode, so the scene falls to Pixel', async () => {
    const decode = vi.fn(async (url: string) => {
      if (url === 'sky.png') {
        throw new Error('broken')
      }
      return decoded
    })
    await expect(loadTeamSceneArt(STYLE, (src) => src, decode)).rejects.toThrow('broken')
  })
})
