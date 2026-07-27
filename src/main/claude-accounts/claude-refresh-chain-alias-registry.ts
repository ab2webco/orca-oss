import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { ClaudeManagedAccount } from '../../shared/types'
import type {
  ManagedClaudeRefreshChainAliasConflictSet,
  ManagedClaudeRefreshChainAliasReport,
  ManagedClaudeRefreshChainAliasReportAccount
} from '../../shared/claude-refresh-chain-alias-report'
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

// The report types live in shared so the IPC/preload/renderer contract is this
// exact shape; re-exported here for main-side consumers of the registry.
export type {
  ManagedClaudeRefreshChainAliasConflictSet,
  ManagedClaudeRefreshChainAliasReport,
  ManagedClaudeRefreshChainAliasReportAccount
} from '../../shared/claude-refresh-chain-alias-report'

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

export async function reportManagedClaudeRefreshChainAliases(
  dependencies: AliasRegistryDependencies = {}
): Promise<ManagedClaudeRefreshChainAliasReport> {
  try {
    const rootPath =
      dependencies.rootPath ??
      join(homedir(), '.orca', 'claude-refresh-chain-leases', 'managed-aliases')
    const profilePath = dependencies.profilePath ?? app.getPath('userData')
    const accounts = dependencies.accounts ?? getManagedClaudeRefreshAccounts()
    await reconcileProfileAliases(
      rootPath,
      profilePath,
      accounts,
      dependencies.readManagedCredentials ?? readManagedClaudeRefreshCredentials,
      dependencies.prune ?? true
    )
    return {
      status: 'available',
      conflictSets: buildAliasConflictSets(readAliasRecords(rootPath), profilePath, accounts)
    }
  } catch {
    return { status: 'unavailable', conflictSets: [] }
  }
}

function buildAliasConflictSets(
  records: readonly AliasRecord[],
  profilePath: string,
  accounts: readonly ClaudeManagedAccount[]
): ManagedClaudeRefreshChainAliasConflictSet[] {
  const currentProfileKey = stableKey(profilePath)
  const currentAccounts = new Map(accounts.map((account) => [account.id, account]))
  const recordsByChain = new Map<ClaudeRefreshChainFingerprint, AliasRecord[]>()
  for (const record of records) {
    const chainRecords = recordsByChain.get(record.chainKey) ?? []
    if (
      !chainRecords.some(
        (candidate) =>
          candidate.profileKey === record.profileKey && candidate.accountId === record.accountId
      )
    ) {
      chainRecords.push(record)
      recordsByChain.set(record.chainKey, chainRecords)
    }
  }
  return [...recordsByChain.entries()]
    .filter(([, chainRecords]) => chainRecords.length > 1)
    .map(
      ([chainKey, chainRecords]): ManagedClaudeRefreshChainAliasConflictSet => ({
        conflictId: stableKey(chainKey),
        certainty: 'recorded-chain-match',
        accounts: chainRecords
          .map((record) => {
            const isCurrentProfile = record.profileKey === currentProfileKey
            return {
              accountId: record.accountId,
              profileKey: record.profileKey,
              profileScope: isCurrentProfile ? ('current' as const) : ('other' as const),
              email: isCurrentProfile
                ? (currentAccounts.get(record.accountId)?.email ?? null)
                : null
            }
          })
          .sort(compareReportAccounts),
        remediation: {
          action: 'reauthenticate-one-account',
          accountDirectoryPolicy: 'preserve'
        }
      })
    )
    .sort((left, right) => left.conflictId.localeCompare(right.conflictId))
}

function compareReportAccounts(
  left: ManagedClaudeRefreshChainAliasReportAccount,
  right: ManagedClaudeRefreshChainAliasReportAccount
): number {
  if (left.profileScope !== right.profileScope) {
    return left.profileScope === 'current' ? -1 : 1
  }
  return (
    left.profileKey.localeCompare(right.profileKey) || left.accountId.localeCompare(right.accountId)
  )
}

async function reconcileProfileAliases(
  rootPath: string,
  profilePath: string,
  accounts: readonly ClaudeManagedAccount[],
  readManagedCredentials: (accountId: string) => Promise<string | null>,
  prune: boolean
): Promise<void> {
  const eligibleAccounts = accounts.filter((account) => account.authMethod === 'subscription-oauth')
  if (eligibleAccounts.length === 0) {
    return
  }
  mkdirSync(rootPath, { recursive: true, mode: 0o700 })
  const profileKey = stableKey(profilePath)
  const profileDirectory = join(rootPath, profileKey)
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 })
  const expectedFiles = new Set<string>()
  for (const account of eligibleAccounts) {
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
  for (const profileName of safeReadDirectory(rootPath)) {
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
