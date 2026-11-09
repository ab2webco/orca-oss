import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  publishTeamSceneArtHost,
  readTeamSceneArtUrl,
  teamSceneArtHostKeyOf,
  useTeamSceneArtHostStore,
  type TeamSceneArtHost
} from './team-scene-art-host'

vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))

const HOST: TeamSceneArtHost = {
  target: { kind: 'environment', environmentId: 'env-1' },
  caller: { worktreeId: 'wt1', terminalHandle: 'h1' }
}

describe('team scene art host', () => {
  beforeEach(() => {
    vi.mocked(callRuntimeRpc).mockReset()
    useTeamSceneArtHostStore.setState({ host: null })
  })

  it("asks the lead's own host for the image with the lead's caller", async () => {
    vi.mocked(callRuntimeRpc).mockResolvedValue({ contentBase64: 'iVBO', mimeType: 'image/png' })

    await expect(
      readTeamSceneArtUrl(HOST, 'file:.orca/scenes/a.json', 'art/sky.png')
    ).resolves.toBe('data:image/png;base64,iVBO')
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      HOST.target,
      'game.sceneArt',
      {
        worktreeId: 'wt1',
        terminalHandle: 'h1',
        sceneId: 'file:.orca/scenes/a.json',
        src: 'art/sky.png'
      },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it('rejects a reply that is not an image, so the style draws the default art', async () => {
    vi.mocked(callRuntimeRpc).mockResolvedValue({ contentBase64: 'x', mimeType: 'text/html' })
    await expect(readTeamSceneArtUrl(HOST, 'quest', 'a.png')).rejects.toThrow()
    vi.mocked(callRuntimeRpc).mockResolvedValue({})
    await expect(readTeamSceneArtUrl(HOST, 'quest', 'a.png')).rejects.toThrow()
  })

  it('keeps one host value while the poller publishes the same one again', () => {
    publishTeamSceneArtHost(HOST)
    const first = useTeamSceneArtHostStore.getState().host
    publishTeamSceneArtHost({ ...HOST, caller: { ...HOST.caller } })
    expect(useTeamSceneArtHostStore.getState().host).toBe(first)
    publishTeamSceneArtHost({ ...HOST, caller: { worktreeId: 'wt2', terminalHandle: 'h2' } })
    expect(useTeamSceneArtHostStore.getState().host?.caller.worktreeId).toBe('wt2')
  })

  it('keys a host by its target and caller', () => {
    expect(teamSceneArtHostKeyOf(null)).toBe('none')
    expect(teamSceneArtHostKeyOf(HOST)).not.toBe(
      teamSceneArtHostKeyOf({ ...HOST, target: { kind: 'local' } })
    )
  })
})
