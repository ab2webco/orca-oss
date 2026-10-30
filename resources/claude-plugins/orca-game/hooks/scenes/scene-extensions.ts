import type { GameSceneExtension, GameState } from '../../types'
import { isShape, str } from '../game-state-shapes'
import { sceneDefinitionOf } from './scene-shape'

const MAX_SCENES = 256
// Orca namespaces a contributed id as `<pluginId>/<id>`, so it can never shadow a built-in scene.
const SCENE_ID = /^[a-z0-9-]+\.[a-z0-9-]+\/[a-z0-9-]+$/
// A project's own scene file arrives as `file:<path in the worktree>` from the `file` source.
const FILE_SCENE_SOURCE = 'file'
const MAX_FILE_SCENE_PATH = 512
const isFileSceneId = (id: string): boolean => {
  const path = id.startsWith('file:') ? id.slice('file:'.length) : ''
  return (
    path.length > 0 &&
    path.length <= MAX_FILE_SCENE_PATH &&
    [...path].every((one) => (one.codePointAt(0) ?? 0) > 0x1f && one !== '\u007f')
  )
}

const sceneOf = (value: unknown): GameSceneExtension[] => {
  if (!isShape(value)) {
    return []
  }
  const id = str(value.id)
  const pluginId = str(value.pluginId)
  if (id === undefined || pluginId === undefined) {
    return []
  }
  const isFile = pluginId === FILE_SCENE_SOURCE && isFileSceneId(id)
  if (!isFile && !(SCENE_ID.test(id) && id.startsWith(`${pluginId}/`))) {
    return []
  }
  const definition = sceneDefinitionOf(value.definition, id)
  return definition === undefined ? [] : [{ id, pluginId, definition }]
}

export const extensionsOf = (value: unknown): GameState['extensions'] => {
  const scenes = isShape(value) && Array.isArray(value.scenes) ? value.scenes : []
  return { scenes: scenes.slice(0, MAX_SCENES).flatMap(sceneOf) }
}
