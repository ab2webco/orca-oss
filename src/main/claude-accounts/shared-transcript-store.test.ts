import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import type * as NodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appMock } = vi.hoisted(() => ({
  appMock: { userDataPath: '', getPath: vi.fn(() => appMock.userDataPath) }
}))

vi.mock('electron', () => ({ app: appMock }))

const PROJECT_SLUG = '-Users-dev-Projects-repo'
let userDataDir: string

/** Creates an account auth dir owning one session transcript. */
function seedAccount(accountId: string, sessionId: string, body: string): string {
  const authPath = join(userDataDir, 'claude-accounts', accountId, 'auth')
  writeAccountFile(authPath, `${sessionId}.jsonl`, body)
  return authPath
}

/** Writes one entry (nested paths allowed) into an account's project dir. */
function writeAccountFile(authPath: string, entryPath: string, body: string): string {
  const target = join(authPath, 'projects', PROJECT_SLUG, entryPath)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, body, 'utf-8')
  return target
}

function sharedProjectDir(): string {
  return join(userDataDir, 'claude-transcripts', 'projects', PROJECT_SLUG)
}

function sharedSession(sessionId: string): string {
  return join(sharedProjectDir(), `${sessionId}.jsonl`)
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'orca-transcripts-'))
  appMock.userDataPath = userDataDir
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('linkClaudeTranscriptsToSharedStore', () => {
  it('makes every account see the same project history', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authA = seedAccount('account-a', 'session-a', '{"m":"from A"}\n')
    const authB = seedAccount('account-b', 'session-b', '{"m":"from B"}\n')

    expect(linkClaudeTranscriptsToSharedStore(authA)).toBe('migrated-and-linked')
    expect(linkClaudeTranscriptsToSharedStore(authB)).toBe('migrated-and-linked')

    // Why: this is the reported bug — /resume under either account must list both.
    for (const authPath of [authA, authB]) {
      const visible = readdirSync(join(authPath, 'projects', PROJECT_SLUG)).sort()
      expect(visible).toEqual(['session-a.jsonl', 'session-b.jsonl'])
    }
  })

  it('links an account whose only leftovers are directories the store already has', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    // Found with real data: 2 of 4 accounts stayed unlinked forever because every
    // project carries a `memory/` dir and session sidechain dirs, and a directory
    // facing a directory was left in place — so the source never emptied.
    const authA = seedAccount('account-a', 'session-a', '{"m":"A"}\n')
    writeAccountFile(authA, join('memory', 'MEMORY.md'), '- from A\n')
    writeAccountFile(authA, join('session-a', 'sidechain.jsonl'), '{"m":"A side"}\n')
    const authB = seedAccount('account-b', 'session-b', '{"m":"B"}\n')
    writeAccountFile(authB, join('memory', 'other.md'), 'from B\n')
    writeAccountFile(authB, join('session-a', 'more.jsonl'), '{"m":"B side"}\n')

    expect(linkClaudeTranscriptsToSharedStore(authA)).toBe('migrated-and-linked')
    expect(linkClaudeTranscriptsToSharedStore(authB)).toBe('migrated-and-linked')

    expect(lstatSync(join(authB, 'projects')).isSymbolicLink()).toBe(true)
    expect(readdirSync(join(sharedProjectDir(), 'memory')).sort()).toEqual([
      'MEMORY.md',
      'other.md'
    ])
    expect(readdirSync(join(sharedProjectDir(), 'session-a')).sort()).toEqual([
      'more.jsonl',
      'sidechain.jsonl'
    ])
  })

  it('keeps the newer copy of a hand-edited memory file and parks the older one', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    // Why mtime, not size: memory notes are hand-edited and shrink on a rewrite,
    // so the longer file is not the current one.
    const authOld = seedAccount('account-old', 'session-old', '{"m":"old"}\n')
    const olderIndex = writeAccountFile(authOld, join('memory', 'MEMORY.md'), '- one\n- two\n')
    utimesSync(olderIndex, new Date(1_700_000_000_000), new Date(1_700_000_000_000))
    const authNew = seedAccount('account-new', 'session-new', '{"m":"new"}\n')
    writeAccountFile(authNew, join('memory', 'MEMORY.md'), '- rewritten\n')

    linkClaudeTranscriptsToSharedStore(authOld)
    linkClaudeTranscriptsToSharedStore(authNew)

    const memoryDir = join(sharedProjectDir(), 'memory')
    expect(readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8')).toBe('- rewritten\n')
    expect(readdirSync(memoryDir).some((entry) => entry.includes('.superseded'))).toBe(true)
  })

  it('retires both session caches so the CLI reindexes the merged directory', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    // Why: `sessions-index.json` indexes only the universe that wrote it, and
    // measured on real data it can still list sessions whose `.jsonl` is gone —
    // it is a cache, so promoting either copy would describe the wrong directory.
    const authA = seedAccount('account-a', 'session-a', '{"m":"A"}\n')
    writeAccountFile(authA, 'sessions-index.json', '{"version":1,"entries":["a"]}')
    const authB = seedAccount('account-b', 'session-b', '{"m":"B"}\n')
    writeAccountFile(authB, 'sessions-index.json', '{"version":1,"entries":["b"]}')

    linkClaudeTranscriptsToSharedStore(authA)
    linkClaudeTranscriptsToSharedStore(authB)

    expect(existsSync(join(sharedProjectDir(), 'sessions-index.json'))).toBe(false)
    expect(
      readdirSync(sharedProjectDir())
        .filter((e) => e.endsWith('.jsonl'))
        .sort()
    ).toEqual(['session-a.jsonl', 'session-b.jsonl'])
    // Both caches are retained for recovery, neither is readable by the CLI.
    expect(
      readdirSync(sharedProjectDir()).filter((e) => e.startsWith('sessions-index.json.superseded'))
    ).toHaveLength(2)
  })

  it('keeps the longer transcript when the same session exists in two accounts', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const full = '{"m":"turn 1"}\n{"m":"turn 2"}\n{"m":"turn 3"}\n'
    const authA = seedAccount('account-a', 'shared-session', full)
    // A failover copies a transcript across universes, so the same id can exist
    // twice; the stub must not win just by being migrated later.
    const authB = seedAccount('account-b', 'shared-session', '{"m":"turn 1"}\n')

    linkClaudeTranscriptsToSharedStore(authA)
    linkClaudeTranscriptsToSharedStore(authB)

    expect(readFileSync(sharedSession('shared-session'), 'utf-8')).toBe(full)
  })

  it('adopts the longer copy even when the stub migrates first', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authStub = seedAccount('account-stub', 'shared-session', '{"m":"turn 1"}\n')
    const full = '{"m":"turn 1"}\n{"m":"turn 2"}\n'
    const authFull = seedAccount('account-full', 'shared-session', full)

    linkClaudeTranscriptsToSharedStore(authStub)
    linkClaudeTranscriptsToSharedStore(authFull)

    expect(readFileSync(sharedSession('shared-session'), 'utf-8')).toBe(full)
  })

  it('parks even a duplicate the stored transcript already contains', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    // Why not delete it: a Claude running outside Orca is in no registry this code
    // can read, and unlinking a file it holds open for append loses the rest of
    // that conversation. Redundant-looking is not the same as unreferenced.
    const full = '{"m":"turn 1"}\n{"m":"turn 2"}\n'
    linkClaudeTranscriptsToSharedStore(seedAccount('account-full', 'dup', full))
    linkClaudeTranscriptsToSharedStore(seedAccount('account-b', 'dup', '{"m":"turn 1"}\n'))

    expect(readFileSync(sharedSession('dup'), 'utf-8')).toBe(full)
    const parked = readdirSync(sharedProjectDir()).filter((e) => e.includes('.superseded'))
    expect(parked).toHaveLength(1)
    expect(readFileSync(join(sharedProjectDir(), parked[0]), 'utf-8')).toBe('{"m":"turn 1"}\n')
  })

  it('parks a diverged transcript instead of dropping it', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const stored = '{"m":"turn 1"}\n{"m":"turn 2"}\n'
    linkClaudeTranscriptsToSharedStore(seedAccount('account-full', 'dup', stored))
    // Not a prefix: this copy holds a turn the winner never saw.
    linkClaudeTranscriptsToSharedStore(seedAccount('account-b', 'dup', '{"m":"other"}\n'))

    expect(readFileSync(sharedSession('dup'), 'utf-8')).toBe(stored)
    const parked = readdirSync(sharedProjectDir()).filter((e) => e.includes('.superseded'))
    expect(parked).toHaveLength(1)
    expect(readFileSync(join(sharedProjectDir(), parked[0]), 'utf-8')).toBe('{"m":"other"}\n')
  })

  it('moves a symlinked transcript as a link instead of reading through it', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    // Followed, this link wins on size and the stored transcript reads as its
    // strict prefix — so the real file is deleted and the store is left holding a
    // link out of itself. session-failover holds the same invariant.
    const outside = join(userDataDir, 'outside.jsonl')
    writeFileSync(outside, '{"m":"1"}\n{"m":"2"}\n{"m":"3"}\n', 'utf-8')
    const stored = '{"m":"1"}\n{"m":"2"}\n'
    const authPath = seedAccount('account-a', 'session-a', 'replaced by a link below')
    mkdirSync(sharedProjectDir(), { recursive: true })
    writeFileSync(sharedSession('session-a'), stored, 'utf-8')
    const vaultSession = join(authPath, 'projects', PROJECT_SLUG, 'session-a.jsonl')
    rmSync(vaultSession)
    symlinkSync(outside, vaultSession)

    expect(linkClaudeTranscriptsToSharedStore(authPath)).toBe('migrated-and-linked')

    expect(lstatSync(sharedSession('session-a')).isSymbolicLink()).toBe(false)
    expect(readFileSync(sharedSession('session-a'), 'utf-8')).toBe(stored)
    const parked = readdirSync(sharedProjectDir()).filter((e) => e.includes('.superseded'))
    expect(parked).toHaveLength(1)
    expect(lstatSync(join(sharedProjectDir(), parked[0])).isSymbolicLink()).toBe(true)
  })

  it('is idempotent — a second call leaves the link alone', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authPath = seedAccount('account-a', 'session-a', '{"m":"A"}\n')

    expect(linkClaudeTranscriptsToSharedStore(authPath)).toBe('migrated-and-linked')
    expect(linkClaudeTranscriptsToSharedStore(authPath)).toBe('already-linked')

    expect(lstatSync(join(authPath, 'projects')).isSymbolicLink()).toBe(true)
    expect(readFileSync(sharedSession('session-a'), 'utf-8')).toBe('{"m":"A"}\n')
  })

  it('leaves a projects link the user pointed somewhere else alone', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authPath = join(userDataDir, 'claude-accounts', 'account-a', 'auth')
    const elsewhere = join(userDataDir, 'elsewhere')
    mkdirSync(elsewhere, { recursive: true })
    mkdirSync(authPath, { recursive: true })
    symlinkSync(elsewhere, join(authPath, 'projects'), 'dir')

    expect(linkClaudeTranscriptsToSharedStore(authPath)).toBe('skipped')
    expect(lstatSync(join(authPath, 'projects')).isSymbolicLink()).toBe(true)
    expect(readdirSync(elsewhere)).toEqual([])
  })

  it('links a brand new account that has no transcripts yet', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authPath = join(userDataDir, 'claude-accounts', 'fresh', 'auth')
    mkdirSync(authPath, { recursive: true })

    expect(linkClaudeTranscriptsToSharedStore(authPath)).toBe('linked')
    expect(lstatSync(join(authPath, 'projects')).isSymbolicLink()).toBe(true)
  })

  it('lets a real transcript outrank a link already stored under its name', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const outside = join(userDataDir, 'outside.jsonl')
    writeFileSync(outside, '{"m":"outside"}\n', 'utf-8')
    mkdirSync(sharedProjectDir(), { recursive: true })
    symlinkSync(outside, sharedSession('session-a'))
    const authPath = seedAccount('account-a', 'session-a', '{"m":"real"}\n')

    expect(linkClaudeTranscriptsToSharedStore(authPath)).toBe('migrated-and-linked')

    // Why: otherwise /resume serves the link's content and the real transcript
    // sits parked behind it.
    expect(lstatSync(sharedSession('session-a')).isSymbolicLink()).toBe(false)
    expect(readFileSync(sharedSession('session-a'), 'utf-8')).toBe('{"m":"real"}\n')
    expect(readFileSync(outside, 'utf-8')).toBe('{"m":"outside"}\n')
  })

  it('parks a directory facing a stored link without leaving a claimed placeholder', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    // Found by review: claiming the sidecar name with an exclusive create and then
    // renaming a directory onto it cannot succeed, so every launch leaked one more
    // empty sidecar and the universe stayed unlinked forever.
    const outside = join(userDataDir, 'outside-dir')
    mkdirSync(outside, { recursive: true })
    mkdirSync(sharedProjectDir(), { recursive: true })
    symlinkSync(outside, join(sharedProjectDir(), 'session-a'))
    const authPath = seedAccount('account-a', 'other', '{"m":"keep"}\n')
    writeAccountFile(authPath, join('session-a', 'sidechain.jsonl'), '{"m":"side"}\n')

    expect(linkClaudeTranscriptsToSharedStore(authPath)).toBe('migrated-and-linked')

    expect(lstatSync(join(authPath, 'projects')).isSymbolicLink()).toBe(true)
    const parked = readdirSync(sharedProjectDir()).filter((e) => e.includes('.superseded'))
    expect(parked).toHaveLength(1)
    // The link is what gets parked; the real directory takes the canonical name.
    expect(lstatSync(join(sharedProjectDir(), parked[0])).isSymbolicLink()).toBe(true)
    expect(readdirSync(join(sharedProjectDir(), 'session-a'))).toEqual(['sidechain.jsonl'])
    expect(readdirSync(outside)).toEqual([])
  })

  it('leaves no sidecar behind when the park itself fails', async () => {
    const authPath = seedAccount('account-a', 'session-a', '{"m":"loser"}\n')
    mkdirSync(sharedProjectDir(), { recursive: true })
    writeFileSync(sharedSession('session-a'), '{"m":"1"}\n{"m":"2"}\n', 'utf-8')
    vi.resetModules()
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof NodeFs>('node:fs')
      return {
        ...actual,
        renameSync: ((from: string, to: string) => {
          if (String(to).includes('.superseded')) {
            throw new Error('simulated park failure')
          }
          return actual.renameSync(from, to)
        }) as typeof actual.renameSync
      }
    })
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')

    linkClaudeTranscriptsToSharedStore(authPath)

    vi.doUnmock('node:fs')
    vi.resetModules()
    // Why: the exclusive name claim must be released, or it burns the name and is
    // served to nobody.
    expect(readdirSync(sharedProjectDir())).toEqual(['session-a.jsonl'])
  })

  it('a session written through the link is visible to the other account', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const authA = seedAccount('account-a', 'session-a', '{"m":"A"}\n')
    const authB = seedAccount('account-b', 'session-b', '{"m":"B"}\n')
    linkClaudeTranscriptsToSharedStore(authA)
    linkClaudeTranscriptsToSharedStore(authB)

    // Stands in for the live CLI appending a new session under account A.
    writeFileSync(
      join(authA, 'projects', PROJECT_SLUG, 'session-new.jsonl'),
      '{"m":"new"}\n',
      'utf-8'
    )

    expect(existsSync(join(authB, 'projects', PROJECT_SLUG, 'session-new.jsonl'))).toBe(true)
  })

  it('still links when every session collided with a longer stored copy', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    // Found with real data: accounts were skipped because all of their sessions
    // lost the size comparison, so the directory never emptied and those accounts
    // stayed blind to the shared history — the bug being fixed.
    const authPath = seedAccount('account-a', 'session-a', '{"m":"short"}\n')
    mkdirSync(sharedProjectDir(), { recursive: true })
    const stored = '{"m":"turn 1"}\n{"m":"turn 2"}\n{"m":"turn 3"}\n'
    writeFileSync(sharedSession('session-a'), stored, 'utf-8')

    expect(linkClaudeTranscriptsToSharedStore(authPath)).toBe('migrated-and-linked')
    expect(lstatSync(join(authPath, 'projects')).isSymbolicLink()).toBe(true)
    // The winner is untouched and the diverged copy is retained, not deleted.
    expect(readFileSync(sharedSession('session-a'), 'utf-8')).toBe(stored)
    expect(
      readdirSync(sharedProjectDir()).some((entry) => entry.includes('session-a.superseded'))
    ).toBe(true)
  })

  it('keeps both superseded copies when three accounts share one session id', async () => {
    const { linkClaudeTranscriptsToSharedStore } = await import('./shared-transcript-store')
    const full = '{"m":"1"}\n{"m":"2"}\n{"m":"3"}\n'
    linkClaudeTranscriptsToSharedStore(seedAccount('account-full', 'dup', full))
    linkClaudeTranscriptsToSharedStore(seedAccount('account-b', 'dup', '{"m":"9"}\n'))
    linkClaudeTranscriptsToSharedStore(seedAccount('account-c', 'dup', '{"m":"8"}\n'))

    expect(readFileSync(sharedSession('dup'), 'utf-8')).toBe(full)
    // Why unique names: a second collision must not overwrite the first sidecar.
    expect(readdirSync(sharedProjectDir()).filter((e) => e.includes('.superseded')).length).toBe(2)
  })
})
