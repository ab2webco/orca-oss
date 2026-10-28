import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sceneFile } from '../../shared/__fixtures__/orchestrator-game-scene'
import { OrcaRuntimeService } from './orca-runtime'
import { OrchestrationDb } from './orchestration/db'

const SCENE_ID = 'file:.orca/mario-bros.json'
const MARIO = JSON.stringify(sceneFile({}))

describe("a remote game member's scene from its lead (ORCA-794)", () => {
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

  function withWorktree(runtime: OrcaRuntimeService, id: string, path: string): void {
    vi.spyOn(
      runtime as unknown as { getResolvedWorktreeMap: () => Promise<Map<string, unknown>> },
      'getResolvedWorktreeMap'
    ).mockResolvedValue(new Map([[id, { id, repoId: 'repo1', path, branch: 'main' }]]))
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
})
