import {
  orchestratorGameSceneNativeOf,
  type OrchestratorGameSceneNativeStyle
} from '../../../../shared/orchestrator-game-scene-native'
import questArt from '../../assets/quest-art/native.json'

const ROOT = '../../assets/quest-art/'

const URLS = import.meta.glob<string>('../../assets/quest-art/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
})

/** Quest's art for a style, which ships with Orca rather than in a scene file. */
export function teamSceneQuestArtOf(style: 'figures' | 'office'): OrchestratorGameSceneNativeStyle {
  const art = orchestratorGameSceneNativeOf(questArt).native?.[style]
  if (!art) {
    throw new Error(`Quest has no ${style} art`)
  }
  return art
}

export const teamSceneQuestArtUrl = (src: string): string | undefined => URLS[`${ROOT}${src}`]
