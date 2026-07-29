/**
 * Windows-focused coverage: renaming a file some CLI holds open fails there
 * (EBUSY) instead of silently succeeding as on POSIX. The link must degrade to
 * 'skipped' without losing a byte and succeed on a later retry (ORCA-111).
 */
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import type * as NodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appMock, renameContention } = vi.hoisted(() => ({
  appMock: { userDataPath: '', getPath: vi.fn(() => appMock.userDataPath) },
  renameContention: { busySuffix: null as string | null }
}))

vi.mock('electron', () => ({ app: appMock }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  const renameSync: typeof actual.renameSync = (from, to) => {
    if (renameContention.busySuffix && String(from).endsWith(renameContention.busySuffix)) {
      const error: NodeJS.ErrnoException = new Error(
        `EBUSY: resource busy or locked, rename '${String(from)}'`
      )
      error.code = 'EBUSY'
      throw error
    }
    actual.renameSync(from, to)
  }
  return { ...actual, renameSync }
})

const PROJECT_SLUG = '-Users-dev-Projects-repo'
let userDataDir: string

function seedAccount(accountId: string, sessionId: string, body: string): string {
  const authPath = join(userDataDir, 'claude-accounts', accountId, 'auth')
  const projectDir = join(authPath, 'projects', PROJECT_SLUG)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), body, 'utf-8')
  return authPath
}

function sharedProjectDir(): string {
  return join(userDataDir, 'claude-transcripts', 'projects', PROJECT_SLUG)
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'orca-transcripts-contention-'))
  appMock.userDataPath = userDataDir
})

afterEach(() => {
  renameContention.busySuffix = null
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('linkClaudeTranscriptsToSharedStore under Windows-style rename contention', () => {
  it('defers without losing bytes when an open transcript cannot move, then links on retry', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authPath = seedAccount('account-1', 'busy', '{"m":"busy"}\n')
    // A non-empty store forces the per-file merge instead of a whole-dir rename.
    mkdirSync(sharedProjectDir(), { recursive: true })
    renameContention.busySuffix = 'busy.jsonl'

    expect(linkClaudeTranscriptsToSharedStore(authPath)).toBe('skipped')

    const sourceSession = join(authPath, 'projects', PROJECT_SLUG, 'busy.jsonl')
    expect(readFileSync(sourceSession, 'utf-8')).toBe('{"m":"busy"}\n')
    expect(lstatSync(join(authPath, 'projects')).isSymbolicLink()).toBe(false)

    renameContention.busySuffix = null

    expect(linkClaudeTranscriptsToSharedStore(authPath)).toBe('migrated-and-linked')
    expect(readFileSync(join(sharedProjectDir(), 'busy.jsonl'), 'utf-8')).toBe('{"m":"busy"}\n')
    expect(lstatSync(join(authPath, 'projects')).isSymbolicLink()).toBe(true)
  })

  it('keeps the store copy and cleans its placeholder when parking an open transcript fails', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const liveBody = '{"m":"turn 1"}\n'
    const staleLonger = '{"m":"turn 1"}\n{"m":"stale 2"}\n'
    linkClaudeTranscriptsToSharedStore(seedAccount('account-live', 'shared-session', liveBody))
    const authStale = seedAccount('account-stale', 'shared-session', staleLonger)
    // Parking the store copy renames the very file the live CLI holds open.
    renameContention.busySuffix = 'shared-session.jsonl'

    expect(linkClaudeTranscriptsToSharedStore(authStale)).toBe('skipped')

    expect(readFileSync(join(sharedProjectDir(), 'shared-session.jsonl'), 'utf-8')).toBe(liveBody)
    // The exclusive name claim must not survive the failed park; an orphaned
    // placeholder would burn the sidecar name and be served to nobody.
    expect(readdirSync(sharedProjectDir()).filter((name) => name.includes('superseded'))).toEqual(
      []
    )
    const staleSession = join(authStale, 'projects', PROJECT_SLUG, 'shared-session.jsonl')
    expect(readFileSync(staleSession, 'utf-8')).toBe(staleLonger)

    renameContention.busySuffix = null

    expect(linkClaudeTranscriptsToSharedStore(authStale)).toBe('migrated-and-linked')
    expect(readFileSync(join(sharedProjectDir(), 'shared-session.jsonl'), 'utf-8')).toBe(
      staleLonger
    )
    expect(readFileSync(join(sharedProjectDir(), 'shared-session.superseded'), 'utf-8')).toBe(
      liveBody
    )
  })
})
