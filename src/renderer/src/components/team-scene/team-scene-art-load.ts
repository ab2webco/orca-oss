import {
  orchestratorGameSceneArtFiles,
  type OrchestratorGameSceneNativeStyle
} from '../../../../shared/orchestrator-game-scene-native'
import type { TeamSceneArtImage, TeamSceneImageArt } from './team-scene-image-painter'

async function decodeImage(url: string): Promise<TeamSceneArtImage> {
  const image = new Image()
  image.src = url
  await image.decode()
  return createImageBitmap(image)
}

// Why all at once: the canvas paints only when asked under reduced motion, so art that arrived
// late would stay undrawn; the format's 16 MP cap bounds what a style can hold.
/** Rejects if any image is missing or broken: a style is drawn whole or falls to Pixel. */
export async function loadTeamSceneArt(
  style: OrchestratorGameSceneNativeStyle,
  urlOf: (src: string) => string | undefined,
  decode: (url: string) => Promise<TeamSceneArtImage> = decodeImage
): Promise<TeamSceneImageArt> {
  const entries = await Promise.all(
    orchestratorGameSceneArtFiles({ figures: style }).map(async (src) => {
      const url = urlOf(src)
      if (url === undefined) {
        throw new Error(`no image for ${src}`)
      }
      return [src, await decode(url)] as const
    })
  )
  return { style, images: new Map(entries) }
}
