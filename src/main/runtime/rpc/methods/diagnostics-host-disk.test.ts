import type * as ChildProcess from 'node:child_process'
import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { gameHostMachineOf } from '../../../../shared/orchestrator-game-host-capacity'
import type { MemorySnapshot } from '../../../../shared/process-stats-types'
import { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { DIAGNOSTICS_METHODS } from './diagnostics'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null), getAllWindows: vi.fn(() => []) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getAppMetrics: vi.fn(() => []), getPath: vi.fn(() => os.tmpdir()) }
}))

// Why: the process sweep is not what this pins, and a real one differs on every OS.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  exec: (_cmd: string, _opts: unknown, cb: (e: Error | null, out: unknown) => void) =>
    cb(null, { stdout: '', stderr: '' })
}))

const store = {
  getRepo: () => undefined,
  getWorktreeMeta: () => undefined,
  getSettings: () => ({ workspaceDir: os.tmpdir() })
} as unknown as ConstructorParameters<typeof OrcaRuntimeService>[0]

describe('diagnostics.memory as a paired client reads it from a host', () => {
  it("carries the disk of that host's own workspaces folder and its CPU use", async () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux')
    const runtime = new OrcaRuntimeService(store)
    const dispatcher = new RpcDispatcher({ runtime, methods: DIAGNOSTICS_METHODS })
    const request: RpcRequest = { id: 'req-1', authToken: 'tok', method: 'diagnostics.memory' }

    const response = (await dispatcher.dispatch(request)) as { ok: true; result: MemorySnapshot }
    const machine = gameHostMachineOf(JSON.parse(JSON.stringify(response.result)).host)

    expect(response.ok).toBe(true)
    expect(machine?.workspaceDiskTotal).toBeGreaterThan(0)
    expect(machine?.workspaceDiskFree).toBeGreaterThanOrEqual(0)
    expect(machine?.cpuUsagePercent).toBeGreaterThanOrEqual(0)
  })
})
