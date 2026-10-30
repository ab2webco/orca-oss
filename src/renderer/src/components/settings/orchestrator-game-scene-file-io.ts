import type { SshMutationExpectation } from '../../../../shared/ssh-types'
import {
  ORCHESTRATOR_GAME_SCENE_PHASES,
  parseOrchestratorGameScene
} from '../../../../shared/orchestrator-game-scene'
import {
  ORCHESTRATOR_GAME_SCENE_FILE_DIR,
  orchestratorGameSceneFileCandidates,
  orchestratorGameSceneFileId
} from '../../../../shared/orchestrator-game-scene-file'
import type {
  Costume,
  Look,
  SceneCast,
  SceneCharacter,
  SceneDefinition
} from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import { joinPath } from '../../lib/path'
import { translate } from '@/i18n/i18n'

/** The part of `window.api.fs` a project's scene file needs; SSH goes through `connectionId`. */
export type SceneFileFs = {
  readFile: (args: {
    filePath: string
    connectionId?: string
  }) => Promise<{ content: string; isBinary: boolean }>
  pathExists: (args: { filePath: string; connectionId?: string }) => Promise<boolean>
  createFile: (
    args: { filePath: string; connectionId?: string } & SshMutationExpectation
  ) => Promise<void>
  writeFile: (
    args: { filePath: string; content: string; connectionId?: string } & SshMutationExpectation
  ) => Promise<void>
}

export type SceneFileRead =
  | { status: 'ok'; definition: SceneDefinition }
  | { status: 'invalid' | 'unreadable'; message: string }

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

const lookText = (look: Look): Record<string, unknown> => ({
  ...look,
  skyTop: hex(look.skyTop),
  skyBottom: hex(look.skyBottom),
  sun: hex(look.sun),
  far: hex(look.far),
  snow: hex(look.snow),
  near: hex(look.near),
  ground: hex(look.ground),
  plant: hex(look.plant),
  cloud: hex(look.cloud)
})

const colorsText = (colors: Readonly<Record<string, number>>): Record<string, string> =>
  Object.fromEntries(Object.entries(colors).map(([glyph, color]) => [glyph, hex(color)]))

const costumeText = (costume: Costume): Record<string, unknown> => ({
  rows: costume.rows,
  legs: costume.legs,
  colors: colorsText(costume.colors)
})

const castText = (cast: SceneCast): Record<string, unknown> => ({
  ...(cast.pet ? { pet: { ...cast.pet, colors: colorsText(cast.pet.colors) } } : {}),
  ...(cast.advisor ? { advisor: { ...cast.advisor, colors: colorsText(cast.advisor.colors) } } : {})
})

const characterText = ({ name, variant, costumes }: SceneCharacter): Record<string, unknown> => ({
  name,
  ...(variant
    ? {
        variant: {
          ...variant,
          ...(variant.colors ? { colors: colorsText(variant.colors) } : {}),
          ...(variant.accessoryColor === undefined
            ? {}
            : { accessoryColor: hex(variant.accessoryColor) })
        }
      }
    : {}),
  ...(costumes ? { costumes: byPhase(costumes, costumeText) } : {})
})

// Why: a file writes each look in its roster entry; the definition carries the looks apart.
const rosterText = (scene: SceneDefinition): unknown[] | undefined =>
  scene.roster?.map((name) => {
    const character = scene.characters?.find(
      (one) => JSON.stringify(one.name) === JSON.stringify(name)
    )
    return character ? characterText(character) : name
  })

const byPhase = <T>(
  values: Record<string, T>,
  of: (value: T) => unknown
): Record<string, unknown> =>
  Object.fromEntries(ORCHESTRATOR_GAME_SCENE_PHASES.map((phase) => [phase, of(values[phase] as T)]))

/** A scene as a hand-editable file: colors as `#rrggbb`, no id (the file's path is its id). */
export function sceneFileTextOf(scene: SceneDefinition): string {
  const file = {
    looks: byPhase(scene.looks, lookText),
    costumes: byPhase(scene.costumes, costumeText),
    cards: scene.cards,
    teller: scene.teller,
    band: scene.band,
    ...(scene.foe ? { foe: costumeText(scene.foe) } : {}),
    ...(scene.finale ? { finale: scene.finale } : {}),
    ...(scene.hud
      ? {
          hud: Object.fromEntries(
            Object.entries(scene.hud).map(([key, color]) => [key, hex(color)])
          )
        }
      : {}),
    ...(scene.cast ? { cast: castText(scene.cast) } : {}),
    ...(scene.roster ? { roster: rosterText(scene) } : {})
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Writes `text` to the first free `.orca/scenes/<sceneId>[-n].json` and returns that path. */
export async function createOrchestratorGameSceneFile(args: {
  fs: SceneFileFs
  rootPath: string
  connectionId?: string
  expectation?: SshMutationExpectation
  sceneId: string
  text: string
}): Promise<string> {
  const target = { connectionId: args.connectionId, ...args.expectation }
  for (const path of orchestratorGameSceneFileCandidates(args.sceneId)) {
    const filePath = joinPath(args.rootPath, path)
    try {
      // Why createFile first: it fails on an existing file, so a user's scene is never overwritten.
      await args.fs.createFile({ filePath, ...target })
    } catch (error) {
      if (await args.fs.pathExists({ filePath, connectionId: args.connectionId })) {
        continue
      }
      throw error
    }
    await args.fs.writeFile({ filePath, content: args.text, ...target })
    return path
  }
  throw new Error('Every scene file name is taken')
}

/** The part of `window.api.fs` that lists a project's scene folder. */
export type SceneDirFs = {
  readDir: (args: {
    dirPath: string
    connectionId?: string
  }) => Promise<{ name: string; isDirectory: boolean; isSymlink: boolean }[]>
}

/** The `.orca/scenes/*.json` files of a project as worktree paths; none when the folder is missing. */
export async function listOrchestratorGameSceneFiles(args: {
  fs: SceneDirFs
  rootPath: string
  connectionId?: string
}): Promise<string[]> {
  try {
    const entries = await args.fs.readDir({
      dirPath: joinPath(args.rootPath, ORCHESTRATOR_GAME_SCENE_FILE_DIR),
      connectionId: args.connectionId
    })
    return entries
      .filter((entry) => !entry.isDirectory && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => `${ORCHESTRATOR_GAME_SCENE_FILE_DIR}/${entry.name}`)
      .sort()
  } catch {
    return []
  }
}

export async function readOrchestratorGameSceneFile(args: {
  fs: SceneFileFs
  rootPath: string
  connectionId?: string
  path: string
}): Promise<SceneFileRead> {
  let text: string
  try {
    const read = await args.fs.readFile({
      filePath: joinPath(args.rootPath, args.path),
      connectionId: args.connectionId
    })
    if (read.isBinary) {
      return {
        status: 'unreadable',
        message: translate(
          'auto.components.settings.OrchestratorGameSetting.sceneFileNotText',
          'not a text file'
        )
      }
    }
    text = read.content
  } catch (error) {
    return { status: 'unreadable', message: messageOf(error) }
  }
  const parsed = parseOrchestratorGameScene(text, orchestratorGameSceneFileId(args.path))
  return parsed.ok
    ? { status: 'ok', definition: parsed.definition }
    : { status: 'invalid', message: parsed.error }
}
