import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatchInputOf } from './dispatch-brief-delivery'
import type { DispatchBriefHost } from './dispatch-brief-file'

const PREAMBLE =
  'You are working inside Orca Lab...\n--dispatch-capability dcap_secret\n=== TASK ===\nWork on ORCA-1\n'
const LINE = 'Read your Orca Lab brief at .orca/briefs/ctx_1.md (task task_1) and follow it.'

describe('dispatchInputOf', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(path.join(os.tmpdir(), 'orca-dispatch-input-'))
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  const remoteHost: () => DispatchBriefHost = () => ({
    createDir: async (dirPath) => {
      await mkdir(dirPath, { recursive: true })
    },
    writeFile: (filePath, content) => writeFile(filePath, content)
  })

  it('types one line and leaves the preamble in the local workspace', async () => {
    const input = await dispatchInputOf({
      preamble: PREAMBLE,
      dispatchId: 'ctx_1',
      taskId: 'task_1',
      target: { path: workspace, connectionId: null },
      sshHostOf: () => null
    })
    expect(input).toEqual({ text: LINE, briefPath: '.orca/briefs/ctx_1.md' })
    expect(readFileSync(path.join(workspace, '.orca/briefs/ctx_1.md'), 'utf8')).toBe(PREAMBLE)
  })

  it("writes an SSH workspace's brief through that connection's host", async () => {
    const asked: string[] = []
    const input = await dispatchInputOf({
      preamble: PREAMBLE,
      dispatchId: 'ctx_1',
      taskId: 'task_1',
      target: { path: workspace, connectionId: 'ssh-1' },
      sshHostOf: (connectionId) => {
        asked.push(connectionId)
        return remoteHost()
      }
    })
    expect(asked).toEqual(['ssh-1'])
    expect(input.text).toBe(LINE)
    expect(readFileSync(path.join(workspace, '.orca/briefs/ctx_1.md'), 'utf8')).toBe(PREAMBLE)
  })

  it('types the full preamble when the SSH connection has no filesystem host', async () => {
    const input = await dispatchInputOf({
      preamble: PREAMBLE,
      dispatchId: 'ctx_1',
      taskId: 'task_1',
      target: { path: workspace, connectionId: 'ssh-1' },
      sshHostOf: () => null
    })
    expect(input).toEqual({ text: PREAMBLE, briefPath: null })
  })

  it('types the full preamble when the brief cannot be written', async () => {
    const input = await dispatchInputOf({
      preamble: PREAMBLE,
      dispatchId: 'ctx_1',
      taskId: 'task_1',
      target: { path: path.join(workspace, 'missing', '\0bad'), connectionId: null },
      sshHostOf: () => null
    })
    expect(input).toEqual({ text: PREAMBLE, briefPath: null })
  })

  it('types the full preamble when there is no workspace to write in', async () => {
    const input = await dispatchInputOf({
      preamble: PREAMBLE,
      dispatchId: 'ctx_1',
      taskId: 'task_1',
      target: null,
      sshHostOf: () => null
    })
    expect(input).toEqual({ text: PREAMBLE, briefPath: null })
  })
})
