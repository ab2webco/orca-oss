import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IFilesystemProvider } from './providers/types'

const localFs = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      localFs.calls.push(`readFile:${String(args[0])}`)
      return actual.readFile(...args)
    },
    stat: (...args: Parameters<typeof actual.stat>) => {
      localFs.calls.push(`stat:${String(args[0])}`)
      return actual.stat(...args)
    },
    readdir: (...args: Parameters<typeof actual.readdir>) => {
      localFs.calls.push(`readdir:${String(args[0])}`)
      return actual.readdir(...args)
    }
  }
})

const { createLocalProjectFileReader, createRemoteProjectFileReader } =
  await import('./project-file-reader')
const { detectProjectCommands } = await import('../shared/project-command-detection')

function fakeProvider(
  files: Record<string, string>,
  dirs: Record<string, { name: string; isDirectory: boolean }[]>
): IFilesystemProvider {
  const provider: Partial<IFilesystemProvider> = {
    readFile: async (filePath) => {
      const content = files[filePath]
      if (content === undefined) {
        throw new Error(`ENOENT: ${filePath}`)
      }
      return { content, isBinary: content.startsWith('\0') }
    },
    stat: async (filePath) => {
      if (files[filePath] !== undefined) {
        return { size: files[filePath].length, type: 'file', mtime: 0 }
      }
      if (dirs[filePath]) {
        return { size: 0, type: 'directory', mtime: 0 }
      }
      throw new Error(`ENOENT: ${filePath}`)
    },
    readDir: async (dirPath) => {
      const entries = dirs[dirPath]
      if (!entries) {
        throw new Error(`ENOENT: ${dirPath}`)
      }
      return entries.map((entry) => ({ ...entry, isSymlink: false }))
    }
  }
  return provider as IFilesystemProvider
}

describe('createRemoteProjectFileReader', () => {
  beforeEach(() => {
    localFs.calls.length = 0
  })

  it('reads files, existence and directories through the provider only', async () => {
    const reader = createRemoteProjectFileReader(
      '/srv/repo',
      fakeProvider(
        { '/srv/repo/Makefile': 'test:\n\tpytest\n', '/srv/repo/bin/setup': '#!/bin/sh' },
        {
          '/srv/repo': [
            { name: 'Makefile', isDirectory: false },
            { name: 'bin', isDirectory: true }
          ],
          '/srv/repo/bin': [{ name: 'setup', isDirectory: false }]
        }
      )
    )

    await expect(reader.readFile('Makefile')).resolves.toBe('test:\n\tpytest\n')
    await expect(reader.readFile('missing')).resolves.toBeNull()
    await expect(reader.fileExists('bin/setup')).resolves.toBe(true)
    await expect(reader.fileExists('bin')).resolves.toBe(false)
    await expect(reader.fileExists('missing')).resolves.toBe(false)
    await expect(reader.readDir('')).resolves.toEqual([
      { name: 'Makefile', isDirectory: false },
      { name: 'bin', isDirectory: true }
    ])
    await expect(reader.readDir('bin')).resolves.toEqual([{ name: 'setup', isDirectory: false }])
    await expect(reader.readDir('missing')).resolves.toBeNull()
    expect(localFs.calls).toEqual([])
  })

  it('joins Windows remote paths with backslashes', async () => {
    const reader = createRemoteProjectFileReader(
      'C:\\repo',
      fakeProvider({ 'C:\\repo\\scripts\\build.sh': 'echo' }, {})
    )

    await expect(reader.readFile('scripts/build.sh')).resolves.toBe('echo')
  })

  it('treats binary content as unreadable', async () => {
    const reader = createRemoteProjectFileReader('/r', fakeProvider({ '/r/blob': '\0\0' }, {}))

    await expect(reader.readFile('blob')).resolves.toBeNull()
  })

  it('detects commands in an SSH repo from the remote host without reading the local disk', async () => {
    const reader = createRemoteProjectFileReader(
      '/srv/repo',
      fakeProvider(
        {
          '/srv/repo/Makefile': 'test:\n\tpytest\n',
          '/srv/repo/package.json': '{"scripts":{"lint":"ruff"}}',
          '/srv/repo/yarn.lock': ''
        },
        {
          '/srv/repo': [
            { name: 'Makefile', isDirectory: false },
            { name: 'package.json', isDirectory: false },
            { name: 'yarn.lock', isDirectory: false }
          ]
        }
      )
    )

    await expect(detectProjectCommands(reader)).resolves.toEqual([
      expect.objectContaining({ source: 'package-json', run: 'yarn run lint' }),
      expect.objectContaining({ source: 'makefile', run: 'make test' })
    ])
    expect(localFs.calls).toEqual([])
  })

  it('reads nothing when the SSH provider is not connected', async () => {
    const reader = createRemoteProjectFileReader('/srv/repo', undefined)

    await expect(reader.readFile('Makefile')).resolves.toBeNull()
    await expect(reader.fileExists('Makefile')).resolves.toBe(false)
    await expect(reader.readDir('')).resolves.toBeNull()
    expect(localFs.calls).toEqual([])
  })
})

describe('createLocalProjectFileReader', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-project-file-reader-'))
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'package.json'), '{"scripts":{}}')
    await writeFile(join(root, 'scripts', 'lint.sh'), 'echo lint')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads files, existence and directories from the local disk', async () => {
    const reader = createLocalProjectFileReader(root)

    await expect(reader.readFile('package.json')).resolves.toBe('{"scripts":{}}')
    await expect(reader.readFile('missing.json')).resolves.toBeNull()
    await expect(reader.fileExists('scripts/lint.sh')).resolves.toBe(true)
    await expect(reader.fileExists('scripts')).resolves.toBe(false)
    await expect(reader.fileExists('missing')).resolves.toBe(false)
    const entries = await reader.readDir('')
    expect(entries?.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'package.json', isDirectory: false },
      { name: 'scripts', isDirectory: true }
    ])
    await expect(reader.readDir('missing')).resolves.toBeNull()
  })
})
