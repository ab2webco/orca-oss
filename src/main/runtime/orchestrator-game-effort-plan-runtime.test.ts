import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { gameKindEffortPlanOf } from '../../shared/orchestrator-game-effort-plan'

const userData = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => userData.dir) }
}))

const yaml = vi.hoisted(() => ({ text: null as unknown, paths: [] as string[] }))
vi.mock('../worktree-orca-yaml', () => ({
  readWorktreeOrcaYaml: vi.fn(async (path: string) => {
    yaml.paths.push(path)
    return yaml.text
  })
}))

import { OrcaRuntimeService } from './orca-runtime'

userData.dir = mkdtempSync(join(tmpdir(), 'orca-effort-plan-runtime-'))
afterAll(() => rmSync(userData.dir, { recursive: true, force: true }))

// Why the cast: the project a caller resolves to needs live panes; the store under it is real.
type Internals = {
  gameBoardProjectOf: () => Promise<{ key: string; isMember: boolean }>
  gameHistoryProjectOf: () => Promise<{ key: string; worktree: unknown }>
}

const leadPlan = {
  source: 'lead' as const,
  kind: null,
  phases: [
    { phase: 'implement' as const, model: 'claude-opus-5-5', effort: 'high' as const, why: 'x' }
  ]
}

describe("a ticket's effort plan, through the runtime (ORCA-1242)", () => {
  it('lets the lead write it, its member read it, and refuses a member write', async () => {
    const runtime = new OrcaRuntimeService(null)
    const project = vi.spyOn(runtime as unknown as Internals, 'gameBoardProjectOf')
    project.mockResolvedValue({ key: 'repo:plan-1', isMember: false })
    await runtime.recordGameMember({
      member: {
        ticket: 'ORCA-7',
        runId: 'run_1',
        taskId: 'task_7',
        effortPlan: gameKindEffortPlanOf('implement')
      }
    })
    await expect(runtime.gameEffortPlan({ ticket: 'orca-7', plan: leadPlan })).resolves.toEqual({
      ticket: 'ORCA-7',
      known: true,
      plan: leadPlan
    })

    project.mockResolvedValue({ key: 'repo:plan-1', isMember: true })
    await expect(runtime.gameEffortPlan({ ticket: 'ORCA-7' })).resolves.toEqual({
      ticket: 'ORCA-7',
      known: true,
      plan: leadPlan
    })
    await expect(
      runtime.gameEffortPlan({ ticket: 'ORCA-7', plan: { ...leadPlan, phases: [] } })
    ).rejects.toThrow('Only the lead writes a ticket plan.')
  })
})

describe("the steward's high-risk paths on the plan read (ORCA-1242 PR 3c)", () => {
  it("answers the paths the member worktree's orca.yaml adds, and none without any", async () => {
    const runtime = new OrcaRuntimeService(null)
    vi.spyOn(runtime as unknown as Internals, 'gameBoardProjectOf').mockResolvedValue({
      key: 'repo:plan-2',
      isMember: true
    })
    vi.spyOn(runtime as unknown as Internals, 'gameHistoryProjectOf').mockResolvedValue({
      key: 'repo:plan-2',
      worktree: { path: '/w/member', repoId: 'r2' }
    })
    yaml.text = { orchestratorGame: { steward: { highRiskPaths: ['src/main/runtime/'] } } }
    await expect(runtime.gameEffortPlan({ ticket: 'ORCA-8' })).resolves.toEqual({
      ticket: 'ORCA-8',
      known: false,
      plan: null,
      highRiskPaths: ['src/main/runtime/']
    })
    expect(yaml.paths.at(-1)).toBe('/w/member')
    yaml.text = null
    await expect(runtime.gameEffortPlan({ ticket: 'ORCA-8' })).resolves.not.toHaveProperty(
      'highRiskPaths'
    )
  })
})
