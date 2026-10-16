import { describe, expect, it } from 'vitest'
import { parseOrchestratorGameScene } from '../../../../shared/orchestrator-game-scene'
import { sceneFile } from '../../../../shared/__fixtures__/orchestrator-game-scene'
import { SCENES } from '../../../../../resources/claude-plugins/orca-game/hooks/scenes/index'
import {
  createOrchestratorGameSceneFile,
  readOrchestratorGameSceneFile,
  sceneFileTextOf,
  type SceneFileFs
} from './orchestrator-game-scene-file-io'

function fakeFs(files: Record<string, string>): SceneFileFs & { writes: string[] } {
  const writes: string[] = []
  return {
    writes,
    readFile: async ({ filePath }) => {
      const content = files[filePath]
      if (content === undefined) {
        throw new Error(`ENOENT: no such file, open '${filePath}'`)
      }
      return { content, isBinary: false }
    },
    pathExists: async ({ filePath }) => filePath in files,
    createFile: async ({ filePath }) => {
      if (filePath in files) {
        throw new Error('already exists')
      }
      files[filePath] = ''
    },
    writeFile: async ({ filePath, content }) => {
      writes.push(filePath)
      files[filePath] = content
    }
  }
}

describe('sceneFileTextOf', () => {
  it.each(Object.keys(SCENES))(
    'writes %s as pretty JSON with #rrggbb colors that parses back to the same scene',
    (id) => {
      const scene = SCENES[id]
      expect(scene).toBeDefined()
      const text = sceneFileTextOf(scene!)
      const parsed = parseOrchestratorGameScene(text, id)
      expect(parsed).toEqual({ ok: true, definition: scene })
      expect(text).toMatch(/^\{\n {2}"looks": \{/)
      expect(text).toMatch(/"skyTop": "#[0-9a-f]{6}"/)
      expect(text).not.toMatch(/"id":/)
      expect(text.endsWith('}\n')).toBe(true)
    }
  )
})

describe('createOrchestratorGameSceneFile', () => {
  it('writes the next free name and never touches an existing file', async () => {
    const fs = fakeFs({ '/repo/.orca/scenes/quest.json': 'mine' })
    const path = await createOrchestratorGameSceneFile({
      fs,
      rootPath: '/repo',
      sceneId: 'quest',
      text: '{}\n'
    })

    expect(path).toBe('.orca/scenes/quest-2.json')
    expect(fs.writes).toEqual(['/repo/.orca/scenes/quest-2.json'])
    expect(await fs.readFile({ filePath: '/repo/.orca/scenes/quest.json' })).toMatchObject({
      content: 'mine'
    })
  })

  it('passes the SSH connection and its expectation to every call', async () => {
    const calls: unknown[] = []
    const fs = fakeFs({})
    const path = await createOrchestratorGameSceneFile({
      fs: {
        ...fs,
        createFile: async (args) => {
          calls.push(args)
          await fs.createFile(args)
        },
        writeFile: async (args) => {
          calls.push(args)
          await fs.writeFile(args)
        }
      },
      rootPath: '/srv/repo',
      connectionId: 'ssh-1',
      expectation: { expectedSshTargetId: 'ssh-1', expectedSshConnectionGeneration: 3 },
      sceneId: 'tamer',
      text: '{}\n'
    })

    expect(path).toBe('.orca/scenes/tamer.json')
    expect(calls).toEqual([
      {
        filePath: '/srv/repo/.orca/scenes/tamer.json',
        connectionId: 'ssh-1',
        expectedSshTargetId: 'ssh-1',
        expectedSshConnectionGeneration: 3
      },
      {
        filePath: '/srv/repo/.orca/scenes/tamer.json',
        content: '{}\n',
        connectionId: 'ssh-1',
        expectedSshTargetId: 'ssh-1',
        expectedSshConnectionGeneration: 3
      }
    ])
  })

  it('stops on a failure that is not an existing file', async () => {
    const fs = fakeFs({})
    await expect(
      createOrchestratorGameSceneFile({
        fs: {
          ...fs,
          createFile: async () => {
            throw new Error('Permission denied')
          }
        },
        rootPath: '/repo',
        sceneId: 'quest',
        text: '{}\n'
      })
    ).rejects.toThrow('Permission denied')
    expect(fs.writes).toEqual([])
  })
})

describe('readOrchestratorGameSceneFile', () => {
  it('reads and validates the file with the parser Orca serves the game with', async () => {
    const fs = fakeFs({ '/repo/scenes/a.json': JSON.stringify(sceneFile()) })
    const read = await readOrchestratorGameSceneFile({
      fs,
      rootPath: '/repo',
      path: 'scenes/a.json'
    })

    expect(read.status).toBe('ok')
    expect(read.status === 'ok' ? read.definition.id : null).toBe('file:scenes/a.json')
  })

  it('tells an unreadable file from an invalid one', async () => {
    const fs = fakeFs({ '/repo/bad.json': JSON.stringify(sceneFile({ band: 1 })) })

    expect(
      await readOrchestratorGameSceneFile({ fs, rootPath: '/repo', path: 'bad.json' })
    ).toEqual({ status: 'invalid', message: expect.stringContaining('band: ') })
    expect(
      await readOrchestratorGameSceneFile({ fs, rootPath: '/repo', path: 'gone.json' })
    ).toEqual({ status: 'unreadable', message: expect.stringContaining('ENOENT') })
  })
})
