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

import { OrcaRuntimeService } from './orca-runtime'

userData.dir = mkdtempSync(join(tmpdir(), 'orca-effort-plan-runtime-'))
afterAll(() => rmSync(userData.dir, { recursive: true, force: true }))

// Why the cast: the project a caller resolves to needs live panes; the store under it is real.
type Internals = {
  gameBoardProjectOf: () => Promise<{ key: string; isMember: boolean }>
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
