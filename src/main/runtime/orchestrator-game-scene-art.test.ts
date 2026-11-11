import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readGameSceneArt } from './orchestrator-game-scene-art'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function checkout(files: Record<string, Buffer | string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-scene-art-rpc-'))
  dirs.push(dir)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const IMAGE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
const ID = 'file:.orca/scenes/space.json'
const YAML = 'orchestratorGame:\n  sceneFile: .orca/scenes/space.json\n'

const read = (path: string, sceneId: string, settings?: Record<string, unknown>) =>
  readGameSceneArt({
    settings,
    worktree: { repoId: 'repo1', path, connectionId: null },
    sceneId,
    src: 'art/sky.png'
  })

describe('readGameSceneArt', () => {
  it("serves an image of the scene file the worktree's game config draws", async () => {
    const root = checkout({
      'orca.yaml': YAML,
      '.orca/scenes/space.json': '{}',
      '.orca/scenes/art/sky.png': IMAGE
    })
    await expect(read(root, ID)).resolves.toEqual({
      contentBase64: IMAGE.toString('base64'),
      mimeType: 'image/png'
    })
  })

  it('follows the project settings layer, as game.state does', async () => {
    const root = checkout({ '.orca/scenes/space.json': '{}', '.orca/scenes/art/sky.png': IMAGE })
    const settings = {
      orchestratorGameProjects: { repo1: { sceneFile: '.orca/scenes/space.json' } }
    }
    await expect(read(root, ID, settings)).resolves.toMatchObject({ mimeType: 'image/png' })
  })

  it('refuses a scene id the worktree does not draw, so a caller cannot pick any folder', async () => {
    const root = checkout({
      'orca.yaml': YAML,
      '.orca/other/sky.png': IMAGE,
      '.orca/scenes/art/sky.png': IMAGE
    })
    await expect(read(root, 'file:.orca/other/scene.json')).rejects.toThrow(
      'is not the scene this worktree draws'
    )
  })

  it('refuses when the worktree draws no scene file', async () => {
    const root = checkout({ '.orca/scenes/art/sky.png': IMAGE })
    await expect(read(root, 'quest')).rejects.toThrow('is not the scene this worktree draws')
  })
})
