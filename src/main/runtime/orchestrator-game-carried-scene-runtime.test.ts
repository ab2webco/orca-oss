import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sceneFile } from '../../shared/__fixtures__/orchestrator-game-scene'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'

const SCENE_ID = 'file:.orca/mario-bros.json'
const MARIO = JSON.stringify(sceneFile({}))

describe("a game member's scene from its lead (ORCA-794, ORCA-870)", () => {
  const dirs: string[] = []
  const databases: OrchestrationDb[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
    for (const database of databases.splice(0)) {
      database.close()
    }
    vi.restoreAllMocks()
  })

  function checkout(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'orca-game-carried-runtime-'))
    dirs.push(dir)
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
    return dir
  }

  function withWorktrees(runtime: OrcaRuntimeService, paths: Record<string, string>): void {
    vi.spyOn(
      runtime as unknown as { getResolvedWorktreeMap: () => Promise<Map<string, unknown>> },
      'getResolvedWorktreeMap'
    ).mockResolvedValue(
      new Map(
        Object.entries(paths).map(([id, path]) => [
          id,
          { id, repoId: 'repo1', path, branch: 'main' }
        ])
      )
    )
  }

  function withWorktree(runtime: OrcaRuntimeService, id: string, path: string): void {
    withWorktrees(runtime, { [id]: path })
  }

  it("reads the scene file the lead's pane draws", async () => {
    const runtime = new OrcaRuntimeService(null)
    const lead = checkout({
      'orca.yaml': 'orchestratorGame:\n  sceneFile: .orca/mario-bros.json\n',
      '.orca/mario-bros.json': MARIO
    })
    withWorktree(runtime, 'wt-lead', lead)
    vi.spyOn(runtime, 'showTerminal').mockResolvedValue({ worktreeId: 'wt-lead' } as never)

    await expect(runtime.readCallerGameScene('term_lead')).resolves.toEqual({
      id: SCENE_ID,
      text: MARIO
    })
  })

  it("draws the carried scene in the member's band on the host", async () => {
    const runtime = new OrcaRuntimeService(null)
    const db = new OrchestrationDb(':memory:')
    databases.push(db)
    runtime.setOrchestrationDb(db)
    db.createRemoteDispatchAttachment({
      dispatchId: 'ctx_member',
      taskId: 'task_member',
      homePeerFingerprint: 'fp_mac',
      protocolVersion: 3,
      runtimeEpoch: 'epoch',
      gameScene: { id: SCENE_ID, text: MARIO },
      mutationReceipt: {
        callerFingerprint: 'fp_mac',
        requestId: 'request_member',
        method: 'orchestration.federationAttachStart',
        payloadHash: 'hash'
      }
    })
    db.recordRemoteAttachmentStage({
      dispatchId: 'ctx_member',
      stage: 'remote_input_accepted',
      worktreeId: 'wt-member'
    })
    withWorktree(runtime, 'wt-member', checkout({}))
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({ worktrees: [] } as never)

    const state = await runtime.getOrchestratorGameState({ worktreeId: 'wt-member' })

    expect(state.config.scene).toBe(SCENE_ID)
    expect(state.extensions?.scenes.map((one) => one.id)).toEqual([SCENE_ID])
  })

  // The lead's scene file is untracked, so a local member's own worktree has no copy.
  it("draws a local member's band in its lead's scene when its worktree lacks the file", async () => {
    const runtime = new OrcaRuntimeService(null)
    const yaml = 'orchestratorGame:\n  sceneFile: .orca/mario-bros.json\n'
    withWorktrees(runtime, {
      'wt-lead': checkout({ 'orca.yaml': yaml, '.orca/mario-bros.json': MARIO }),
      'wt-member': checkout({ 'orca.yaml': yaml })
    })
    vi.spyOn(runtime, 'getWorktreePs').mockResolvedValue({
      worktrees: [
        { worktreeId: 'wt-lead', agents: [{ paneKey: 'pane-lead' }] },
        {
          worktreeId: 'wt-member',
          agents: [{ paneKey: 'pane-member', parentPaneKey: 'pane-lead' }]
        }
      ]
    } as never)
    vi.spyOn(
      runtime as unknown as { getTerminalHandleForPaneKey: (paneKey: string) => string | null },
      'getTerminalHandleForPaneKey'
    ).mockImplementation((paneKey) => (paneKey === 'pane-lead' ? 'term_lead' : null))
    vi.spyOn(runtime, 'showTerminal').mockImplementation(
      async (handle) => ({ worktreeId: handle === 'term_lead' ? 'wt-lead' : 'wt-member' }) as never
    )

    const state = await runtime.getOrchestratorGameState({
      worktreeId: 'wt-member',
      paneKey: 'pane-member'
    })

    expect(state.role).toBe('member')
    expect(state.config.scene).toBe(SCENE_ID)
    expect(state.warnings).toEqual([])
    expect(state.extensions?.scenes.map((one) => one.id)).toEqual([SCENE_ID])
  })
})
