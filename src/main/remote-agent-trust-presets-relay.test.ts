import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { realpathRelayPath, statRelayPath } from '../relay/fs-path-metadata-requests'
import { writeVerifiedTerminalArtifact } from '../relay/fs-handler-terminal-artifact'

const mocks = vi.hoisted(() => ({
  getActiveMultiplexer: vi.fn(),
  getSshFilesystemProvider: vi.fn()
}))

vi.mock('./ipc/ssh', () => ({ getActiveMultiplexer: mocks.getActiveMultiplexer }))
vi.mock('./providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: mocks.getSshFilesystemProvider
}))

const { markRemoteClaudeFolderTrusted } = await import('./remote-agent-trust-presets')

// Why: the relay's own handlers on a real file prove the stat identity this client sends matches the one the relay checks.
describe('markRemoteClaudeFolderTrusted against the relay fs handlers (ORCA-792)', () => {
  let home: string

  beforeEach(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'orca-792-remote-')))
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: home }))
    })
    mocks.getSshFilesystemProvider.mockReturnValue({
      stat: (filePath: string) => statRelayPath({ filePath }),
      realpath: (filePath: string) => realpathRelayPath({ filePath }),
      readFile: async (filePath: string) => ({
        content: await readFile(filePath, 'utf8'),
        isBinary: false
      }),
      writeTerminalArtifact: async (
        filePath: string,
        content: string,
        options: Record<string, unknown>
      ) => (await writeVerifiedTerminalArtifact({ filePath, content, ...options })).stat
    })
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')(
    'keeps a 0600 config at 0600 with its other keys',
    async () => {
      const configPath = join(home, '.claude.json')
      await writeFile(configPath, JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } }))
      await chmod(configPath, 0o600)

      await expect(
        markRemoteClaudeFolderTrusted({ connectionId: 'ssh-1', workspacePath: home })
      ).resolves.toBe(true)

      expect((await stat(configPath)).mode & 0o777).toBe(0o600)
      const config = JSON.parse(await readFile(configPath, 'utf8'))
      expect(config.oauthAccount).toEqual({ emailAddress: 'a@b.c' })
      expect(config.projects[home].hasTrustDialogAccepted).toBe(true)
    }
  )
})
