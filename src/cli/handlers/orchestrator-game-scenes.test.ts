import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
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

  describe('native art', () => {
    /** A PNG header, padded; validate reads dimensions and never decodes the image. */
    const png = (width: number, height: number, bytes = 33): Buffer => {
      const out = Buffer.alloc(bytes)
      out.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
      out.writeUInt32BE(width, 16)
      out.writeUInt32BE(height, 20)
      return out
    }
    const role = {
      sheets: ['art/hero.png'],
      frame: { width: 32, height: 48 },
      size: 58,
      animations: { idle: { row: 0, frames: 2 } }
    }
    const withArt = {
      ...(JSON.parse(ORCHESTRATOR_GAME_SCENE_TEMPLATE) as Record<string, unknown>),
      native: {
        figures: { layers: [{ src: 'art/sky.png' }], roles: { lead: role, member: role } }
      }
    }
    let scenes = ''

    beforeEach(() => {
      scenes = join(dir, '.orca', 'scenes')
      mkdirSync(join(scenes, 'art'), { recursive: true })
      writeFileSync(join(scenes, 'art.json'), JSON.stringify(withArt))
    })

    it('passes a scene whose art sits next to it, however far past 64 KB the files run', async () => {
      writeFileSync(join(scenes, 'art', 'sky.png'), png(960, 352, 512 * 1024))
      writeFileSync(join(scenes, 'art', 'hero.png'), png(64, 48))

      await run('game scene validate', dir, { file: '.orca/scenes/art.json' })

      expect(statSync(join(scenes, 'art.json')).size).toBeLessThan(64 * 1024)
      expect(out).toContain('art.json: valid')
      expect(process.exitCode).toBeUndefined()
    })

    it('resolves art from the scene file, not from where the command runs', async () => {
      writeFileSync(join(scenes, 'art', 'sky.png'), png(960, 352))
      writeFileSync(join(scenes, 'art', 'hero.png'), png(64, 48))

      await run('game scene validate', scenes, { file: 'art.json' })

      expect(out).toContain('art.json: valid')
    })

    it('lists a missing file and an animation past its sheet, and exits 1', async () => {
      writeFileSync(join(scenes, 'art', 'hero.png'), png(32, 48))

      await run('game scene validate', dir, { file: '.orca/scenes/art.json' }, true)

      expect(JSON.parse(out).issues).toEqual([
        'native.figures.layers.0.src: not found',
        'native.figures.roles.lead.animations.idle: 2 frames in row 0 need art/hero.png to be at least 64x48, it is 32x48',
        'native.figures.roles.member.animations.idle: 2 frames in row 0 need art/hero.png to be at least 64x48, it is 32x48'
      ])
      expect(process.exitCode).toBe(1)
    })

    it.skipIf(process.platform === 'win32')(
      'refuses art that links out of the scene folder',
      async () => {
        writeFileSync(join(dir, 'outside.png'), png(960, 352))
        symlinkSync(join(dir, 'outside.png'), join(scenes, 'art', 'sky.png'))
        writeFileSync(join(scenes, 'art', 'hero.png'), png(64, 48))

        await run('game scene validate', dir, { file: '.orca/scenes/art.json' })

        expect(out).toContain('native.figures.layers.0.src: resolves outside the scene folder')
        expect(process.exitCode).toBe(1)
      }
    )

    it('reads a block it cannot parse as issues and touches no file', async () => {
      const broken = { ...withArt, native: { figures: { layers: [] } } }
      writeFileSync(join(scenes, 'art.json'), JSON.stringify(broken))

      await run('game scene validate', dir, { file: '.orca/scenes/art.json' }, true)

      expect(JSON.parse(out).issues.join()).toContain('native.figures.layers')
      expect(JSON.parse(out).issues.join()).not.toContain('not found')
    })

    it('list reports a scene with missing art as a problem', async () => {
      await run('game scene list', dir, {}, true)

      const listed = JSON.parse(out).files[0]
      expect(listed.valid).toBe(false)
      expect(listed.issues[0]).toContain('not found')
    })
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
