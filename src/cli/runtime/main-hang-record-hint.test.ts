import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { RuntimeClient } from './client'
import {
  answersStatusCheck,
  parseMainHangCaptureOptions,
  withMainHangRecord,
  type MainHangCaptureOptions
} from './main-hang-record-hint'
import { RuntimeClientError } from './types'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'

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
  const record = (name: string, text: string, ageMs = 0): string => {
    const path = join(userData, 'logs', name)
    writeFileSync(path, text)
    const at = new Date(Date.now() - ageMs)
    utimesSync(path, at, at)
    return path
  }
  const hint = async (
    options: {
      timeoutMs?: number
      mayCapture?: boolean
      answers?: boolean
      alive?: boolean
      startCapture?: Mock<(options: MainHangCaptureOptions) => void>
      error?: unknown
    } = {}
  ) => {
    const probe = vi.fn(async () => options.answers ?? false)
    const startCapture = options.startCapture ?? vi.fn<(options: MainHangCaptureOptions) => void>()
    const error = (await withMainHangRecord(
      options.error ?? timeout(),
      {
        userDataPath: userData,
        pid: PID,
        method: 'status.get',
        timeoutMs: options.timeoutMs ?? 60_000,
        mayCapture: options.mayCapture ?? true
      },
      { probe, startCapture, isAlive: () => options.alive ?? true }
    )) as RuntimeClientError
    return { error, probe, startCapture }
  }

  it('names the newest open record for the runtime pid without capturing again', async () => {
    record(`main-hang-${PID}-2026-11-19T22-21-00-000Z.txt`, 'older')
    const newest = record(`main-hang-${PID}-2026-11-19T22-22-05-000Z.txt`, 'stalled')
    record('main-hang-1-2026-11-19T23-00-00-000Z.txt', 'other process')
    const { error, probe, startCapture } = await hint()
    expect(error.code).toBe('runtime_timeout')
    expect(error.message).toBe(
      `${TIMEOUT_MESSAGE} Orca Lab recorded where its main process ${PID} waits in ${newest}; attach it when you report this.`
    )
    expect(error.data).toEqual({ mainHangRecordPath: newest })
    expect(probe).not.toHaveBeenCalled()
    expect(startCapture).not.toHaveBeenCalled()
  })

  it('names a fresh open record even for a short probe, which never captures', async () => {
    const path = record(`main-hang-${PID}-a.txt`, 'stalled')
    const { error, probe } = await hint({ timeoutMs: 1_000 })
    expect(error.data).toEqual({ mainHangRecordPath: path })
    expect(probe).not.toHaveBeenCalled()
  })

  it('names a record that cleared within two minutes without capturing again', async () => {
    const path = record(`main-hang-${PID}-a.txt`, 'x\nMain thread answered again after 42000 ms.\n')
    const { error, startCapture } = await hint()
    expect(error.message).toContain(`${path}, ends with the main thread answering again`)
    expect(startCapture).not.toHaveBeenCalled()
  })

  it('never names an open record older than two minutes, such as an earlier CLI snapshot', async () => {
    record(`main-hang-${PID}-a.txt`, 'CLI snapshot, never closed', 10 * 60_000)
    const short = await hint({ timeoutMs: 1_000 })
    expect(short.error.message).toBe(TIMEOUT_MESSAGE)
    expect(short.error.data).toBeUndefined()
    const { error, startCapture } = await hint()
    expect(startCapture).toHaveBeenCalledTimes(1)
    expect(error.data).toEqual({ mainHangRecordPath: startCapture.mock.calls[0][0].reportPath })
  })

  it('records from the CLI only after a status check also goes unanswered', async () => {
    const { error, probe, startCapture } = await hint()
    expect(probe).toHaveBeenCalledTimes(1)
    expect(startCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        parentPid: PID,
        unresponsiveMs: 60_000,
        observer: "the CLI's status.get request or a status check after it"
      })
    )
    const reportPath = startCapture.mock.calls[0][0].reportPath as string
    expect(reportPath.startsWith(join(userData, 'logs', `main-hang-${PID}-`))).toBe(true)
    expect(error.message).toContain(
      `The CLI is recording where Orca Lab's main process ${PID} waits in ${reportPath}`
    )
    expect(error.data).toEqual({ mainHangRecordPath: reportPath })
  })

  it('does not record or claim a stuck main thread when the runtime answers a status check', async () => {
    const { error, startCapture } = await hint({ answers: true })
    expect(startCapture).not.toHaveBeenCalled()
    expect(error.message).toBe(
      `${TIMEOUT_MESSAGE} The runtime answered a status check right after, so its main thread is not stuck; the status.get request itself did not finish.`
    )
    expect(error.data).toEqual({ mainHangRecordPath: null })
  })

  it('never probes or records for a short probe or a stream idle timeout', async () => {
    for (const options of [{ timeoutMs: 1_000 }, { mayCapture: false }]) {
      const { error, probe, startCapture } = await hint(options)
      expect(error.message).toBe(TIMEOUT_MESSAGE)
      expect(probe).not.toHaveBeenCalled()
      expect(startCapture).not.toHaveBeenCalled()
    }
  })

  it('says the process is gone instead of recording a dead pid', async () => {
    const { error, startCapture } = await hint({ alive: false })
    expect(startCapture).not.toHaveBeenCalled()
    expect(error.message).toBe(`${TIMEOUT_MESSAGE} Orca Lab process ${PID} is no longer running.`)
  })

  it('still reports the timeout when the capture cannot start', async () => {
    const { error } = await hint({
      startCapture: vi.fn<(options: MainHangCaptureOptions) => void>(() => {
        throw new Error('spawn EACCES')
      })
    })
    expect(error.message).toBe(
      `${TIMEOUT_MESSAGE} The CLI could not start recording Orca Lab process ${PID}.`
    )
  })

  it('leaves other errors alone', async () => {
    const other = new RuntimeClientError('runtime_unavailable', 'nope')
    expect((await hint({ error: other })).error).toBe(other)
  })
})

describe('parseMainHangCaptureOptions', () => {
  it('accepts what the CLI passes and rejects anything else', () => {
    const options = {
      reportPath: '/u/logs/main-hang-1-x.txt',
      parentPid: 1,
      unresponsiveMs: 60_000,
      detectedAt: 0,
      observer: 'the CLI'
    }
    expect(parseMainHangCaptureOptions(JSON.stringify(options))).toEqual(options)
    expect(parseMainHangCaptureOptions(JSON.stringify({ ...options, parentPid: 0 }))).toBeNull()
    expect(parseMainHangCaptureOptions('not json')).toBeNull()
    expect(parseMainHangCaptureOptions(undefined)).toBeNull()
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

describe('answersStatusCheck', () => {
  let dir: string
  let server: Server
  const sockets: Socket[] = []
  const listen = async (answer: boolean): Promise<RuntimeMetadata> => {
    const endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\orca-status-check-${process.pid}-${answer}`
        : join(dir, `s-${answer}.sock`)
    server = createServer((socket) => {
      sockets.push(socket)
      socket.setEncoding('utf8')
      socket.on('data', (line: string) => {
        const request = JSON.parse(line.trim()) as { id: string; method: string }
        if (answer && request.method === 'status.get') {
          socket.write(
            `${JSON.stringify({ id: request.id, ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } })}\n`
          )
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(endpoint, resolve))
    return {
      runtimeId: 'runtime-1',
      pid: PID,
      transports: [{ kind: process.platform === 'win32' ? 'named-pipe' : 'unix', endpoint }],
      authToken: 'token',
      startedAt: 0
    } as RuntimeMetadata
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'status-check-'))
  })
  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.destroy()
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  it('is true when the runtime answers status.get', async () => {
    expect(await answersStatusCheck(await listen(true))).toBe(true)
  })

  it('is false when the runtime accepts and never answers', async () => {
    expect(await answersStatusCheck(await listen(false))).toBe(false)
  })
})
