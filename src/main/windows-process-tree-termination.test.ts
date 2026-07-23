import { afterEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import { terminateWindowsProcessTree } from './windows-process-tree-termination'

afterEach(() => {
  execFileMock.mockReset()
})

describe('terminateWindowsProcessTree', () => {
  it.each([0, -1, 1.5, Number.NaN])('ignores invalid pid %s', async (pid) => {
    await terminateWindowsProcessTree(pid)

    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('waits for taskkill to terminate the root and descendants', async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null) => void
      callback(null)
    })

    await terminateWindowsProcessTree(12345)

    expect(execFileMock).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/pid', '12345', '/T', '/F'],
      expect.objectContaining({ timeout: 5_000, windowsHide: true }),
      expect.any(Function)
    )
  })

  it('rejects when taskkill cannot terminate the tree', async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null) => void
      callback(new Error('taskkill failed'))
    })

    await expect(terminateWindowsProcessTree(12345)).rejects.toThrow('taskkill failed')
  })
})
