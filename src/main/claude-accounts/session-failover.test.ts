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
import {
  copyClaudeSessionForAccountSwitch,
  copyClaudeSessionForFailBack,
  copyClaudeSessionForFailover,
  encodeClaudeProjectDirName
} from './session-failover'

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

/** Mirrors getSharedClaudeTranscriptsRoot(): the one store a universe's `projects/` may link to. */
function sharedTranscriptsRoot(): string {
  return join(testRoot, 'claude-transcripts', 'projects')
}

/** A universe whose `projects/` is a link into the shared store, as ORCA-97 leaves every vault. */
function linkProjectsToSharedStore(configDir: string): void {
  mkdirSync(sharedTranscriptsRoot(), { recursive: true })
  mkdirSync(configDir, { recursive: true })
  symlinkSync(sharedTranscriptsRoot(), join(configDir, 'projects'), 'dir')
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
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => sharedDir,
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
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
      {
        getAccounts: () => [target, source],
        getSharedConfigDir: () => '/nonexistent',
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
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
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => sharedDir,
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
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
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => sharedDir,
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
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
        {
          getAccounts: () => [target],
          getSharedConfigDir: () => sharedDir,
          getSharedTranscriptsRoot: sharedTranscriptsRoot
        }
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
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => sharedDir,
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
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
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => sharedDir,
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
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
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => sharedDir,
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'target-dir-unresolved' })
  })

  it('fails when the shared source config dir does not exist', () => {
    const target = makeAccount({ id: 'endpoint-account' })
    createManagedUniverse(target.id)

    const result = copyClaudeSessionForFailover(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => join(testRoot, 'missing'),
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'source-dir-unresolved' })
  })
})

describe('copyClaudeSessionForFailBack', () => {
  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orca-session-failback-'))
  })

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true })
  })

  it('copies the transcript back from the endpoint universe into an OAuth origin account', () => {
    const endpoint = makeAccount({ id: 'endpoint-account' })
    const endpointAuthPath = createManagedUniverse(endpoint.id)
    const origin = makeAccount({ id: 'origin-account', authMethod: 'subscription-oauth' })
    createManagedUniverse(origin.id)
    const encoded = encodeClaudeProjectDirName(CWD)
    writeSessionFiles(endpointAuthPath, encoded)

    const result = copyClaudeSessionForFailBack(
      { sessionId: SESSION_ID, cwd: CWD, sourceAccountId: endpoint.id, targetAccountId: origin.id },
      {
        getAccounts: () => [endpoint, origin],
        getSharedConfigDir: () => createSharedConfigDir(),
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 2 })
    const restored = join(
      testRoot,
      'claude-accounts',
      origin.id,
      'auth',
      'projects',
      encoded,
      `${SESSION_ID}.jsonl`
    )
    expect(readFileSync(restored, 'utf-8')).toBe('{"type":"summary"}\n')
    if (process.platform !== 'win32') {
      expect(statSync(restored).mode & 0o777).toBe(0o600)
    }
  })

  it('copies back into the shared config dir when the origin was the global selection', () => {
    const endpoint = makeAccount({ id: 'endpoint-account' })
    const endpointAuthPath = createManagedUniverse(endpoint.id)
    const sharedDir = createSharedConfigDir()
    const encoded = encodeClaudeProjectDirName(CWD)
    writeSessionFiles(endpointAuthPath, encoded)

    const result = copyClaudeSessionForFailBack(
      { sessionId: SESSION_ID, cwd: CWD, sourceAccountId: endpoint.id, targetAccountId: null },
      {
        getAccounts: () => [endpoint],
        getSharedConfigDir: () => sharedDir,
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 2 })
    expect(readFileSync(join(sharedDir, 'projects', encoded, `${SESSION_ID}.jsonl`), 'utf-8')).toBe(
      '{"type":"summary"}\n'
    )
  })

  it('rejects a source that is not a custom-endpoint account', () => {
    const oauthSource = makeAccount({ id: 'oauth-source', authMethod: 'subscription-oauth' })
    const origin = makeAccount({ id: 'origin-account', authMethod: 'subscription-oauth' })
    createManagedUniverse(oauthSource.id)
    createManagedUniverse(origin.id)

    const result = copyClaudeSessionForFailBack(
      {
        sessionId: SESSION_ID,
        cwd: CWD,
        sourceAccountId: oauthSource.id,
        targetAccountId: origin.id
      },
      {
        getAccounts: () => [oauthSource, origin],
        getSharedConfigDir: () => createSharedConfigDir(),
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'source-account-not-found' })
  })

  it('rejects a custom-endpoint target — fail-back never copies sideways', () => {
    const endpoint = makeAccount({ id: 'endpoint-account' })
    const otherEndpoint = makeAccount({ id: 'other-endpoint' })
    const endpointAuthPath = createManagedUniverse(endpoint.id)
    createManagedUniverse(otherEndpoint.id)
    writeSessionFiles(endpointAuthPath, encodeClaudeProjectDirName(CWD))

    const result = copyClaudeSessionForFailBack(
      {
        sessionId: SESSION_ID,
        cwd: CWD,
        sourceAccountId: endpoint.id,
        targetAccountId: otherEndpoint.id
      },
      {
        getAccounts: () => [endpoint, otherEndpoint],
        getSharedConfigDir: () => createSharedConfigDir(),
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'target-account-not-found' })
  })

  it('rejects session ids with traversal shapes', () => {
    const endpoint = makeAccount({ id: 'endpoint-account' })
    createManagedUniverse(endpoint.id)

    const result = copyClaudeSessionForFailBack(
      { sessionId: '../escape', cwd: CWD, sourceAccountId: endpoint.id, targetAccountId: null },
      {
        getAccounts: () => [endpoint],
        getSharedConfigDir: () => createSharedConfigDir(),
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'invalid-session-id' })
  })
})

describe('copyClaudeSessionForAccountSwitch', () => {
  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orca-session-switch-'))
  })

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true })
  })

  it('copies the transcript from one pinned OAuth vault into another', () => {
    const source = makeAccount({ id: 'source-oauth', authMethod: 'subscription-oauth' })
    const target = makeAccount({ id: 'target-oauth', authMethod: 'subscription-oauth' })
    const sourceAuthPath = createManagedUniverse(source.id)
    createManagedUniverse(target.id)
    const encoded = encodeClaudeProjectDirName(CWD)
    writeSessionFiles(sourceAuthPath, encoded)

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id, sourceAccountId: source.id },
      {
        getAccounts: () => [source, target],
        getSharedConfigDir: () => '/nonexistent',
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 2 })
    const copied = join(
      testRoot,
      'claude-accounts',
      target.id,
      'auth',
      'projects',
      encoded,
      `${SESSION_ID}.jsonl`
    )
    expect(readFileSync(copied, 'utf-8')).toBe('{"type":"summary"}\n')
    if (process.platform !== 'win32') {
      expect(statSync(copied).mode & 0o777).toBe(0o600)
    }
  })

  it('copies from the shared config dir when the source was the global selection', () => {
    const target = makeAccount({ id: 'target-oauth', authMethod: 'subscription-oauth' })
    createManagedUniverse(target.id)
    const sharedDir = createSharedConfigDir()
    writeSessionFiles(sharedDir, encodeClaudeProjectDirName(CWD))

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => sharedDir,
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 2 })
  })

  it('rejects a custom-endpoint target — endpoint switches use the failover path', () => {
    const source = makeAccount({ id: 'source-oauth', authMethod: 'subscription-oauth' })
    const target = makeAccount({ id: 'endpoint-account', authMethod: 'custom-endpoint' })
    const sourceAuthPath = createManagedUniverse(source.id)
    createManagedUniverse(target.id)
    writeSessionFiles(sourceAuthPath, encodeClaudeProjectDirName(CWD))

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id, sourceAccountId: source.id },
      {
        getAccounts: () => [source, target],
        getSharedConfigDir: () => '/nonexistent',
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'target-account-not-found' })
  })

  it('rejects session ids with traversal shapes', () => {
    const target = makeAccount({ id: 'target-oauth', authMethod: 'subscription-oauth' })
    createManagedUniverse(target.id)

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: 'a/../b', cwd: CWD, targetAccountId: target.id },
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => createSharedConfigDir(),
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'invalid-session-id' })
  })

  it('does not follow a symlinked transcript out of the source root', () => {
    const target = makeAccount({ id: 'target-oauth', authMethod: 'subscription-oauth' })
    createManagedUniverse(target.id)
    const sharedDir = createSharedConfigDir()
    const encoded = encodeClaudeProjectDirName(CWD)
    const projectDir = join(sharedDir, 'projects', encoded)
    mkdirSync(projectDir, { recursive: true })
    const outsideFile = join(testRoot, 'secret.txt')
    writeFileSync(outsideFile, 'secret', 'utf-8')
    symlinkSync(outsideFile, join(projectDir, `${SESSION_ID}.jsonl`))

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => sharedDir,
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'source-not-found' })
  })
})

/**
 * ORCA-97 points every universe's `projects/` at one Orca-owned store, so on a real
 * machine both sides of a switch are links, not directories. Every case above builds
 * physical vaults, which is exactly why the copy could ship unable to read a linked one.
 */
describe('linked transcript stores', () => {
  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orca-session-linked-'))
  })

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true })
  })

  function plantForeignProjectsLink(configDir: string, dirName: string): string {
    const foreignRoot = join(testRoot, 'planted-store')
    const projectDir = join(foreignRoot, dirName)
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, `${SESSION_ID}.jsonl`), '{"type":"planted"}\n', 'utf-8')
    mkdirSync(configDir, { recursive: true })
    symlinkSync(foreignRoot, join(configDir, 'projects'), 'dir')
    return projectDir
  }

  it('treats a switch between two linked vaults as done — the target already reads the transcript', () => {
    const source = makeAccount({ id: 'source-oauth', authMethod: 'subscription-oauth' })
    const target = makeAccount({ id: 'target-oauth', authMethod: 'subscription-oauth' })
    const sourceAuthPath = createManagedUniverse(source.id)
    const targetAuthPath = createManagedUniverse(target.id)
    linkProjectsToSharedStore(sourceAuthPath)
    linkProjectsToSharedStore(targetAuthPath)
    const encoded = encodeClaudeProjectDirName(CWD)
    writeSessionFiles(sourceAuthPath, encoded)

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id, sourceAccountId: source.id },
      {
        getAccounts: () => [source, target],
        getSharedConfigDir: () => '/nonexistent',
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 0 })
    // Why byte-for-byte: source and target resolve to the same file, so a copy that
    // still ran would open the transcript onto itself and truncate the conversation.
    const stored = join(sharedTranscriptsRoot(), encoded, `${SESSION_ID}.jsonl`)
    expect(readFileSync(stored, 'utf-8')).toBe('{"type":"summary"}\n')
    expect(
      readFileSync(join(targetAuthPath, 'projects', encoded, `${SESSION_ID}.jsonl`), 'utf-8')
    ).toBe('{"type":"summary"}\n')
  })

  it('copies out of a linked source vault into a target that owns its projects dir', () => {
    const source = makeAccount({ id: 'source-oauth', authMethod: 'subscription-oauth' })
    const target = makeAccount({ id: 'target-oauth', authMethod: 'subscription-oauth' })
    const sourceAuthPath = createManagedUniverse(source.id)
    createManagedUniverse(target.id)
    linkProjectsToSharedStore(sourceAuthPath)
    const encoded = encodeClaudeProjectDirName(CWD)
    writeSessionFiles(sourceAuthPath, encoded)

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id, sourceAccountId: source.id },
      {
        getAccounts: () => [source, target],
        getSharedConfigDir: () => '/nonexistent',
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
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
          encoded,
          `${SESSION_ID}.jsonl`
        ),
        'utf-8'
      )
    ).toBe('{"type":"summary"}\n')
  })

  it('copies into a linked target vault so the transcript lands in the shared store', () => {
    const source = makeAccount({ id: 'source-oauth', authMethod: 'subscription-oauth' })
    const target = makeAccount({ id: 'target-oauth', authMethod: 'subscription-oauth' })
    const sourceAuthPath = createManagedUniverse(source.id)
    const targetAuthPath = createManagedUniverse(target.id)
    linkProjectsToSharedStore(targetAuthPath)
    const encoded = encodeClaudeProjectDirName(CWD)
    writeSessionFiles(sourceAuthPath, encoded)

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id, sourceAccountId: source.id },
      {
        getAccounts: () => [source, target],
        getSharedConfigDir: () => '/nonexistent',
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 2 })
    expect(
      readFileSync(join(sharedTranscriptsRoot(), encoded, `${SESSION_ID}.jsonl`), 'utf-8')
    ).toBe('{"type":"summary"}\n')
  })

  it('returns the fail-back trip through the same store without rewriting the transcript', () => {
    const endpoint = makeAccount({ id: 'endpoint-account' })
    const origin = makeAccount({ id: 'origin-account', authMethod: 'subscription-oauth' })
    const endpointAuthPath = createManagedUniverse(endpoint.id)
    const originAuthPath = createManagedUniverse(origin.id)
    linkProjectsToSharedStore(endpointAuthPath)
    linkProjectsToSharedStore(originAuthPath)
    const encoded = encodeClaudeProjectDirName(CWD)
    writeSessionFiles(endpointAuthPath, encoded)

    const result = copyClaudeSessionForFailBack(
      { sessionId: SESSION_ID, cwd: CWD, sourceAccountId: endpoint.id, targetAccountId: origin.id },
      {
        getAccounts: () => [endpoint, origin],
        getSharedConfigDir: () => '/nonexistent',
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 0 })
    expect(
      readFileSync(join(sharedTranscriptsRoot(), encoded, `${SESSION_ID}.jsonl`), 'utf-8')
    ).toBe('{"type":"summary"}\n')
  })

  it('reads a linked source universe for the endpoint failover copy too', () => {
    const target = makeAccount({ id: 'endpoint-account' })
    createManagedUniverse(target.id)
    const sharedDir = createSharedConfigDir()
    linkProjectsToSharedStore(sharedDir)
    const encoded = encodeClaudeProjectDirName(CWD)
    writeSessionFiles(sharedDir, encoded)

    const result = copyClaudeSessionForFailover(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id },
      {
        getAccounts: () => [target],
        getSharedConfigDir: () => sharedDir,
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: true, sessionId: SESSION_ID, copiedFileCount: 2 })
  })

  it('refuses a source projects link that points outside Orca’s store', () => {
    const source = makeAccount({ id: 'source-oauth', authMethod: 'subscription-oauth' })
    const target = makeAccount({ id: 'target-oauth', authMethod: 'subscription-oauth' })
    const sourceAuthPath = createManagedUniverse(source.id)
    createManagedUniverse(target.id)
    mkdirSync(sharedTranscriptsRoot(), { recursive: true })
    plantForeignProjectsLink(sourceAuthPath, encodeClaudeProjectDirName(CWD))

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id, sourceAccountId: source.id },
      {
        getAccounts: () => [source, target],
        getSharedConfigDir: () => '/nonexistent',
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'source-not-found' })
  })

  it('refuses a target projects link that points outside Orca’s store', () => {
    const source = makeAccount({ id: 'source-oauth', authMethod: 'subscription-oauth' })
    const target = makeAccount({ id: 'target-oauth', authMethod: 'subscription-oauth' })
    const sourceAuthPath = createManagedUniverse(source.id)
    const targetAuthPath = createManagedUniverse(target.id)
    mkdirSync(sharedTranscriptsRoot(), { recursive: true })
    writeSessionFiles(sourceAuthPath, encodeClaudeProjectDirName(CWD))
    symlinkSync(join(testRoot, 'elsewhere-store'), join(targetAuthPath, 'projects'), 'dir')
    mkdirSync(join(testRoot, 'elsewhere-store'), { recursive: true })

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id, sourceAccountId: source.id },
      {
        getAccounts: () => [source, target],
        getSharedConfigDir: () => '/nonexistent',
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'target-dir-unresolved' })
  })

  it('still refuses a transcript symlinked out of the shared store', () => {
    const source = makeAccount({ id: 'source-oauth', authMethod: 'subscription-oauth' })
    const target = makeAccount({ id: 'target-oauth', authMethod: 'subscription-oauth' })
    const sourceAuthPath = createManagedUniverse(source.id)
    createManagedUniverse(target.id)
    linkProjectsToSharedStore(sourceAuthPath)
    const projectDir = join(sharedTranscriptsRoot(), encodeClaudeProjectDirName(CWD))
    mkdirSync(projectDir, { recursive: true })
    const outsideFile = join(testRoot, 'secret.txt')
    writeFileSync(outsideFile, 'secret', 'utf-8')
    symlinkSync(outsideFile, join(projectDir, `${SESSION_ID}.jsonl`))

    const result = copyClaudeSessionForAccountSwitch(
      { sessionId: SESSION_ID, cwd: CWD, targetAccountId: target.id, sourceAccountId: source.id },
      {
        getAccounts: () => [source, target],
        getSharedConfigDir: () => '/nonexistent',
        getSharedTranscriptsRoot: sharedTranscriptsRoot
      }
    )

    expect(result).toEqual({ ok: false, reason: 'source-not-found' })
  })
})
