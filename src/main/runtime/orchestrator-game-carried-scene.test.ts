import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sceneFile } from '../../shared/__fixtures__/orchestrator-game-scene'
import { readLeadGameScene } from './orchestrator-game-carried-scene'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function checkout(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-carried-scene-'))
  dirs.push(dir)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const MARIO = JSON.stringify(sceneFile({}))
const read = (path: string, local?: Record<string, string>) =>
  readLeadGameScene({
    settings: local ? { orchestratorGameProjects: { repo1: local } } : undefined,
    worktree: { repoId: 'repo1', path, connectionId: null }
  })

describe('readLeadGameScene', () => {
  it("returns the lead's scene file as written, under its scene id", async () => {
    const root = checkout({ '.orca/mario-bros.json': MARIO })

    await expect(read(root, { sceneFile: '.orca/mario-bros.json' })).resolves.toEqual({
      id: 'file:.orca/mario-bros.json',
      text: MARIO
    })
  })

  it('returns nothing when the lead draws no scene file', async () => {
    await expect(read(checkout({}))).resolves.toBeNull()
  })

  it.each([
    ['missing', {}],
    ['invalid', { '.orca/mario-bros.json': '{ looks:' }]
  ])('returns nothing for a %s scene file', async (_label, files) => {
    await expect(read(checkout(files), { sceneFile: '.orca/mario-bros.json' })).resolves.toBeNull()
  })
})
