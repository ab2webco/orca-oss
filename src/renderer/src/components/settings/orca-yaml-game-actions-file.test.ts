import { describe, expect, it, vi } from 'vitest'
import { readOrcaYamlGameActions, writeOrcaYamlGameActions } from './orca-yaml-game-actions-file'

const fsWith = (files: Record<string, string>) => {
  const fs = {
    readFile: vi.fn(async ({ filePath }: { filePath: string }) => {
      if (!(filePath in files)) {
        throw new Error('ENOENT')
      }
      return { content: files[filePath]!, isBinary: false }
    }),
    pathExists: vi.fn(async ({ filePath }: { filePath: string }) => filePath in files),
    createFile: vi.fn(async ({ filePath }: { filePath: string }) => {
      files[filePath] = ''
    }),
    writeFile: vi.fn(async ({ filePath, content }: { filePath: string; content: string }) => {
      files[filePath] = content
    })
  }
  return { fs, files }
}

const DEPLOY = [{ label: 'Deploy', command: 'deploy', prompt: 'Ship it' }]

describe("orca.yaml's game actions, read and written from Settings", () => {
  it('reads a missing file as empty, and creates it on the first write', async () => {
    const { fs, files } = fsWith({})
    const read = await readOrcaYamlGameActions({ fs, rootPath: '/repo' })
    expect(read).toEqual({ text: '', actions: [] })
    await writeOrcaYamlGameActions({ fs, rootPath: '/repo', shown: '', actions: DEPLOY })
    expect(fs.createFile).toHaveBeenCalledTimes(1)
    expect(files['/repo/orca.yaml']).toBe(
      'orchestratorGame:\n  actions:\n    - label: Deploy\n      command: deploy\n      prompt: Ship it\n'
    )
  })

  it('refuses when the file changed since Settings showed it, and writes nothing', async () => {
    const { fs } = fsWith({ '/repo/orca.yaml': '# edited elsewhere\n' })
    await expect(
      writeOrcaYamlGameActions({ fs, rootPath: '/repo', shown: '', actions: DEPLOY })
    ).rejects.toThrow('changed')
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('refuses a file it cannot edit, and keeps an SSH write bound to its connection', async () => {
    const { fs } = fsWith({ '/repo/orca.yaml': 'scripts: [unclosed' })
    await expect(
      writeOrcaYamlGameActions({
        fs,
        rootPath: '/repo',
        shown: 'scripts: [unclosed',
        actions: DEPLOY
      })
    ).rejects.toThrow('invalid')
    const ssh = fsWith({ '/srv/orca.yaml': '' })
    const expectation = { expectedSshTargetId: 't1', expectedSshConnectionGeneration: 2 }
    await writeOrcaYamlGameActions({
      fs: ssh.fs,
      rootPath: '/srv',
      connectionId: 'c1',
      expectation,
      shown: '',
      actions: DEPLOY
    })
    expect(ssh.fs.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'c1', ...expectation })
    )
  })
})
