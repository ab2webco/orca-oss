import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from './client'
import { withMainHangRecord } from './main-hang-record-hint'
import { RuntimeClientError } from './types'

const TIMEOUT_MESSAGE = 'Timed out waiting for the Orca Lab runtime to respond.'

const PID = process.pid

describe('withMainHangRecord', () => {
  let userData: string
  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'hang-hint-'))
    mkdirSync(join(userData, 'logs'))
  })
  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  const timeout = (): RuntimeClientError =>
    new RuntimeClientError('runtime_timeout', TIMEOUT_MESSAGE)
  const record = (name: string, text: string): string => {
    const path = join(userData, 'logs', name)
    writeFileSync(path, text)
    return path
  }
  const hint = (capture = vi.fn(), timeoutMs = 60_000, error: unknown = timeout()) => ({
    capture,
    error: withMainHangRecord(
      error,
      { userDataPath: userData, pid: PID, method: 'status.get', timeoutMs },
      capture
    ) as RuntimeClientError
  })

  it('names the newest open record for the runtime pid without capturing again', () => {
    record(`main-hang-${PID}-2026-11-19T22-21-00-000Z.txt`, 'older')
    const newest = record(`main-hang-${PID}-2026-11-19T22-22-05-000Z.txt`, 'stalled')
    record('main-hang-1-2026-11-19T23-00-00-000Z.txt', 'other process')
    const { capture, error } = hint()
    expect(error.code).toBe('runtime_timeout')
    expect(error.message).toBe(
      `${TIMEOUT_MESSAGE} Orca Lab recorded where its main process ${PID} waits in ${newest}; attach it when you report this.`
    )
    expect(error.data).toEqual({ mainHangRecordPath: newest })
    expect(capture).not.toHaveBeenCalled()
  })

  it('names a record that cleared within two minutes without capturing again', () => {
    const path = record(`main-hang-${PID}-a.txt`, 'x\nMain thread answered again after 42000 ms.\n')
    const { capture, error } = hint()
    expect(error.message).toContain(`${path}, ends with the main thread answering again`)
    expect(capture).not.toHaveBeenCalled()
  })

  it('captures from the CLI when the watchdog left no open record', () => {
    const capture = vi.fn()
    const { error } = hint(capture)
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        parentPid: PID,
        unresponsiveMs: 60_000,
        observer: "the CLI's status.get request"
      })
    )
    const reportPath = capture.mock.calls[0][0].reportPath as string
    expect(reportPath.startsWith(join(userData, 'logs', `main-hang-${PID}-`))).toBe(true)
    expect(error.message).toContain(
      `The CLI recorded where Orca Lab's main process ${PID} was in ${reportPath}`
    )
    expect(error.data).toEqual({ mainHangRecordPath: reportPath })
  })

  it('never captures for a probe shorter than the watchdog threshold', () => {
    const { capture, error } = hint(vi.fn(), 1_000)
    expect(capture).not.toHaveBeenCalled()
    expect(error.message).toContain(`No open hang record for Orca Lab process ${PID}`)
    expect(error.data).toEqual({ mainHangRecordPath: null })
  })

  it('still reports the timeout when the capture fails', () => {
    const { error } = hint(
      vi.fn(() => {
        throw new Error('sample missing')
      })
    )
    expect(error.message).toBe(
      `${TIMEOUT_MESSAGE} No hang record for Orca Lab process ${PID} is in ${join(userData, 'logs')}.`
    )
  })

  it('leaves other errors alone', () => {
    const other = new RuntimeClientError('runtime_unavailable', 'nope')
    expect(hint(vi.fn(), 60_000, other).error).toBe(other)
  })
})

describe('RuntimeClient timeout against a runtime that never answers', () => {
  let userData: string
  let server: Server
  const sockets: Socket[] = []

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'hang-cli-'))
    mkdirSync(join(userData, 'logs'))
    const endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\orca-hang-hint-${process.pid}`
        : join(userData, 'r.sock')
    // Why: accepts the connection and reads the request, like a main process whose thread is stuck.
    server = createServer((socket) => {
      sockets.push(socket)
    })
    await new Promise<void>((resolve) => server.listen(endpoint, resolve))
    writeFileSync(
      join(userData, 'orca-runtime.json'),
      JSON.stringify({
        runtimeId: 'runtime-1',
        pid: PID,
        transports: [{ kind: process.platform === 'win32' ? 'named-pipe' : 'unix', endpoint }],
        authToken: 'token',
        startedAt: 0
      })
    )
  })
  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.destroy()
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(userData, { recursive: true, force: true })
  })

  it('names the hang record in the timeout error', async () => {
    const path = join(userData, 'logs', `main-hang-${PID}-2026-11-19T22-22-05-000Z.txt`)
    writeFileSync(path, 'stalled')
    const client = new RuntimeClient(userData, 200, null, null)
    await expect(client.call('status.get')).rejects.toMatchObject({
      code: 'runtime_timeout',
      message: expect.stringContaining(`waits in ${path}; attach it`),
      data: { mainHangRecordPath: path }
    })
  })
})
