import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ markRemoteClaudeFolderTrusted: vi.fn() }))

vi.mock('../remote-agent-trust-presets', () => ({
  markRemoteClaudeFolderTrusted: mocks.markRemoteClaudeFolderTrusted
}))

const { ensureClaudeFolderTrustForSpawn } = await import('./pty-claude-folder-trust')

describe('ensureClaudeFolderTrustForSpawn over SSH (ORCA-792)', () => {
  beforeEach(() => {
    mocks.markRemoteClaudeFolderTrusted.mockReset()
  })

  function spawn(requireTrust: boolean): Promise<void> {
    return ensureClaudeFolderTrustForSpawn({
      cwd: '/remote/wt',
      workspaceRoot: '/remote/wt',
      connectionId: 'ssh-1',
      env: { CLAUDE_CONFIG_DIR: '/home/u/vault' },
      requireTrust
    })
  }

  it('trusts the workspace in the config dir the remote pane is pointed at', async () => {
    mocks.markRemoteClaudeFolderTrusted.mockResolvedValue(true)

    await spawn(true)

    expect(mocks.markRemoteClaudeFolderTrusted).toHaveBeenCalledWith({
      connectionId: 'ssh-1',
      workspacePath: '/remote/wt',
      configDir: '/home/u/vault'
    })
  })

  it('refuses a worker launch by name when the remote trust could not be written', async () => {
    mocks.markRemoteClaudeFolderTrusted.mockRejectedValue(new Error('relay down'))

    await expect(spawn(true)).rejects.toThrow(
      'Claude Code has not accepted the folder trust for /remote/wt'
    )
  })

  it('lets an interactive launch through to Claude own prompt', async () => {
    mocks.markRemoteClaudeFolderTrusted.mockResolvedValue(false)

    await expect(spawn(false)).resolves.toBeUndefined()
  })
})
