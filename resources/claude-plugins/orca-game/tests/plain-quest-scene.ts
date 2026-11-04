import { QUEST_SCENE } from '../hooks/scenes/quest'
import type { SceneDefinition } from '../hooks/scenes/index'

// Quest without the pet, foe and finale it gained in ORCA-968: the frames renderer tests always pinned.
const { foe: _foe, finale: _finale, cast, ...rest } = QUEST_SCENE
export const PLAIN_QUEST: SceneDefinition = { ...rest, cast: { advisor: cast?.advisor } }
