import type { GameLocale, GameMemberLaunch } from '../types'
import { gameLocale } from './game-strings'

type ModelSource = NonNullable<GameMemberLaunch['source']>

const WORDS: Readonly<Record<GameLocale, Readonly<Record<ModelSource, string>>>> = {
  en: { session: 'session', launch: 'launch' },
  es: { session: 'sesión', launch: 'lanzamiento' }
}

/** Whose word a Jev-less member's model is: its own hooks, or Orca's launch choice (ORCA-933). */
export const modelSourceWordOf = (source: ModelSource): string => WORDS[gameLocale()][source]
