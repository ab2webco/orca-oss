import type { GameSource, GameSources } from '../types'
import { isShape, oneOf } from './game-state-shapes'

const SOURCES: readonly GameSource[] = ['default', 'global', 'project', 'local']
const SOURCE_KEYS = [
  'mode',
  'scene',
  'hud',
  'rewards',
  'tracker',
  'openLinks',
  'render',
  'timezone'
] as const satisfies readonly (keyof GameSources)[]

/** The layer each config key came from, only the keys and layers Orca names. */
export const gameSourcesOf = (value: unknown): { sources?: GameSources } => {
  if (!isShape(value)) {
    return {}
  }
  const known = SOURCE_KEYS.flatMap((key) => {
    const source = oneOf(value[key], SOURCES)
    return source === undefined ? [] : [[key, source] as const]
  })
  return known.length === 0 ? {} : { sources: Object.fromEntries(known) }
}
