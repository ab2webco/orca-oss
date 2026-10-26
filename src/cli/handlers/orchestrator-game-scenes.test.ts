import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCHESTRATOR_GAME_SCENE_TEMPLATE } from '../../shared/orchestrator-game-scene-authoring'
import type { RuntimeClient } from '../runtime-client'
import { ORCHESTRATOR_GAME_SCENE_HANDLERS } from './orchestrator-game-scenes'

// Why: these commands never reach the runtime, so any call is a bug.
const offline = {
  call: async () => {
    throw new Error('no runtime call expected')
  }
} as unknown as RuntimeClient

describe('orca game scene', () => {
  let dir = ''
  let out = ''
  const run = (command: string, cwd: string, flags: Record<string, string>, json = false) =>
    ORCHESTRATOR_GAME_SCENE_HANDLERS[command]({
      flags: new Map(Object.entries(flags)),
      client: offline,
      cwd,
      json
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-scene-cli-'))
    out = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk)
      return true
    })
    process.exitCode = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
    process.exitCode = undefined
  })

  it('new writes the template under the given path and refuses to overwrite it', async () => {
    await run('game scene new', dir, { path: '.orca/scenes/space.json' })

    const file = join(dir, '.orca', 'scenes', 'space.json')
    expect(readFileSync(file, 'utf8')).toBe(ORCHESTRATOR_GAME_SCENE_TEMPLATE)
    expect(out).toContain('orca game scene validate .orca/scenes/space.json')

    writeFileSync(file, '{"mine": true}')
    await expect(run('game scene new', dir, { path: '.orca/scenes/space.json' })).rejects.toThrow(
      'already exists'
    )
    expect(readFileSync(file, 'utf8')).toBe('{"mine": true}')
  })

  it('validate says a good scene is ready and lists every problem of a bad one', async () => {
    writeFileSync(join(dir, 'good.json'), ORCHESTRATOR_GAME_SCENE_TEMPLATE)
    await run('game scene validate', dir, { file: 'good.json' })
    expect(out).toContain('good.json: valid')
    expect(process.exitCode).toBeUndefined()

    const bad = JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE)
    bad.looks.pr.sun = 'gold'
    delete bad.band.ink
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(bad))
    out = ''
    await run('game scene validate', dir, { file: 'bad.json' }, true)
    expect(JSON.parse(out)).toEqual({
      file: 'bad.json',
      valid: false,
      issues: [
        'looks.pr.sun: must be a #rrggbb color or an integer from 0 to 16777215',
        'band.ink: Invalid input: expected string, received undefined'
      ]
    })
    expect(process.exitCode).toBe(1)
  })

  it('validate names the failing key of a broken 3D block and passes a good one', async () => {
    const scene = JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE) as Record<string, unknown>
    writeFileSync(
      join(dir, 'good3d.json'),
      JSON.stringify({ ...scene, scene3d: { figure: 'torus', nodes: 800 } })
    )
    await run('game scene validate', dir, { file: 'good3d.json' })
    expect(out).toContain('good3d.json: valid')
    expect(process.exitCode).toBeUndefined()

    out = ''
    writeFileSync(
      join(dir, 'bad3d.json'),
      JSON.stringify({ ...scene, scene3d: { figure: 'torus', nodes: 5000 } })
    )
    await run('game scene validate', dir, { file: 'bad3d.json' })
    expect(out).toContain('bad3d.json: 1 problem(s)')
    expect(out).toContain('  scene3d.nodes: must be a whole number from 50 to 1600')
    expect(process.exitCode).toBe(1)
  })

  it('validate refuses a file too large for Orca to read', async () => {
    writeFileSync(join(dir, 'big.json'), ' '.repeat(70 * 1024))
    await run('game scene validate', dir, { file: 'big.json' })
    expect(out).toContain('larger than 64 KB')
    expect(process.exitCode).toBe(1)
  })

  it('list names the built-in scenes and the project files with how to select each', async () => {
    const scenes = join(dir, '.orca', 'scenes')
    mkdirSync(scenes, { recursive: true })
    writeFileSync(join(scenes, 'ok.json'), ORCHESTRATOR_GAME_SCENE_TEMPLATE)
    writeFileSync(join(scenes, 'broken.json'), '{')
    mkdirSync(join(dir, 'src'))

    await run('game scene list', join(dir, 'src'), {}, true)

    expect(JSON.parse(out)).toEqual({
      builtIn: ['quest', 'vigilante', 'jrpg', 'tamer'],
      files: [
        { sceneFile: '.orca/scenes/broken.json', valid: false, issues: ['not valid JSON'] },
        { sceneFile: '.orca/scenes/ok.json', valid: true, issues: [] }
      ]
    })
  })
})
