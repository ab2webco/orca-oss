import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeManagedAccount } from '../../shared/types'
import { copyClaudeSessionForFailover, encodeClaudeProjectDirName } from './session-failover'

let testRoot = ''

vi.mock('electron', () => ({
  app: {
    // Why: managed-auth-path resolves the ownership root from userData; point it at the per-test sandbox.
    getPath: () => testRoot
  }
}))

const SESSION_ID = '11111111-2222-3333-4444-555555555555'
const CWD = '/Users/dev/projects/demo'

function makeAccount(
  overrides: Partial<ClaudeManagedAccount> & { id: string }
): ClaudeManagedAccount {
  return {
    email: `${overrides.id}@example.com`,
    managedAuthPath: join(testRoot, 'claude-accounts', overrides.id, 'auth'),
    managedAuthRuntime: 'host',
    wslDistro: null,
    wslLinuxAuthPath: null,
    authMethod: 'custom-endpoint',
    organizationUuid: null,
    organizationName: null,
    createdAt: 1,
    updatedAt: 1,
    lastAuthenticatedAt: 1,
    ...overrides
  }
}

function createManagedUniverse(accountId: string): string {
  const authPath = join(testRoot, 'claude-accounts', accountId, 'auth')
  mkdirSync(authPath, { recursive: true })
  writeFileSync(join(authPath, '.orca-managed-claude-auth'), `${accountId}\n`, 'utf-8')
  return authPath
}

function createSharedConfigDir(): string {
  const sharedDir = join(testRoot, 'shared-claude')
  mkdirSync(sharedDir, { recursive: true })
  return sharedDir
}

function writeSessionFiles(configDir: string, dirName: string): string {
  const projectDir = join(configDir, 'projects', dirName)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, `${SESSION_ID}.jsonl`), '{"type":"summary"}\n', 'utf-8')
  writeFileSync(join(projectDir, `${SESSION_ID}.meta.json`), '{}\n', 'utf-8')
  writeFileSync(join(projectDir, 'other-session.jsonl'), '{}\n', 'utf-8')
  return projectDir
}

describe('copyClaudeSessionForFailover', () => {
  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orca-session-failover-'))
  })

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true })
  })

  it('copies the session transcript and same-id sidecars into the target universe', () => {
    const target = makeAccount({ id: 'endpoint-account' })
    createManagedUniverse(target.id)
    const sharedDir = createSharedConfigDir()
    const encoded = encodeClaudeProjectDirName(CWD)
    writeSessionFiles(sharedDir, encoded)

    const result = copyClaudeSessionForFailover(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      { getAccounts: () => [target], getSharedConfigDir: () => sharedDir }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 2 })
    const copiedTranscript = join(
      testRoot,
      'claude-accounts',
      target.id,
      'auth',
      'projects',
      encoded,
      `${SESSION_ID}.jsonl`
    )
    expect(readFileSync(copiedTranscript, 'utf-8')).toBe('{"type":"summary"}\n')
    if (process.platform !== 'win32') {
      expect(statSync(copiedTranscript).mode & 0o777).toBe(0o600)
    }
  })

  it('copies from a pinned source account universe when sourceAccountId is given', () => {
    const target = makeAccount({ id: 'endpoint-account' })
    createManagedUniverse(target.id)
    const source = makeAccount({ id: 'source-account', authMethod: 'subscription-oauth' })
    const sourceAuthPath = createManagedUniverse(source.id)
    const encoded = encodeClaudeProjectDirName(CWD)
    writeSessionFiles(sourceAuthPath, encoded)

    const result = copyClaudeSessionForFailover(
      {
        sessionId: SESSION_ID,
        cwd: CWD,
        targetAccountId: target.id,
        sourceAccountId: source.id
      },
      { getAccounts: () => [target, source], getSharedConfigDir: () => '/nonexistent' }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 2 })
  })

  it('falls back to scanning project dirs when the encoded cwd dir does not match', () => {
    const target = makeAccount({ id: 'endpoint-account' })
    createManagedUniverse(target.id)
    const sharedDir = createSharedConfigDir()
    writeSessionFiles(sharedDir, '-some-differently-encoded-dir')

    const result = copyClaudeSessionForFailover(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      { getAccounts: () => [target], getSharedConfigDir: () => sharedDir }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 2 })
    expect(
      readFileSync(
        join(
          testRoot,
          'claude-accounts',
          target.id,
          'auth',
          'projects',
          '-some-differently-encoded-dir',
          `${SESSION_ID}.jsonl`
        ),
        'utf-8'
      )
    ).toBe('{"type":"summary"}\n')
  })

  it('returns a typed failure when the source transcript is missing', () => {
    const target = makeAccount({ id: 'endpoint-account' })
    createManagedUniverse(target.id)
    const sharedDir = createSharedConfigDir()
    mkdirSync(join(sharedDir, 'projects', encodeClaudeProjectDirName(CWD)), { recursive: true })

    const result = copyClaudeSessionForFailover(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      { getAccounts: () => [target], getSharedConfigDir: () => sharedDir }
    )

    expect(result).toEqual({ ok: false, reason: 'source-not-found' })
  })

  it('rejects session ids with path separators or traversal shapes', () => {
    const target = makeAccount({ id: 'endpoint-account' })
    createManagedUniverse(target.id)
    const sharedDir = createSharedConfigDir()

    for (const sessionId of ['../escape', 'a/../b', 'a/b', 'a\\b', '', '-leading-dash', 'a..b']) {
      const result = copyClaudeSessionForFailover(
        { sessionId, cwd: CWD, targetAccountId: target.id },
        { getAccounts: () => [target], getSharedConfigDir: () => sharedDir }
      )
      expect(result).toEqual({ ok: false, reason: 'invalid-session-id' })
    }
  })

  it('does not follow a symlinked transcript out of the source root', () => {
    const target = makeAccount({ id: 'endpoint-account' })
    createManagedUniverse(target.id)
    const sharedDir = createSharedConfigDir()
    const encoded = encodeClaudeProjectDirName(CWD)
    const projectDir = join(sharedDir, 'projects', encoded)
    mkdirSync(projectDir, { recursive: true })
    const outsideFile = join(testRoot, 'secret.txt')
    writeFileSync(outsideFile, 'secret', 'utf-8')
    symlinkSync(outsideFile, join(projectDir, `${SESSION_ID}.jsonl`))

    const result = copyClaudeSessionForFailover(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      { getAccounts: () => [target], getSharedConfigDir: () => sharedDir }
    )

    expect(result).toEqual({ ok: false, reason: 'source-not-found' })
  })

  it('rejects targets that are not custom-endpoint accounts', () => {
    const target = makeAccount({ id: 'oauth-account', authMethod: 'subscription-oauth' })
    createManagedUniverse(target.id)
    const sharedDir = createSharedConfigDir()
    writeSessionFiles(sharedDir, encodeClaudeProjectDirName(CWD))

    const result = copyClaudeSessionForFailover(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      { getAccounts: () => [target], getSharedConfigDir: () => sharedDir }
    )

    expect(result).toEqual({ ok: false, reason: 'target-account-not-found' })
  })

  it('rejects a target universe outside the managed ownership root', () => {
    const outsideAuthPath = join(testRoot, 'elsewhere', 'auth')
    mkdirSync(outsideAuthPath, { recursive: true })
    // Why: the ownership root must exist for resolution to run at all; the point is the escape check.
    mkdirSync(join(testRoot, 'claude-accounts'), { recursive: true })
    const target = makeAccount({ id: 'endpoint-account', managedAuthPath: outsideAuthPath })
    const sharedDir = createSharedConfigDir()
    writeSessionFiles(sharedDir, encodeClaudeProjectDirName(CWD))

    const result = copyClaudeSessionForFailover(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      { getAccounts: () => [target], getSharedConfigDir: () => sharedDir }
    )

    expect(result).toEqual({ ok: false, reason: 'target-dir-unresolved' })
  })

  it('fails when the shared source config dir does not exist', () => {
    const target = makeAccount({ id: 'endpoint-account' })
    createManagedUniverse(target.id)

    const result = copyClaudeSessionForFailover(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      { getAccounts: () => [target], getSharedConfigDir: () => join(testRoot, 'missing') }
    )

    expect(result).toEqual({ ok: false, reason: 'source-dir-unresolved' })
  })
})
