import { appendFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentType } from '../../shared/native-chat-types'
import { readAgentSessionLogState } from './session-log-agent-state'

// Slices of real Claude transcripts and Codex rollouts, with prose redacted.
const FIXTURES = resolve('src/main/native-chat/__fixtures__')

let workDir = ''

function stage(fixture: string, extraLines: string[] = []): string {
  const path = join(workDir, `${fixture}.jsonl`)
  copyFileSync(join(FIXTURES, `${fixture}.jsonl`), path)
  for (const line of extraLines) {
    appendFileSync(path, `${line}\n`)
  }
  return path
}

function read(agent: AgentType, transcriptPath: string) {
  return readAgentSessionLogState({ agent, sessionId: 'session-under-test', transcriptPath })
}

describe('readAgentSessionLogState', () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'orca-session-log-state-'))
  })
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('reports Claude working when the log ends on a user prompt', async () => {
    const reading = await read('claude', stage('claude-working'))
    expect(reading).toMatchObject({ read: true, state: 'working' })
  })

  it('reports Claude awaiting-input when the log ends on a terminal assistant turn', async () => {
    const reading = await read('claude', stage('claude-awaiting-input'))
    expect(reading).toMatchObject({ read: true, state: 'awaiting-input' })
  })

  // The discriminating pair: same terminal turn, one trailing enqueue apart.
  it('reports Claude queued-input only when an enqueue is still outstanding', async () => {
    const queued = await read('claude', stage('claude-queued-input'))
    expect(queued).toMatchObject({
      read: true,
      state: 'queued-input',
      queuedInput: { supported: true, pending: 1 }
    })

    const removeLine = JSON.stringify({
      type: 'queue-operation',
      operation: 'remove',
      timestamp: '2026-07-24T03:16:00.000Z'
    })
    const drained = await read('claude', stage('claude-queued-input', [removeLine]))
    expect(drained).toMatchObject({
      read: true,
      state: 'awaiting-input',
      queuedInput: { supported: true, pending: 0 }
    })
  })

  it('reports Codex working and awaiting-input from its own turn events', async () => {
    expect(await read('codex', stage('codex-working'))).toMatchObject({
      read: true,
      state: 'working'
    })
    expect(await read('codex', stage('codex-awaiting-input'))).toMatchObject({
      read: true,
      state: 'awaiting-input'
    })
  })

  it('says queued input is unobservable for Codex instead of reporting none', async () => {
    const reading = await read('codex', stage('codex-awaiting-input'))
    expect(reading).toMatchObject({ read: true, queuedInput: { supported: false } })
  })

  it('keeps the state when the log carries a record shape it has never seen', async () => {
    const unknown = [
      JSON.stringify({ type: 'a-record-type-that-does-not-exist-yet', payload: { deep: [1, 2] } }),
      '{not even json',
      JSON.stringify({ type: 'assistant' })
    ]
    const reading = await read('claude', stage('claude-awaiting-input', unknown))
    expect(reading).toMatchObject({ read: true, state: 'awaiting-input' })
  })

  it('separates a missing log from every real state', async () => {
    const reading = await readAgentSessionLogState({
      agent: 'claude',
      sessionId: 'no-such-session',
      transcriptPath: join(workDir, 'absent.jsonl')
    })
    expect(reading).toEqual({ read: false, reason: 'session-log-missing' })
  })

  it('refuses an agent that writes no session log rather than guessing a state', async () => {
    const reading = await read('aider', stage('claude-awaiting-input'))
    expect(reading).toEqual({ read: false, reason: 'agent-unsupported' })
  })
})
