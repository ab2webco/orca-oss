import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimsCodexRolloutLayout,
  findTrustedCodexSessionResume,
  resolveTrustedCodexSessionResumeHome
} from './codex-session-resume-home'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function listingFor(files: Record<string, string[]>): (root: string) => AsyncIterable<string> {
  return (root) => {
    const paths = files[root] ?? []
    return (async function* () {
      yield* paths
    })()
  }
}

describe('resolveTrustedCodexSessionResumeHome', () => {
  it('returns the trusted home containing a persisted rollout', () => {
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/Users/example/.codex/sessions/2026/07/20/rollout-session.jsonl',
        trustedCodexHomes: ['/managed/account/home', '/Users/example/.codex'],
        fileIsRegular: () => true
      })
    ).toBe('/Users/example/.codex')
  })

  it('accepts Windows paths case-insensitively', () => {
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: 'C:\\Users\\Example\\.codex\\sessions\\2026\\07\\20\\rollout-a.jsonl',
        trustedCodexHomes: ['c:\\users\\example\\.codex'],
        fileIsRegular: () => true
      })
    ).toBe('c:\\users\\example\\.codex')
  })

  it('rejects paths outside trusted homes or outside the rollout layout', () => {
    const fileIsRegular = vi.fn((): boolean => true)
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/tmp/sessions/2026/07/20/rollout-a.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileIsRegular
      })
    ).toBeNull()
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/Users/example/.codex/sessions/index.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileIsRegular
      })
    ).toBeNull()
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath:
          '/Users/example/.codex/sessions/2026/07/20/rollout-a/../../../../outside.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileIsRegular
      })
    ).toBeNull()
    expect(fileIsRegular).not.toHaveBeenCalled()
  })

  it('rejects a trusted-looking path when the rollout no longer exists', () => {
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: '/Users/example/.codex/sessions/2026/07/20/rollout-a.jsonl',
        trustedCodexHomes: ['/Users/example/.codex'],
        fileIsRegular: () => false
      })
    ).toBeNull()
  })

  it('requires the transcript provenance to name a regular rollout file', () => {
    const homePath = mkdtempSync(join(tmpdir(), 'orca-codex-resume-home-'))
    tempRoots.push(homePath)
    const rolloutDirectory = join(homePath, 'sessions', '2026', '07', '20', 'rollout-a.jsonl')
    mkdirSync(rolloutDirectory, { recursive: true })

    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: rolloutDirectory,
        trustedCodexHomes: [homePath]
      })
    ).toBeNull()

    const rolloutFile = join(homePath, 'sessions', '2026', '07', '20', 'rollout-b.jsonl')
    writeFileSync(rolloutFile, '{}\n')
    expect(
      resolveTrustedCodexSessionResumeHome({
        transcriptPath: rolloutFile,
        trustedCodexHomes: [homePath]
      })
    ).toBe(homePath)
  })

  it('follows Codex when a persisted plain rollout was compressed in place', async () => {
    const homePath = mkdtempSync(join(tmpdir(), 'orca-codex-resume-home-'))
    tempRoots.push(homePath)
    const plainPath = join(
      homePath,
      'sessions',
      '2026',
      '07',
      '20',
      'rollout-2026-07-20T12-00-00-session.jsonl'
    )
    const compressedPath = `${plainPath}.zst`
    mkdirSync(join(plainPath, '..'), { recursive: true })
    writeFileSync(compressedPath, 'compressed-rollout')

    await expect(
      findTrustedCodexSessionResume({
        sessionId: 'session-a',
        transcriptPath: plainPath,
        trustedCodexHomes: [homePath]
      })
    ).resolves.toEqual({ homePath, transcriptPath: compressedPath })

    writeFileSync(plainPath, 'active-rollout')
    await expect(
      findTrustedCodexSessionResume({
        sessionId: 'session-a',
        transcriptPath: compressedPath,
        trustedCodexHomes: [homePath]
      })
    ).resolves.toEqual({ homePath, transcriptPath: plainPath })
  })

  it('finds compressed rollouts for legacy records without transcript provenance', async () => {
    const homePath = mkdtempSync(join(tmpdir(), 'orca-codex-resume-home-'))
    tempRoots.push(homePath)
    const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
    const compressedPath = join(
      homePath,
      'sessions',
      '2026',
      '07',
      '20',
      `rollout-2026-07-20T12-00-00-${sessionId}.jsonl.zst`
    )
    mkdirSync(join(compressedPath, '..'), { recursive: true })
    writeFileSync(compressedPath, 'compressed-rollout')

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: undefined,
        trustedCodexHomes: [homePath]
      })
    ).resolves.toEqual({ homePath, transcriptPath: compressedPath })
  })

  it('finds older saved sessions by id when transcript provenance is absent', async () => {
    const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
    const rolloutPath = `/managed/account/home/sessions/2026/07/20/rollout-2026-07-20T15-50-19-${sessionId}.jsonl`
    const listSessionFiles = async function* (sessionsRoot: string): AsyncIterable<string> {
      if (sessionsRoot === '/managed/account/home/sessions') {
        yield `/managed/account/home/sessions/misplaced-${sessionId}.jsonl`
        yield rolloutPath
      }
    }

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: undefined,
        trustedCodexHomes: ['/Users/example/.codex', '/managed/account/home'],
        listSessionFiles
      })
    ).resolves.toEqual({ homePath: '/managed/account/home', transcriptPath: rolloutPath })
  })

  it('does not scan session trees when exact transcript provenance is valid', async () => {
    const transcriptPath =
      '/managed/account/home/sessions/2026/07/20/rollout-2026-07-20-session.jsonl'
    const listSessionFiles = vi.fn((): AsyncIterable<string> => {
      throw new Error('must not scan')
    })

    await expect(
      findTrustedCodexSessionResume({
        sessionId: 'session-a',
        transcriptPath,
        trustedCodexHomes: ['/managed/account/home'],
        fileIsRegular: () => true,
        listSessionFiles
      })
    ).resolves.toEqual({ homePath: '/managed/account/home', transcriptPath })
    expect(listSessionFiles).not.toHaveBeenCalled()
  })

  it('keeps rejected transcript provenance blocked when no trusted fallback exists', async () => {
    const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
    const listSessionFiles = vi.fn(listingFor({}))

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: `/managed/origin/home/sessions/2026/07/20/rollout-${sessionId}.jsonl`,
        trustedCodexHomes: ['/managed/origin/home', '/managed/other/home'],
        fileIsRegular: () => false,
        listSessionFiles
      })
    ).resolves.toBeNull()
    expect(listSessionFiles).toHaveBeenCalledTimes(2)
  })

  it('repairs stale transcript provenance from one trusted home', async () => {
    const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
    const stalePath = `/managed/origin/home/sessions/2026/07/20/rollout-${sessionId}.jsonl`
    const resolvedPath = `/managed/current/home/sessions/2026/07/20/rollout-${sessionId}.jsonl`

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: stalePath,
        trustedCodexHomes: ['/managed/origin/home', '/managed/current/home'],
        fileIsRegular: () => false,
        listSessionFiles: listingFor({ [`/managed/current/home/sessions`]: [resolvedPath] })
      })
    ).resolves.toEqual({
      homePath: '/managed/current/home',
      transcriptPath: resolvedPath,
      repair: { sessionId, recordedTranscriptPath: stalePath, resolvedTranscriptPath: resolvedPath }
    })
  })

  it('rejects an ambiguous same-id fallback across trusted homes after scanning each home once', async () => {
    const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
    const stalePath = `/managed/stale/home/sessions/2026/07/20/rollout-${sessionId}.jsonl`
    const firstPath = `/managed/one/home/sessions/2026/07/20/rollout-${sessionId}.jsonl`
    const secondPath = `/managed/two/home/sessions/2026/07/20/rollout-${sessionId}.jsonl`
    const listSessionFiles = vi.fn(
      listingFor({
        ['/managed/one/home/sessions']: [firstPath],
        ['/managed/two/home/sessions']: [secondPath]
      })
    )

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: stalePath,
        trustedCodexHomes: [
          '/managed/one/home',
          '/managed/one/home',
          '/managed/two/home',
          '/managed/two/home',
          '/managed/three/home'
        ],
        fileIsRegular: () => false,
        listSessionFiles
      })
    ).resolves.toBeNull()
    expect(listSessionFiles).toHaveBeenCalledTimes(3)
    expect(listSessionFiles).toHaveBeenCalledWith('/managed/one/home/sessions')
    expect(listSessionFiles).toHaveBeenCalledWith('/managed/two/home/sessions')
    expect(listSessionFiles).toHaveBeenCalledWith('/managed/three/home/sessions')
  })

  it('never selects same-id files outside trusted homes during stale-path repair', async () => {
    const sessionId = '019f81b9-19a9-7651-a8d1-352d9420bd11'
    const stalePath = `/managed/stale/home/sessions/2026/07/20/rollout-${sessionId}.jsonl`
    const untrustedPath = `/untrusted/home/sessions/2026/07/20/rollout-${sessionId}.jsonl`

    await expect(
      findTrustedCodexSessionResume({
        sessionId,
        transcriptPath: stalePath,
        trustedCodexHomes: ['/managed/current/home'],
        fileIsRegular: () => false,
        listSessionFiles: listingFor({
          ['/managed/current/home/sessions']: [untrustedPath]
        })
      })
    ).resolves.toBeNull()
  })

  it('does not scan homes for an untrusted legacy session id shape', async () => {
    const listSessionFiles = (): AsyncIterable<string> => {
      throw new Error('must not scan')
    }
    await expect(
      findTrustedCodexSessionResume({
        sessionId: '../session',
        transcriptPath: undefined,
        trustedCodexHomes: ['/Users/example/.codex'],
        listSessionFiles
      })
    ).resolves.toBeNull()
  })

  it('does not scan stale transcript provenance with an invalid session id', async () => {
    const listSessionFiles = vi.fn((): AsyncIterable<string> => {
      throw new Error('must not scan')
    })

    await expect(
      findTrustedCodexSessionResume({
        sessionId: 'not-a-uuid',
        transcriptPath: '/removed/home/sessions/2026/07/20/rollout-not-a-uuid.jsonl',
        trustedCodexHomes: ['/managed/current/home'],
        listSessionFiles
      })
    ).resolves.toBeNull()
    expect(listSessionFiles).not.toHaveBeenCalled()
  })
})

describe('claimsCodexRolloutLayout', () => {
  it('is true for a rollout path even if the file is missing', () => {
    expect(
      claimsCodexRolloutLayout('/Users/example/.codex/sessions/2026/07/20/rollout-session.jsonl')
    ).toBe(true)
  })

  it('is true for compressed rollouts and Windows-separated paths', () => {
    expect(
      claimsCodexRolloutLayout(
        '/Users/example/.codex/sessions/2026/07/20/rollout-session.jsonl.zst'
      )
    ).toBe(true)
    expect(
      claimsCodexRolloutLayout(
        'C:\\Users\\example\\.codex\\sessions\\2026\\07\\20\\rollout-session.jsonl'
      )
    ).toBe(true)
  })

  it('is true for a rollout under a home Orca no longer trusts, so resume cannot silently fall through to the selected account', () => {
    expect(
      claimsCodexRolloutLayout('/removed/account/home/sessions/2026/07/20/rollout-a.jsonl')
    ).toBe(true)
  })

  it('is false for Claude (or other non-Codex) transcript paths', () => {
    expect(
      claimsCodexRolloutLayout(
        '/Users/example/.claude/projects/-Users-example-repo/019f81b9-19a9-7651-a8d1-352d9420bd11.jsonl'
      )
    ).toBe(false)
  })

  it('is false for empty provenance and JSONL misplaced inside a sessions root', () => {
    expect(claimsCodexRolloutLayout(undefined)).toBe(false)
    expect(claimsCodexRolloutLayout('   ')).toBe(false)
    expect(claimsCodexRolloutLayout('/Users/example/.codex/sessions/rollout-a.jsonl')).toBe(false)
    expect(
      claimsCodexRolloutLayout('/Users/example/.codex/sessions/2026/07/20/nested/rollout-a.jsonl')
    ).toBe(false)
  })
})
