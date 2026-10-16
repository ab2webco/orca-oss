import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime/types'
import { ORCHESTRATOR_GAME_BUILT_IN_SCENES } from '../../shared/orchestrator-game-config'
import {
  ORCHESTRATOR_GAME_SCENE_TEMPLATE,
  orchestratorGameSceneIssues
} from '../../shared/orchestrator-game-scene-authoring'
import { ORCHESTRATOR_GAME_SCENE_MAX_BYTES } from '../../shared/orchestrator-game-scene'
import { ORCHESTRATOR_GAME_SCENE_FILE_DIR } from '../../shared/orchestrator-game-scene-file'

function writeStdout(value: string): void {
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
}

const slashed = (path: string): string => path.split(sep).join('/')

/** The same refusals Orca applies when it reads a scene file, so a valid file here draws there. */
async function issuesOfFile(file: string): Promise<string[]> {
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) {
    return ['not found']
  }
  if (info.size > ORCHESTRATOR_GAME_SCENE_MAX_BYTES) {
    return [`larger than ${ORCHESTRATOR_GAME_SCENE_MAX_BYTES / 1024} KB`]
  }
  return orchestratorGameSceneIssues(await readFile(file, 'utf8'))
}

// Why walk up: an agent may run this from any folder of the project.
function projectRootOf(cwd: string): string | null {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const scenes = join(dir, ...ORCHESTRATOR_GAME_SCENE_FILE_DIR.split('/'))
    if (existsSync(scenes) && statSync(scenes).isDirectory()) {
      return dir
    }
    if (dirname(dir) === dir) {
      return null
    }
  }
}

export const ORCHESTRATOR_GAME_SCENE_HANDLERS: Record<string, CommandHandler> = {
  'game scene new': async ({ flags, cwd, json }) => {
    const path = getRequiredStringFlag(flags, 'path')
    const file = resolve(cwd, path)
    await mkdir(dirname(file), { recursive: true })
    try {
      // Why 'wx': a scene someone already edited is never overwritten.
      await writeFile(file, ORCHESTRATOR_GAME_SCENE_TEMPLATE, { flag: 'wx' })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        throw new RuntimeClientError(
          'invalid_argument',
          `${path} already exists; pick another name`
        )
      }
      throw error
    }
    writeStdout(
      json
        ? JSON.stringify({ file: path, created: true }, null, 2)
        : `Created ${path} from the built-in Quest scene.\n` +
            `Edit it, then run: orca game scene validate ${path}`
    )
  },

  'game scene validate': async ({ flags, cwd, json }) => {
    const path = getRequiredStringFlag(flags, 'file')
    const issues = await issuesOfFile(resolve(cwd, path))
    if (issues.length > 0) {
      process.exitCode = 1
    }
    writeStdout(
      json
        ? JSON.stringify({ file: path, valid: issues.length === 0, issues }, null, 2)
        : issues.length === 0
          ? `${path}: valid — Orca and the game will draw it`
          : [`${path}: ${issues.length} problem(s)`, ...issues.map((one) => `  ${one}`)].join('\n')
    )
  },

  'game scene list': async ({ cwd, json }) => {
    const root = projectRootOf(cwd)
    const dir = root ? join(root, ...ORCHESTRATOR_GAME_SCENE_FILE_DIR.split('/')) : null
    const names = dir ? (await readdir(dir)).filter((name) => name.endsWith('.json')).sort() : []
    const files = await Promise.all(
      names.map(async (name) => {
        const file = join(dir as string, name)
        const issues = await issuesOfFile(file)
        return {
          sceneFile: slashed(relative(root as string, file)),
          valid: issues.length === 0,
          issues
        }
      })
    )
    const builtIn = [...ORCHESTRATOR_GAME_BUILT_IN_SCENES]
    if (json) {
      writeStdout(JSON.stringify({ builtIn, files }, null, 2))
      return
    }
    writeStdout(
      [
        `Built-in (orchestratorGame.scene): ${builtIn.join(', ')}`,
        files.length === 0
          ? `No scene files in ${ORCHESTRATOR_GAME_SCENE_FILE_DIR}/ (start one: orca game scene new ${ORCHESTRATOR_GAME_SCENE_FILE_DIR}/<name>.json)`
          : 'Project files (orchestratorGame.sceneFile):',
        ...files.map(
          (one) => `  ${one.sceneFile}  ${one.valid ? 'valid' : `${one.issues.length} problem(s)`}`
        )
      ].join('\n')
    )
  }
}
