import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES } from '../shared/orchestrator-game-scene-native'
import {
  registerSshFilesystemProvider,
  unregisterSshFilesystemProvider
} from './providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from './providers/types'
import { readWorktreeGameSceneArt } from './worktree-game-scene-file'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  unregisterSshFilesystemProvider('ssh-1')
})

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-scene-art-'))
  dirs.push(dir)
  return dir
}

/** A PNG header is all the dimension reader needs. */
const png = (bytes = 33): Buffer => {
  const out = Buffer.alloc(bytes)
  out.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  out.writeUInt32BE(16, 16)
  out.writeUInt32BE(16, 20)
  return out
}

function checkout(files: Record<string, Buffer | string>): string {
  const dir = temp()
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

const SCENE = '.orca/scenes/space.json'

describe('readWorktreeGameSceneArt', () => {
  it('reads an image next to the scene file as base64', async () => {
    const image = png()
    const root = checkout({ [SCENE]: '{}', '.orca/scenes/art/sky.png': image })

    await expect(readWorktreeGameSceneArt(root, null, SCENE, 'art/sky.png')).resolves.toEqual({
      contentBase64: image.toString('base64'),
      mimeType: 'image/png'
    })
  })

  it.each(['../space.json', '/etc/passwd', 'art/sky.gif'])('refuses the path %s', async (src) => {
    const root = checkout({ [SCENE]: '{}' })
    await expect(readWorktreeGameSceneArt(root, null, SCENE, src)).rejects.toThrow()
  })

  it('refuses a link that leaves the scene folder, even inside the worktree', async () => {
    const root = checkout({ [SCENE]: '{}', 'secret.png': png() })
    mkdirSync(join(root, '.orca/scenes/art'), { recursive: true })
    symlinkSync(join(root, 'secret.png'), join(root, '.orca/scenes/art/sky.png'))

    await expect(readWorktreeGameSceneArt(root, null, SCENE, 'art/sky.png')).rejects.toThrow(
      'resolves outside the scene folder'
    )
  })

  it('refuses a file over the size cap without reading it whole', async () => {
    const root = checkout({
      [SCENE]: '{}',
      '.orca/scenes/big.png': png(ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES + 1)
    })
    await expect(readWorktreeGameSceneArt(root, null, SCENE, 'big.png')).rejects.toThrow(
      'larger than 2 MB'
    )
  })

  it('refuses a file that is not a PNG or WebP image', async () => {
    const root = checkout({ [SCENE]: '{}', '.orca/scenes/fake.png': 'not an image' })
    await expect(readWorktreeGameSceneArt(root, null, SCENE, 'fake.png')).rejects.toThrow(
      'is not a PNG or WebP image'
    )
  })

  it('says a missing image was not found', async () => {
    const root = checkout({ [SCENE]: '{}' })
    await expect(readWorktreeGameSceneArt(root, null, SCENE, 'art/none.png')).rejects.toThrow(
      'not found'
    )
  })
})

describe('readWorktreeGameSceneArt over SSH', () => {
  /** Only the reads scene art needs; `links` maps a path to where it really resolves. */
  function sshHost(files: Record<string, Buffer>, links: Record<string, string> = {}) {
    const reads: { path: string; maxBinaryBytes?: number }[] = []
    const host = {
      realpath: async (path: string) => links[path] ?? path,
      stat: async (path: string) => {
        const file = files[path]
        if (!file) {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
        return { size: file.byteLength, type: 'file', mtime: 0 }
      },
      readFile: async (path: string, limits?: { maxBinaryBytes?: number }) => {
        reads.push({ path, maxBinaryBytes: limits?.maxBinaryBytes })
        return { content: files[path]!.toString('base64'), isBinary: true, isImage: true }
      }
    } as unknown as IFilesystemProvider
    registerSshFilesystemProvider('ssh-1', host)
    return reads
  }

  it("reads the image from the worktree's host, capped at the art limit", async () => {
    const image = png()
    const reads = sshHost({ '/srv/repo/.orca/scenes/art/sky.png': image })

    await expect(
      readWorktreeGameSceneArt('/srv/repo', 'ssh-1', SCENE, 'art/sky.png')
    ).resolves.toEqual({ contentBase64: image.toString('base64'), mimeType: 'image/png' })
    expect(reads).toEqual([
      {
        path: '/srv/repo/.orca/scenes/art/sky.png',
        maxBinaryBytes: ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES
      }
    ])
  })

  it('refuses a link on the host that leaves the scene folder', async () => {
    const reads = sshHost(
      { '/srv/repo/secret.png': png() },
      { '/srv/repo/.orca/scenes/art/sky.png': '/srv/repo/secret.png' }
    )
    await expect(
      readWorktreeGameSceneArt('/srv/repo', 'ssh-1', SCENE, 'art/sky.png')
    ).rejects.toThrow('resolves outside the scene folder')
    expect(reads).toEqual([])
  })

  it('refuses an image over the cap by its size, before reading it', async () => {
    const reads = sshHost({
      '/srv/repo/.orca/scenes/big.png': png(ORCHESTRATOR_GAME_SCENE_ART_MAX_BYTES + 1)
    })
    await expect(readWorktreeGameSceneArt('/srv/repo', 'ssh-1', SCENE, 'big.png')).rejects.toThrow(
      'larger than 2 MB'
    )
    expect(reads).toEqual([])
  })

  it('says so when the SSH host is not connected', async () => {
    await expect(
      readWorktreeGameSceneArt('/srv/repo', 'ssh-1', SCENE, 'art/sky.png')
    ).rejects.toThrow('the SSH host is not connected')
  })
})
