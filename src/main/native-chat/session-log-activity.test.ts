import { appendFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentType } from '../../shared/native-chat-types'
import { AGENT_SESSION_LOG_ACTIVITY_TEXT_LIMIT } from '../../shared/agent-session-log-state'
import { readAgentSessionLogState } from './session-log-agent-state'
import {
  TranscriptActivityAccumulator,
  collapseActivityText,
  transcriptActivityRecord
} from './transcript-activity-scan'

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
  return readAgentSessionLogState({
    agent,
    sessionId: 'session-under-test',
    transcriptPath,
    includeActivity: true
  })
}

let uniqueId = 0

function claudeAssistant(blocks: unknown[]): string {
  uniqueId += 1
  return JSON.stringify({
    type: 'assistant',
    uuid: `a-${uniqueId}`,
    timestamp: '2026-07-24T05:00:00.000Z',
    message: { role: 'assistant', content: blocks }
  })
}

function claudeToolResult(): string {
  uniqueId += 1
  return JSON.stringify({
    type: 'user',
    uuid: `u-${uniqueId}`,
    timestamp: '2026-07-24T05:00:01.000Z',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }]
    }
  })
}

describe('session log activity', () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'orca-session-log-activity-'))
  })
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  // The load-bearing case: on a settled transcript the newest lifecycle row IS
  // the last assistant row, so extracting activity after the boundary check
  // would leave every idle agent's cell blank while a working-only suite still
  // passed.
  it('projects the last assistant text from a settled Claude log', async () => {
    const reading = await read('claude', stage('claude-awaiting-input'))
    expect(reading).toMatchObject({
      read: true,
      state: 'awaiting-input',
      activity: { lastAssistantText: 'redacted', pendingToolName: null, textBeyondScan: false }
    })
  })

  it('reports the tool in flight when no result has landed behind it', async () => {
    const path = stage('claude-working', [
      claudeAssistant([
        { type: 'text', text: 'looking at the config' },
        { type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }
      ])
    ])
    expect(await read('claude', path)).toMatchObject({
      read: true,
      state: 'working',
      activity: { lastAssistantText: 'looking at the config', pendingToolName: 'Read' }
    })
  })

  it('reports no pending tool once its result is in the log', async () => {
    const path = stage('claude-working', [
      claudeAssistant([{ type: 'tool_use', id: 'tu-1', name: 'Read', input: {} }]),
      claudeToolResult()
    ])
    expect(await read('claude', path)).toMatchObject({
      read: true,
      activity: { pendingToolName: null }
    })
  })

  it('omits activity unless the caller asks for it', async () => {
    const reading = await readAgentSessionLogState({
      agent: 'claude',
      sessionId: 'session-under-test',
      transcriptPath: stage('claude-awaiting-input')
    })
    expect(reading).toMatchObject({ read: true })
    expect('activity' in reading ? reading.activity : undefined).toBeUndefined()
  })

  it('projects activity from a settled Codex log', async () => {
    expect(await read('codex', stage('codex-awaiting-input'))).toMatchObject({
      read: true,
      activity: { textBeyondScan: false }
    })
  })

  it('carries no activity when the log cannot be read at all', async () => {
    expect(
      await readAgentSessionLogState({
        agent: 'claude',
        sessionId: 'session-under-test',
        transcriptPath: join(workDir, 'absent.jsonl'),
        includeActivity: true
      })
    ).toEqual({ read: false, reason: 'session-log-missing' })
  })
})

describe('transcriptActivityRecord', () => {
  it('ignores user prose, which is the prompt and not what the agent is doing', () => {
    expect(
      transcriptActivityRecord({
        id: 'm1',
        role: 'user',
        blocks: [{ type: 'text', text: 'do the thing' }],
        timestamp: 1,
        source: 'transcript'
      })
    ).toBeNull()
  })

  it('reads both prose and the tool call out of one assistant record', () => {
    expect(
      transcriptActivityRecord({
        id: 'm1',
        role: 'assistant',
        blocks: [
          { type: 'text', text: '  running   tests\n' },
          { type: 'tool-call', name: 'Bash', input: {} }
        ],
        timestamp: 7,
        source: 'transcript'
      })
    ).toEqual({ text: 'running tests', toolName: 'Bash', isToolResult: false, timestamp: 7 })
  })
})

describe('collapseActivityText', () => {
  it('truncates to the IPC ceiling', () => {
    const collapsed = collapseActivityText('x'.repeat(AGENT_SESSION_LOG_ACTIVITY_TEXT_LIMIT + 50))
    expect(collapsed).toHaveLength(AGENT_SESSION_LOG_ACTIVITY_TEXT_LIMIT)
    expect(collapsed?.endsWith('…')).toBe(true)
  })

  it('treats whitespace-only prose as no prose', () => {
    expect(collapseActivityText('   \n ')).toBeNull()
  })
})

describe('TranscriptActivityAccumulator', () => {
  it('stops wanting records once prose and the tool question are both settled', () => {
    const accumulator = new TranscriptActivityAccumulator()
    accumulator.push({ text: null, toolName: null, isToolResult: true, timestamp: 2 })
    expect(accumulator.wants).toBe(true)
    accumulator.push({ text: 'done', toolName: null, isToolResult: false, timestamp: 1 })
    expect(accumulator.wants).toBe(false)
  })

  it('says the prose is beyond the scan rather than absent when the budget runs out', () => {
    const accumulator = new TranscriptActivityAccumulator(2)
    expect(accumulator.spend()).toBe(true)
    expect(accumulator.spend()).toBe(true)
    expect(accumulator.spend()).toBe(false)
    expect(accumulator.result()).toMatchObject({ lastAssistantText: null, textBeyondScan: true })
  })

  it('does not claim beyond-scan when the walk ended with prose in hand', () => {
    const accumulator = new TranscriptActivityAccumulator(1)
    accumulator.spend()
    accumulator.push({ text: 'said something', toolName: null, isToolResult: false, timestamp: 3 })
    accumulator.spend()
    expect(accumulator.result()).toMatchObject({
      lastAssistantText: 'said something',
      textBeyondScan: false
    })
  })
})
