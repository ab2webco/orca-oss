import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as TranscriptFileVersionModule from './transcript-file-version'
import type { createTranscriptWatchScheduler } from './transcript-watch-scheduler'

const controlledScheduler = vi.hoisted(() => ({
  reconcile: null as null | (() => Promise<void>)
}))

// Lets the next drain's first file probe answer from before a write that lands right after it.
const writeLandsAfterFirstProbe = vi.hoisted(() => ({
  skipCalls: 0,
  before: null as null | { version: unknown; boundary: string }
}))

vi.mock('./transcript-watch-scheduler', async (importOriginal) => {
  const original = await importOriginal<{
    createTranscriptWatchScheduler: typeof createTranscriptWatchScheduler
  }>()
  return {
    ...original,
    createTranscriptWatchScheduler: (
      options: Parameters<typeof original.createTranscriptWatchScheduler>[0]
    ) => {
      controlledScheduler.reconcile = options.reconcile
      return {
        scheduleEventDrain: () => {},
        scheduleRetry: () => false,
        startReconciliation: () => {},
        dispose: () => {}
      }
    }
  }
})

vi.mock('./transcript-file-version', async (importOriginal) => {
  const original = await importOriginal<typeof TranscriptFileVersionModule>()
  function takeBeforeWrite(): { version: unknown; boundary: string } | null {
    const before = writeLandsAfterFirstProbe.before
    if (!before) {
      return null
    }
    if (writeLandsAfterFirstProbe.skipCalls > 0) {
      writeLandsAfterFirstProbe.skipCalls -= 1
      return null
    }
    writeLandsAfterFirstProbe.before = null
    return before
  }
  return {
    ...original,
    readTranscriptFileVersion: async (
      ...args: Parameters<typeof original.readTranscriptFileVersion>
    ) => {
      const before = takeBeforeWrite()
      return before
        ? (before.version as Awaited<ReturnType<typeof original.readTranscriptFileVersion>>)
        : original.readTranscriptFileVersion(...args)
    },
    boundaryFingerprint: async (...args: Parameters<typeof original.boundaryFingerprint>) => {
      const before = takeBeforeWrite()
      return before ? before.boundary : original.boundaryFingerprint(...args)
    }
  }
})

import { boundaryFingerprint, readTranscriptFileVersion } from './transcript-file-version'
import { subscribeNativeChatTranscript } from './transcript-watch'

let tempRoot: string | null = null

afterEach(async () => {
  controlledScheduler.reconcile = null
  writeLandsAfterFirstProbe.before = null
  writeLandsAfterFirstProbe.skipCalls = 0
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
})

function claudeLine(uuid: string, text: string): string {
  return `${JSON.stringify({
    type: 'user',
    uuid,
    timestamp: '2026-06-01T10:00:00.000Z',
    message: { role: 'user', content: text }
  })}\n`
}

describe('subscribeNativeChatTranscript same-size replacement race', () => {
  it('emits a same-size replacement once when it lands between the drain probes', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'orca-native-chat-race-'))
    const filePath = join(tempRoot, 'rollout.jsonl')
    const oldLine = claudeLine('u-old', 'old')
    const newLine = claudeLine('u-new', 'new')
    expect(newLine.length).toBe(oldLine.length)
    await writeFile(filePath, oldLine)

    const seen: string[] = []
    const sub = await subscribeNativeChatTranscript({
      agent: 'claude',
      sessionId: 'ignored',
      filePath,
      onAppend: (messages) => seen.push(...messages.map((message) => message.id))
    })
    try {
      await controlledScheduler.reconcile!()
      expect(seen).toEqual(['u-old'])

      writeLandsAfterFirstProbe.before = {
        version: await readTranscriptFileVersion(filePath),
        boundary: await boundaryFingerprint(filePath, oldLine.length)
      }
      await writeFile(filePath, newLine)
      // Reconcile's own stat sees the write and starts the drain; its first probe does not.
      writeLandsAfterFirstProbe.skipCalls = 1
      await controlledScheduler.reconcile!()
      await controlledScheduler.reconcile!()

      expect(writeLandsAfterFirstProbe.before).toBeNull()
      expect(seen).toEqual(['u-old', 'u-new'])
    } finally {
      sub.unsubscribe()
    }
  })
})
