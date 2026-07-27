import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { ClaudeManagedAccount } from '../../shared/types'
import {
  getManagedClaudeRefreshAccounts,
  readManagedClaudeRefreshCredentials
} from './claude-managed-refresh-chain'
import {
  fingerprintClaudeRefreshChain,
  type ClaudeRefreshChainFingerprint
} from './claude-refresh-chain-fingerprint'

type AliasRecord = {
  version: 1
  profileKey: string
  accountId: string
  chainKey: ClaudeRefreshChainFingerprint
}

type AliasRegistryDependencies = {
  rootPath?: string
  profilePath?: string
  accounts?: readonly ClaudeManagedAccount[]
  readManagedCredentials?: (accountId: string) => Promise<string | null>
  prune?: boolean
}

export type ManagedClaudeRefreshChainAliasStatus =
  | { status: 'unique' }
  | { status: 'unresolved' }
  | { status: 'alias-conflict'; accountIds: string[] }

export async function inspectManagedClaudeRefreshChainAliases(
  accountId: string,
  candidateChainKey: ClaudeRefreshChainFingerprint,
  dependencies: AliasRegistryDependencies = {}
): Promise<ManagedClaudeRefreshChainAliasStatus> {
  try {
    const rootPath =
      dependencies.rootPath ??
      join(homedir(), '.orca', 'claude-refresh-chain-leases', 'managed-aliases')
    const profilePath = dependencies.profilePath ?? app.getPath('userData')
    const accounts = dependencies.accounts ?? getManagedClaudeRefreshAccounts()
    const readManagedCredentials =
      dependencies.readManagedCredentials ?? readManagedClaudeRefreshCredentials
    await reconcileProfileAliases(rootPath, profilePath, accounts, readManagedCredentials, true)
    const records = readAliasRecords(rootPath)
    const aliases = records.filter((record) => record.chainKey === candidateChainKey)
    if (!aliases.some((record) => record.accountId === accountId)) {
      return { status: 'unresolved' }
    }
    const accountIds = [...new Set(aliases.map((record) => record.accountId))].sort()
    return accountIds.length > 1 ? { status: 'alias-conflict', accountIds } : { status: 'unique' }
  } catch {
    return { status: 'unresolved' }
  }
}

export async function reconcileManagedClaudeRefreshChainAliases(
  dependencies: AliasRegistryDependencies = {}
): Promise<void> {
  try {
    const rootPath =
      dependencies.rootPath ??
      join(homedir(), '.orca', 'claude-refresh-chain-leases', 'managed-aliases')
    await reconcileProfileAliases(
      rootPath,
      dependencies.profilePath ?? app.getPath('userData'),
      dependencies.accounts ?? getManagedClaudeRefreshAccounts(),
      dependencies.readManagedCredentials ?? readManagedClaudeRefreshCredentials,
      dependencies.prune ?? true
    )
  } catch {
    // Rotation still fails closed when the registry cannot be reconciled.
  }
}

async function reconcileProfileAliases(
  rootPath: string,
  profilePath: string,
  accounts: readonly ClaudeManagedAccount[],
  readManagedCredentials: (accountId: string) => Promise<string | null>,
  prune: boolean
): Promise<void> {
  mkdirSync(rootPath, { recursive: true, mode: 0o700 })
  const profileKey = stableKey(profilePath)
  const profileDirectory = join(rootPath, profileKey)
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 })
  const expectedFiles = new Set<string>()
  for (const account of accounts) {
    if (account.authMethod !== 'subscription-oauth') {
      continue
    }
    const credentialsJson = await readManagedCredentials(account.id)
    const chainKey = credentialsJson ? fingerprintClaudeRefreshChain(credentialsJson) : null
    if (!chainKey) {
      continue
    }
    const filename = `${stableKey(account.id)}.json`
    expectedFiles.add(filename)
    writeAliasRecord(join(profileDirectory, filename), {
      version: 1,
      profileKey,
      accountId: account.id,
      chainKey
    })
  }
  if (prune) {
    for (const filename of readdirSync(profileDirectory)) {
      if (filename.endsWith('.json') && !expectedFiles.has(filename)) {
        rmSync(join(profileDirectory, filename), { force: true })
      }
    }
  }
}

function writeAliasRecord(path: string, record: AliasRecord): void {
  const temporaryPath = `${path}.${process.pid}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(record), {
    encoding: 'utf8',
    flag: 'w',
    mode: 0o600
  })
  renameSync(temporaryPath, path)
}

function readAliasRecords(rootPath: string): AliasRecord[] {
  const records: AliasRecord[] = []
  for (const profileName of readdirSync(rootPath)) {
    const profilePath = join(rootPath, profileName)
    for (const filename of safeReadDirectory(profilePath)) {
      if (!filename.endsWith('.json')) {
        continue
      }
      const record = readAliasRecord(join(profilePath, filename))
      if (record && record.profileKey === basename(profilePath)) {
        records.push(record)
      }
    }
  }
  return records
}

function safeReadDirectory(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

function readAliasRecord(path: string): AliasRecord | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<AliasRecord>
    if (
      value.version !== 1 ||
      typeof value.profileKey !== 'string' ||
      typeof value.accountId !== 'string' ||
      typeof value.chainKey !== 'string' ||
      value.chainKey.length !== 32
    ) {
      return null
    }
    return value as AliasRecord
  } catch {
    return null
  }
}

function stableKey(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24)
}
