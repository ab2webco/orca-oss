import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActiveMultiplexer: vi.fn(),
  getSshFilesystemProvider: vi.fn()
}))

vi.mock('./ipc/ssh', () => ({
  getActiveMultiplexer: mocks.getActiveMultiplexer
}))

vi.mock('./providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: mocks.getSshFilesystemProvider
}))

const { markRemoteAgentWorkspaceTrusted, markRemoteClaudeFolderTrusted } =
  await import('./remote-agent-trust-presets')

function makeFsProvider(overrides: Record<string, unknown> = {}) {
  return {
    realpath: vi.fn(async (path: string) => `/real${path}`),
    readFile: vi.fn(async () => ({ content: '', isBinary: false })),
    createDir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    stat: vi.fn(async () => {
      throw new Error('missing')
    }),
    ...overrides
  }
}

describe('markRemoteAgentWorkspaceTrusted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: '/home/u/' }))
    })
  })

  it('writes Codex trust to the remote home and canonicalized workspace path', async () => {
    const fsProvider = makeFsProvider()
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'codex',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    expect(mocks.getActiveMultiplexer).toHaveBeenCalledWith('ssh-1')
    expect(fsProvider.realpath).toHaveBeenCalledWith('/repo/worktree')
    expect(fsProvider.createDir).toHaveBeenCalledWith('/home/u/.codex')
    expect(fsProvider.writeFile).toHaveBeenCalledWith(
      '/home/u/.codex/config.toml',
      expect.stringContaining('[projects."/real/repo/worktree"]')
    )
  })

  it('writes Codex trust when the remote home is a Windows absolute path', async () => {
    const fsProvider = makeFsProvider({
      realpath: vi.fn(async () => 'C:/Users/alice/platform')
    })
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: 'C:\\Users\\alice\\' }))
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'codex',
      connectionId: 'ssh-windows',
      workspacePath: 'C:\\Users\\alice\\platform'
    })

    expect(fsProvider.createDir).toHaveBeenCalledWith('C:/Users/alice/.codex')
    expect(fsProvider.writeFile).toHaveBeenCalledWith(
      'C:/Users/alice/.codex/config.toml',
      expect.stringContaining('[projects."C:/Users/alice/platform"]')
    )
  })

  it('writes Cursor trust marker on the remote host', async () => {
    const fsProvider = makeFsProvider()
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'cursor',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    expect(fsProvider.createDir).toHaveBeenCalledWith('/home/u/.cursor/projects/real-repo-worktree')
    expect(fsProvider.writeFile).toHaveBeenCalledWith(
      '/home/u/.cursor/projects/real-repo-worktree/.workspace-trusted',
      expect.stringContaining('"workspacePath": "/real/repo/worktree"')
    )
  })

  it('sanitizes Windows path characters in remote Cursor trust marker paths', async () => {
    const fsProvider = makeFsProvider({
      realpath: vi.fn(async () => 'C:/Users/alice/platform')
    })
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: 'C:/Users/alice/' }))
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'cursor',
      connectionId: 'ssh-windows',
      workspacePath: 'C:\\Users\\alice\\platform'
    })

    expect(fsProvider.createDir).toHaveBeenCalledWith(
      'C:/Users/alice/.cursor/projects/C-Users-alice-platform'
    )
    expect(fsProvider.writeFile).toHaveBeenCalledWith(
      'C:/Users/alice/.cursor/projects/C-Users-alice-platform/.workspace-trusted',
      expect.stringContaining('"workspacePath": "C:/Users/alice/platform"')
    )
  })

  it('appends Copilot trusted folder remotely without clobbering config keys', async () => {
    const writeFile = vi.fn(async (_filePath: string, _content: string) => undefined)
    const fsProvider = makeFsProvider({
      readFile: vi.fn(async () => ({
        content: JSON.stringify({ firstLaunchAt: '2026-01-01', trustedFolders: ['/old'] }),
        isBinary: false
      })),
      writeFile
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'copilot',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    expect(fsProvider.createDir).toHaveBeenCalledWith('/home/u/.copilot')
    const written = writeFile.mock.calls[0]?.[1]
    expect(typeof written).toBe('string')
    expect(JSON.parse(written as string)).toEqual({
      firstLaunchAt: '2026-01-01',
      trustedFolders: ['/old', '/real/repo/worktree']
    })
  })

  it('does nothing when the SSH home cannot be resolved safely', async () => {
    const fsProvider = makeFsProvider()
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: 'relative/home' }))
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'codex',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    expect(fsProvider.writeFile).not.toHaveBeenCalled()
  })

  it.each(['codex', 'copilot'] as const)(
    'leaves the remote %s config untouched when the read fails',
    async (preset) => {
      const fsProvider = makeFsProvider({
        readFile: vi.fn(async () => {
          throw new Error('file stream stalled')
        })
      })
      mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

      await expect(
        markRemoteAgentWorkspaceTrusted({ preset, connectionId: 'ssh-1', workspacePath: '/repo' })
      ).rejects.toThrow()

      expect(fsProvider.writeFile).not.toHaveBeenCalled()
    }
  )

  it.each(['codex', 'copilot'] as const)(
    'leaves the remote %s config untouched when the read comes back binary',
    async (preset) => {
      const fsProvider = makeFsProvider({
        readFile: vi.fn(async () => ({ content: 'AAEC', isBinary: true }))
      })
      mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

      await expect(
        markRemoteAgentWorkspaceTrusted({ preset, connectionId: 'ssh-1', workspacePath: '/repo' })
      ).rejects.toThrow()

      expect(fsProvider.writeFile).not.toHaveBeenCalled()
    }
  )

  it('creates the remote Codex config when the relay reports it missing', async () => {
    // The relay rebuilds remote errors without Node's .code; only the message survives.
    const fsProvider = makeFsProvider({
      readFile: vi.fn(async () => {
        throw new Error("ENOENT: no such file or directory, stat '/home/u/.codex/config.toml'")
      })
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'codex',
      connectionId: 'ssh-1',
      workspacePath: '/repo'
    })

    expect(fsProvider.writeFile).toHaveBeenCalledWith(
      '/home/u/.codex/config.toml',
      '[projects."/real/repo"]\ntrust_level = "trusted"\n'
    )
  })
})

describe('markRemoteClaudeFolderTrusted', () => {
  const CONFIG_STAT = { size: 17, type: 'file', mtime: 5, mtimeMs: 5, dev: 1, ino: 2, nlink: 1 }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: '/home/u/' }))
    })
  })

  /** A remote host whose Claude config already exists, so the relay can replace it in place. */
  function claudeHost(overrides: Record<string, unknown> = {}) {
    return {
      ...makeFsProvider({
        readFile: vi.fn(async () => ({ content: '{"numStartups":4}', isBinary: false })),
        stat: vi.fn(async () => CONFIG_STAT)
      }),
      writeTerminalArtifact: vi.fn(async (..._args: unknown[]) => CONFIG_STAT),
      ...overrides
    }
  }

  function replacedConfig(
    fsProvider: ReturnType<typeof claudeHost>,
    call = 0
  ): {
    path: string
    options: { expectedRealPath: string; expectedStatIdentity: string | null }
    config: { numStartups?: number; projects: Record<string, { hasTrustDialogAccepted: boolean }> }
  } {
    const [path, content, options] = fsProvider.writeTerminalArtifact.mock.calls[
      call
    ] as unknown as [
      string,
      string,
      { expectedRealPath: string; expectedStatIdentity: string | null }
    ]
    return { path, options, config: JSON.parse(content) }
  }

  it('replaces the config through the relay write that keeps its mode, never a plain write', async () => {
    const fsProvider = claudeHost()
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await expect(
      markRemoteClaudeFolderTrusted({ connectionId: 'ssh-1', workspacePath: '/repo/worktree' })
    ).resolves.toBe(true)

    const { path, options, config } = replacedConfig(fsProvider)
    expect(path).toBe('/real/home/u/.claude.json')
    expect(options).toMatchObject({
      expectedRealPath: '/real/home/u/.claude.json',
      expectedStatIdentity: '1:2:1:17:5'
    })
    expect(config.numStartups).toBe(4)
    expect(config.projects['/real/repo/worktree'].hasTrustDialogAccepted).toBe(true)
    expect(fsProvider.writeFile).not.toHaveBeenCalled()
    expect(fsProvider.rename).not.toHaveBeenCalled()
  })

  it('re-reads and merges again when a running Claude saved the config in between', async () => {
    const reads = ['{"numStartups":4}', '{"numStartups":5,"tipsHistory":{"a":1}}']
    const fsProvider = claudeHost({
      readFile: vi.fn(async () => ({ content: reads.shift() ?? '', isBinary: false })),
      writeTerminalArtifact: vi
        .fn()
        .mockRejectedValueOnce(new Error('terminal_file_grant_stale'))
        .mockResolvedValueOnce(CONFIG_STAT)
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await expect(
      markRemoteClaudeFolderTrusted({ connectionId: 'ssh-1', workspacePath: '/repo/worktree' })
    ).resolves.toBe(true)

    const { config } = replacedConfig(fsProvider, 1)
    expect(config).toMatchObject({ numStartups: 5, tipsHistory: { a: 1 } })
    expect(config.projects['/real/repo/worktree'].hasTrustDialogAccepted).toBe(true)
  })

  it('gives up instead of overwriting when the config keeps changing', async () => {
    const fsProvider = claudeHost({
      writeTerminalArtifact: vi.fn(async () => {
        throw new Error('terminal_file_grant_stale')
      })
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await expect(
      markRemoteClaudeFolderTrusted({ connectionId: 'ssh-1', workspacePath: '/repo/worktree' })
    ).resolves.toBe(false)
    expect(fsProvider.writeFile).not.toHaveBeenCalled()
  })

  it('never creates a missing config, since no relay write can make it 0600', async () => {
    const fsProvider = claudeHost({
      stat: vi.fn(async () => {
        throw new Error('ENOENT: no such file or directory, stat')
      })
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await expect(
      markRemoteClaudeFolderTrusted({ connectionId: 'ssh-1', workspacePath: '/repo/worktree' })
    ).resolves.toBe(false)
    expect(fsProvider.writeFile).not.toHaveBeenCalled()
    expect(fsProvider.writeTerminalArtifact).not.toHaveBeenCalled()
  })

  it('writes into the config dir the remote pane is pointed at', async () => {
    const fsProvider = claudeHost()
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteClaudeFolderTrusted({
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree',
      configDir: '/home/u/vaults/work'
    })

    expect(replacedConfig(fsProvider).path).toBe('/real/home/u/vaults/work/.claude.json')
  })

  it('keys a Windows remote worktree with forward slashes', async () => {
    const fsProvider = claudeHost({ realpath: vi.fn(async (path: string) => path) })
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: 'C:\\Users\\alice\\' }))
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteClaudeFolderTrusted({
      connectionId: 'ssh-windows',
      workspacePath: 'C:\\Users\\alice\\wt'
    })

    const { path, config } = replacedConfig(fsProvider)
    expect(path).toBe('C:/Users/alice/.claude.json')
    expect(config.projects['C:/Users/alice/wt'].hasTrustDialogAccepted).toBe(true)
  })

  it('leaves a remote config it cannot parse untouched', async () => {
    const fsProvider = claudeHost({
      readFile: vi.fn(async () => ({ content: '{not json', isBinary: false }))
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await expect(
      markRemoteClaudeFolderTrusted({ connectionId: 'ssh-1', workspacePath: '/repo/worktree' })
    ).resolves.toBe(false)
    expect(fsProvider.writeTerminalArtifact).not.toHaveBeenCalled()
  })
})
