import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decodeClaudeTurnLifecycle } from './transcript-turn-lifecycle'
import { scanTranscriptTailForTurn } from './transcript-tail-turn-scan'

let workDir = ''

function write(lines: string[], trailingNewline = true): string {
  const path = join(workDir, 'transcript.jsonl')
  writeFileSync(path, lines.join('\n') + (trailingNewline ? '\n' : ''))
  return path
}

const boundary = JSON.stringify({
  type: 'user',
  uuid: 'u1',
  timestamp: '2026-07-24T03:15:59.000Z',
  message: { role: 'user', content: 'go' }
})

function padding(bytes: number): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: 'a1',
    message: {
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [{ type: 'text', text: 'x'.repeat(bytes) }]
    }
  })
}

/** The boundary itself, made wider than the 64 KB read chunk. If the fragments
 *  are not rejoined this record never parses and the scan reports no boundary. */
function wideBoundary(bytes: number): string {
  return JSON.stringify({
    type: 'user',
    uuid: 'u-wide',
    timestamp: '2026-07-24T03:15:59.000Z',
    message: { role: 'user', content: `go ${'y'.repeat(bytes)}` }
  })
}

describe('scanTranscriptTailForTurn', () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'orca-turn-scan-'))
  })
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('reassembles a boundary record that spans several read chunks', async () => {
    // Not the first line: a record the scan finishes at offset 0 is rejoined by a
    // different path, so leading padding is what makes this exercise the loop.
    const path = write([padding(1_000), wideBoundary(200_000), padding(1_000)])
    const scan = await scanTranscriptTailForTurn(path, decodeClaudeTurnLifecycle)
    expect(scan.lifecycle).toMatchObject({ state: 'working' })
    expect(scan.reachedCeiling).toBe(false)
  })

  it('does not count a half-written trailing record as malformed', async () => {
    const path = write([boundary, '{"type":"assist'], false)
    const scan = await scanTranscriptTailForTurn(path, decodeClaudeTurnLifecycle)
    expect(scan.lifecycle).toMatchObject({ state: 'working' })
    expect(scan.unparsedRecords).toBe(0)
  })

  it('reports the ceiling instead of the boundary it never reached', async () => {
    const path = write([boundary, padding(200_000)])
    const scan = await scanTranscriptTailForTurn(path, decodeClaudeTurnLifecycle, 4_096)
    expect(scan.lifecycle).toBeNull()
    expect(scan.reachedCeiling).toBe(true)
  })

  it('collects queued-input records newest first while looking for the boundary', async () => {
    const queue = (operation: string, at: string) =>
      JSON.stringify({ type: 'queue-operation', operation, timestamp: at })
    const path = write([
      boundary,
      queue('enqueue', '2026-07-24T03:16:00.000Z'),
      queue('enqueue', '2026-07-24T03:16:01.000Z')
    ])
    const scan = await scanTranscriptTailForTurn(path, decodeClaudeTurnLifecycle)
    expect(scan.queuedOperations).toHaveLength(2)
    expect(scan.lifecycle).toMatchObject({ state: 'working' })
  })
})
