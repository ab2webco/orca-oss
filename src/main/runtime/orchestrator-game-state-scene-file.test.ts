import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  byScenePhase,
  sceneFile,
  sceneLook
} from '../../shared/__fixtures__/orchestrator-game-scene'
import {
  registerSshFilesystemProvider,
  unregisterSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from '../providers/types'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  unregisterSshFilesystemProvider('ssh-1')
})

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-scene-file-'))
  dirs.push(dir)
  return dir
}

function checkout(files: Record<string, string>): string {
  const dir = temp()
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const none = async () => null
const ID = 'file:.orca/scenes/space.json'
const SPACE = JSON.stringify(
  sceneFile({ looks: byScenePhase({ ...sceneLook, skyTop: '#102030' }) })
)

function build(
  path: string,
  options: {
    local?: Record<string, string>
    connectionId?: string
    carried?: { id: string; text: string }
  } = {}
): ReturnType<typeof buildOrchestratorGameState> {
  return buildOrchestratorGameState({
    settings: options.local ? { orchestratorGameProjects: { repo1: options.local } } : undefined,
    worktree: {
      id: 'wt1',
      repoId: 'repo1',
      connectionId: options.connectionId ?? null,
      path,
      branch: 'feat/game',
      displayName: 'Game',
      linkedWorkItem: null
    },
    agents: [],
    leaderPaneKey: null,
    readReview: none,
    readPlane: none,
    readLinear: none,
    ...(options.carried ? { readCarriedScene: () => options.carried ?? null } : {})
  })
}

describe('buildOrchestratorGameState scene file', () => {
  it("serves orca.yaml's scene file as the effective scene, its hex colors as integers", async () => {
    const state = await build(
      checkout({
        'orca.yaml': 'orchestratorGame:\n  scene: jrpg\n  sceneFile: .orca/scenes/space.json\n',
        '.orca/scenes/space.json': SPACE
      })
    )

    expect(state.config.scene).toBe(ID)
    expect(state.sources.scene).toBe('project')
    expect(state.warnings).toEqual([])
    expect(state.extensions?.scenes).toHaveLength(1)
    expect(state.extensions?.scenes[0]).toMatchObject({ id: ID, pluginId: 'file' })
    expect(state.extensions?.scenes[0]?.definition.id).toBe(ID)
    expect(state.extensions?.scenes[0]?.definition.looks.pr.skyTop).toBe(0x102030)
  })

  it('draws a scene file whose pet is invalid without its pet, and says why', async () => {
    const state = await build(
      checkout({
        '.orca/scenes/space.json': JSON.stringify(sceneFile({ cast: { pet: { frames: [] } } }))
      }),
      { local: { sceneFile: '.orca/scenes/space.json' } }
    )

    expect(state.config.scene).toBe(ID)
    expect(state.extensions?.scenes[0]?.definition.cast).toBeUndefined()
    expect(state.warnings[0]).toMatch(
      /^Scene file \.orca\/scenes\/space\.json: cast\.pet\.frames: .+; drawn without it$/
    )
  })

  it('reads the file again on every build, so an edit shows without a restart', async () => {
    const root = checkout({ '.orca/scenes/space.json': SPACE })
    const local = { sceneFile: '.orca/scenes/space.json' }
    expect((await build(root, { local })).extensions?.scenes[0]?.definition.looks.pr.skyTop).toBe(
      0x102030
    )

    writeFileSync(
      join(root, '.orca/scenes/space.json'),
      JSON.stringify(sceneFile({ looks: byScenePhase({ ...sceneLook, skyTop: '#405060' }) }))
    )
    expect((await build(root, { local })).extensions?.scenes[0]?.definition.looks.pr.skyTop).toBe(
      0x405060
    )
  })

  it.each([
    [
      'an invalid scene',
      { '.orca/scenes/space.json': JSON.stringify(sceneFile({ band: 1 })) },
      'Scene file .orca/scenes/space.json: band: '
    ],
    [
      'text that is not JSON',
      { '.orca/scenes/space.json': '{ looks:' },
      'Scene file .orca/scenes/space.json: not valid JSON; drawing Quest'
    ],
    ['a missing file', {}, 'Scene file .orca/scenes/space.json: not found; drawing Quest'],
    [
      'a file over the size limit',
      { '.orca/scenes/space.json': ' '.repeat(64 * 1024 + 1) },
      'Scene file .orca/scenes/space.json: larger than 64 KB; drawing Quest'
    ]
  ])('draws Quest and says why for %s', async (_label, files, warning) => {
    const state = await build(checkout(files), {
      local: { sceneFile: '.orca/scenes/space.json' }
    })

    expect(state.config.scene).toBe('quest')
    expect(state.extensions?.scenes).toEqual([])
    expect(state.warnings[0]).toContain(warning)
  })

  it('refuses a scene file that is a link out of the worktree', async () => {
    const outside = checkout({ 'space.json': SPACE })
    const root = checkout({})
    mkdirSync(join(root, '.orca/scenes'), { recursive: true })
    symlinkSync(join(outside, 'space.json'), join(root, '.orca/scenes/space.json'))

    const state = await build(root, { local: { sceneFile: '.orca/scenes/space.json' } })

    expect(state.config.scene).toBe('quest')
    expect(state.warnings[0]).toBe(
      'Scene file .orca/scenes/space.json: resolves outside the worktree; drawing Quest'
    )
  })

  it("reads an SSH worktree's scene file from its host", async () => {
    const reads: string[] = []
    // Why: only the reads the scene file needs are implemented.
    const host = {
      realpath: async (path: string) => path,
      readFile: async (path: string) => {
        reads.push(path)
        if (path !== '/srv/repo/.orca/scenes/space.json') {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
        return { content: SPACE, isBinary: false }
      }
    } as IFilesystemProvider
    registerSshFilesystemProvider('ssh-1', host)

    const state = await build('/srv/repo', {
      connectionId: 'ssh-1',
      local: { sceneFile: '.orca/scenes/space.json' }
    })

    expect(reads).toContain('/srv/repo/.orca/scenes/space.json')
    expect(state.config.scene).toBe(ID)
    expect(state.extensions?.scenes.map((one) => one.id)).toEqual([ID])
  })

  it('draws Quest and says so while the SSH host is disconnected', async () => {
    const state = await build('/srv/repo', {
      connectionId: 'ssh-1',
      local: { sceneFile: '.orca/scenes/space.json' }
    })

    expect(state.config.scene).toBe('quest')
    expect(state.warnings[0]).toBe(
      'Scene file .orca/scenes/space.json: the SSH host is not connected; drawing Quest'
    )
  })

  describe("a remote member's scene from its lead", () => {
    const LEAD = 'file:.orca/mario-bros.json'
    const carried = { id: LEAD, text: SPACE }

    it('draws it when the worktree names no scene file', async () => {
      const state = await build(checkout({}), { carried })

      expect(state.config.scene).toBe(LEAD)
      expect(state.warnings).toEqual([])
      expect(state.extensions?.scenes.map((one) => one.id)).toEqual([LEAD])
      expect(state.extensions?.scenes[0]?.definition.looks.pr.skyTop).toBe(0x102030)
    })

    it('draws it instead of Quest when the named file is missing', async () => {
      const state = await build(checkout({}), {
        local: { sceneFile: '.orca/scenes/space.json' },
        carried
      })

      expect(state.config.scene).toBe(LEAD)
      expect(state.warnings).toEqual([])
    })

    it("keeps the worktree's own scene file when it reads", async () => {
      const state = await build(checkout({ '.orca/scenes/space.json': SPACE }), {
        local: { sceneFile: '.orca/scenes/space.json' },
        carried
      })

      expect(state.config.scene).toBe(ID)
      expect(state.extensions?.scenes.map((one) => one.id)).toEqual([ID])
    })

    it('falls back as before when the carried scene does not parse', async () => {
      const state = await build(checkout({}), {
        local: { sceneFile: '.orca/scenes/space.json' },
        carried: { id: LEAD, text: '{ looks:' }
      })

      expect(state.config.scene).toBe('quest')
      expect(state.warnings[0]).toBe('Scene file .orca/scenes/space.json: not found; drawing Quest')
    })
  })
})
