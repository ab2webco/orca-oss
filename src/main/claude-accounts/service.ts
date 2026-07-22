/* eslint-disable max-lines -- Why: Claude managed accounts need one audited owner
for login, credential capture, Keychain storage, selection, and rate-limit refresh. */
import { randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type {
  ClaudeManagedAccount,
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../shared/types'
import type { Store } from '../persistence'
import type { RateLimitService } from '../rate-limits/service'
import { resolveClaudeCommand } from '../codex-cli/command'
import type { ClaudeRuntimeAuthService } from './runtime-auth-service'
import {
  getClaudeManagedAccountsRoot,
  readClaudeManagedAuthFile,
  resolveOwnedClaudeManagedAuthPath,
  writeClaudeManagedAuthFile
} from './managed-auth-path'
import {
  deleteActiveClaudeKeychainCredentialsStrict,
  deleteManagedClaudeKeychainCredentials,
  readActiveClaudeKeychainCredentials,
  readActiveClaudeKeychainCredentialsStrict,
  readManagedClaudeKeychainCredentials,
  writeActiveClaudeKeychainCredentials,
  writeManagedClaudeKeychainCredentials
} from './keychain'
import {
  beginClaudeAuthSwitch,
  endClaudeAuthSwitch,
  hasLiveInjectedClaudePtysForAccount,
  hasLiveSharedClaudePtysForAccount,
  runManagedClaudeAccountMutation
} from './live-pty-gate'
import { findDuplicateClaudeAccount } from './claude-duplicate-account'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { toWindowsWslPath } from '../wsl'
import { buildEncodedWslBashCommand } from '../wsl-bash-command'
import {
  getClaudeSelectionTargetForAccount,
  getSelectedClaudeAccountIdForTarget,
  normalizeClaudeAccountSelectionTarget,
  normalizeClaudeRuntimeSelection,
  pruneInvalidClaudeRuntimeSelection,
  removeClaudeAccountIdFromSelection,
  setSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from './runtime-selection'
import { getRepoIdFromWorktreeId } from '../../shared/worktree-id'

const LOGIN_TIMEOUT_MS = 180_000
const STATUS_TIMEOUT_MS = 20_000
const MAX_COMMAND_OUTPUT_CHARS = 4_000
// Claude leaves the login process running after an OAuth denial; fail fast so Settings can clear loading state.
const CLAUDE_AUTH_DENIED_PATTERN =
  /\baccess_denied\b|authorization (?:request )?(?:was )?denied|sign-?in (?:was )?denied|login (?:was )?denied/i

type ClaudeIdentity = {
  email: string | null
  organizationUuid: string | null
  organizationName: string | null
}

type CapturedClaudeAuth = {
  credentialsJson: string
  oauthAccount: unknown
  identity: ClaudeIdentity
}

type ManagedClaudeAuthSnapshot = {
  credentialsJson: string | null
  oauthAccountJson: string | null
}

export type ClaudeAccountAddTarget = {
  runtime?: 'host' | 'wsl'
  wslDistro?: string | null
}

export type ClaudeCustomEndpointAccountInput = {
  label: string
  baseUrl: string
  token: string
  model?: string | null
}

const DEFAULT_CUSTOM_ENDPOINT_MODEL = 'glm-5.1'
// Why: the claude CLI stalls for minutes on slow GLM responses with the default timeout.
const CUSTOM_ENDPOINT_API_TIMEOUT_MS = '3000000'

type ManagedClaudeAuthLocation = {
  managedAuthPath: string
  managedAuthRuntime: 'host' | 'wsl'
  wslDistro: string | null
  wslLinuxAuthPath: string | null
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export class ClaudeAccountService {
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private cancelPendingClaudeLogin: (() => boolean) | null = null

  constructor(
    private readonly store: Store,
    private readonly rateLimits: RateLimitService,
    private readonly runtimeAuth: ClaudeRuntimeAuthService,
    private readonly onWorktreeAccountPinsChanged?: (repoId: string) => void
  ) {}

  listAccounts(): ClaudeRateLimitAccountsState {
    this.normalizeActiveSelection()
    return this.getSnapshot()
  }

  async addAccount(target?: ClaudeAccountAddTarget): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() => this.doAddAccount(target))
  }

  async addCustomEndpointAccount(
    input: ClaudeCustomEndpointAccountInput
  ): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() => this.doAddCustomEndpointAccount(input))
  }

  async reauthenticateAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() =>
      this.withManagedAccountMutation(accountId, () => this.doReauthenticateAccount(accountId))
    )
  }

  async removeAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() =>
      this.withManagedAccountMutation(accountId, () => this.doRemoveAccount(accountId))
    )
  }

  async selectAccount(accountId: string | null): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() =>
      accountId
        ? this.withManagedAccountMutation(accountId, () => this.doSelectAccount(accountId))
        : this.doSelectAccount(accountId)
    )
  }

  async selectAccountForTarget(
    accountId: string | null,
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() =>
      accountId
        ? this.withManagedAccountMutation(accountId, () => this.doSelectAccount(accountId, target))
        : this.doSelectAccount(accountId, target)
    )
  }

  cancelPendingLogin(): boolean {
    return this.cancelPendingClaudeLogin?.() ?? false
  }

  private serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(fn, fn)
    this.mutationQueue = next.catch(() => {})
    return next
  }

  private async withManagedAccountMutation<T>(
    accountId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return runManagedClaudeAccountMutation(accountId, operation)
  }

  private async doAddAccount(
    target?: ClaudeAccountAddTarget
  ): Promise<ClaudeRateLimitAccountsState> {
    const accountId = randomUUID()
    const managedAuth = this.createManagedAuthDir(accountId, target)
    const { managedAuthPath } = managedAuth
    const previousSettings = this.store.getSettings()
    let duplicateIdentityFound = false

    try {
      const captured = await this.runClaudeLoginAndCapture(managedAuth)
      if (!captured.identity.email) {
        throw new Error('Claude login completed, but Orca could not resolve the account email.')
      }
      // Why: duplicate rows confuse account selection and rate-limit tracking;
      // the per-row Re-authenticate action already refreshes credentials.
      if (
        // Why: a custom-endpoint label is a free-form string, not an OAuth
        // identity; it must never block adding the real account of that email.
        findDuplicateClaudeAccount(
          previousSettings.claudeManagedAccounts.filter(
            (account) => account.authMethod !== 'custom-endpoint'
          ),
          {
            email: captured.identity.email,
            organizationUuid: captured.identity.organizationUuid,
            managedAuthRuntime: managedAuth.managedAuthRuntime,
            wslDistro: managedAuth.wslDistro
          }
        )
      ) {
        duplicateIdentityFound = true
        throw new Error('This Claude account is already added.')
      }
      await this.writeManagedAuth(accountId, managedAuthPath, captured)

      const now = Date.now()
      const account: ClaudeManagedAccount = {
        id: accountId,
        email: captured.identity.email,
        managedAuthPath,
        managedAuthRuntime: managedAuth.managedAuthRuntime,
        wslDistro: managedAuth.wslDistro,
        wslLinuxAuthPath: managedAuth.wslLinuxAuthPath,
        authMethod: 'subscription-oauth',
        organizationUuid: captured.identity.organizationUuid,
        organizationName: captured.identity.organizationName,
        createdAt: now,
        updatedAt: now,
        lastAuthenticatedAt: now
      }

      const selection = normalizeClaudeRuntimeSelection(previousSettings)
      this.store.updateSettings({
        claudeManagedAccounts: [...previousSettings.claudeManagedAccounts, account],
        activeClaudeManagedAccountId: selection.host,
        activeClaudeManagedAccountIdsByRuntime: selection
      })
      this.runtimeAuth.clearLastWrittenCredentialsJson(accountId)
      this.rateLimits.evictInactiveClaudeCache(accountId)
      return this.getSnapshot()
    } catch (error) {
      // Duplicate detection precedes every credential/settings write, so only
      // its throwaway auth directory needs cleanup.
      if (!duplicateIdentityFound) {
        this.restoreClaudeSettings(previousSettings)
        await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
      }
      await this.safeRemoveManagedAuth(accountId, managedAuthPath)
      throw error
    }
  }

  private async doAddCustomEndpointAccount(
    input: ClaudeCustomEndpointAccountInput
  ): Promise<ClaudeRateLimitAccountsState> {
    const label = input.label.trim()
    if (!label) {
      throw new Error('Enter a label for the custom endpoint account.')
    }
    const baseUrl = input.baseUrl.trim()
    if (!this.isHttpUrl(baseUrl)) {
      throw new Error('The endpoint base URL must be a valid http(s) URL.')
    }
    const token = input.token.trim()
    if (!token) {
      throw new Error('Enter the endpoint API token.')
    }
    const model = this.normalizeField(input.model) ?? DEFAULT_CUSTOM_ENDPOINT_MODEL
    const previousSettings = this.store.getSettings()
    // Why: the label is the account's display identity; two identical labels
    // would be indistinguishable in the switcher and the Assign Account menu.
    if (
      previousSettings.claudeManagedAccounts.some(
        (account) =>
          account.authMethod === 'custom-endpoint' &&
          account.email.trim().toLowerCase() === label.toLowerCase()
      )
    ) {
      throw new Error('A custom endpoint account with this label already exists.')
    }

    const accountId = randomUUID()
    const managedAuth = this.createManagedAuthDir(accountId)
    try {
      // Why: the claude CLI reads this env at startup from CLAUDE_CONFIG_DIR;
      // the token lives only here (mode 600), never in Orca settings.
      writeClaudeManagedAuthFile(
        managedAuth.managedAuthPath,
        'settings.json',
        `${JSON.stringify(
          {
            env: {
              ANTHROPIC_BASE_URL: baseUrl,
              ANTHROPIC_AUTH_TOKEN: token,
              ANTHROPIC_MODEL: model,
              API_TIMEOUT_MS: CUSTOM_ENDPOINT_API_TIMEOUT_MS
            }
          },
          null,
          2
        )}\n`
      )

      const now = Date.now()
      const account: ClaudeManagedAccount = {
        id: accountId,
        email: label,
        managedAuthPath: managedAuth.managedAuthPath,
        managedAuthRuntime: managedAuth.managedAuthRuntime,
        wslDistro: managedAuth.wslDistro,
        wslLinuxAuthPath: managedAuth.wslLinuxAuthPath,
        authMethod: 'custom-endpoint',
        organizationUuid: null,
        organizationName: null,
        endpointLabel: label,
        endpointBaseUrl: baseUrl,
        endpointModel: model,
        createdAt: now,
        updatedAt: now,
        lastAuthenticatedAt: now
      }
      const selection = normalizeClaudeRuntimeSelection(previousSettings)
      this.store.updateSettings({
        claudeManagedAccounts: [...previousSettings.claudeManagedAccounts, account],
        activeClaudeManagedAccountId: selection.host,
        activeClaudeManagedAccountIdsByRuntime: selection
      })
      return this.getSnapshot()
    } catch (error) {
      this.restoreClaudeSettings(previousSettings)
      await this.safeRemoveManagedAuth(accountId, managedAuth.managedAuthPath)
      throw error
    }
  }

  private isHttpUrl(candidate: string): boolean {
    try {
      const parsed = new URL(candidate)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }

  private async doReauthenticateAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    this.assertAccountAuthIsIdle(accountId)
    const account = this.requireAccount(accountId)
    if (account.authMethod === 'custom-endpoint') {
      throw new Error(
        'Custom endpoint accounts have no OAuth re-authentication; edit or re-add the endpoint instead.'
      )
    }
    const managedAuthPath = this.assertManagedAuthPath(account.managedAuthPath, accountId)
    const previousSettings = this.store.getSettings()
    const previousManagedAuth = await this.readManagedAuthSnapshot(accountId, managedAuthPath)
    const captured = await this.runClaudeLoginAndCapture({
      managedAuthPath,
      managedAuthRuntime: account.managedAuthRuntime ?? 'host',
      wslDistro: account.wslDistro ?? null,
      wslLinuxAuthPath: account.wslLinuxAuthPath ?? null
    })
    if (!captured.identity.email) {
      throw new Error('Claude login completed, but Orca could not resolve the account email.')
    }
    // Why: the browser's active claude.ai SSO session decides whose tokens the login
    // captures; silently adopting a different identity would repoint every worktree
    // pinned to this entry at another person's account.
    if (
      account.email &&
      captured.identity.email.trim().toLowerCase() !== account.email.trim().toLowerCase()
    ) {
      try {
        await this.restoreManagedCredentialsSnapshot(
          accountId,
          managedAuthPath,
          previousManagedAuth
        )
        this.restoreManagedOauthSnapshot(accountId, managedAuthPath, previousManagedAuth)
      } catch (rollbackError) {
        console.warn(
          '[claude-accounts] Failed to restore managed auth after identity mismatch:',
          rollbackError
        )
      }
      throw new Error(
        `Claude sign-in returned ${captured.identity.email.trim()}, but this entry is ${account.email}. Sign out of claude.ai in your browser (or use a private window), then re-authenticate as ${account.email}.`
      )
    }

    const settings = this.store.getSettings()
    const now = Date.now()
    const reauthenticatedAccounts = settings.claudeManagedAccounts.map((entry) =>
      entry.id === accountId
        ? {
            ...entry,
            email: captured.identity.email!,
            organizationUuid: captured.identity.organizationUuid,
            organizationName: captured.identity.organizationName,
            updatedAt: now,
            lastAuthenticatedAt: now
          }
        : entry
    )
    let wroteManagedCredentials = false
    try {
      await this.writeManagedOauthAccount(accountId, managedAuthPath, captured.oauthAccount)
      await this.writeManagedCredentials(accountId, managedAuthPath, captured.credentialsJson)
      wroteManagedCredentials = true
      this.store.updateSettings({ claudeManagedAccounts: reauthenticatedAccounts })
      this.runtimeAuth.clearLastWrittenCredentialsJson(accountId)
      this.rateLimits.evictInactiveClaudeCache(accountId)
      await this.syncRuntimeAuthWithLivePtyGate(getClaudeSelectionTargetForAccount(account))
      await this.rateLimits.refreshForClaudeAccountChange(
        undefined,
        getClaudeSelectionTargetForAccount(account)
      )
      return this.getSnapshot()
    } catch (error) {
      let restoredManagedCredentials = false
      try {
        await this.restoreManagedCredentialsSnapshot(
          accountId,
          managedAuthPath,
          previousManagedAuth
        )
        restoredManagedCredentials = true
      } catch (rollbackError) {
        console.warn(
          '[claude-accounts] Failed to restore managed credentials during rollback:',
          rollbackError
        )
      }
      if (restoredManagedCredentials || !wroteManagedCredentials) {
        try {
          this.restoreManagedOauthSnapshot(accountId, managedAuthPath, previousManagedAuth)
        } catch (rollbackError) {
          console.warn(
            '[claude-accounts] Failed to restore managed oauth metadata during rollback:',
            rollbackError
          )
        }
      }
      if (restoredManagedCredentials) {
        this.restoreClaudeSettings(previousSettings)
        await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
      } else if (wroteManagedCredentials) {
        this.store.updateSettings({ claudeManagedAccounts: reauthenticatedAccounts })
      } else {
        this.restoreClaudeSettings(previousSettings)
      }
      throw error
    }
  }

  private async doRemoveAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    this.assertAccountAuthIsIdle(accountId)
    const account = this.requireAccount(accountId)
    const settings = this.store.getSettings()
    const nextAccounts = settings.claudeManagedAccounts.filter((entry) => entry.id !== accountId)
    const nextSelection = removeClaudeAccountIdFromSelection(
      normalizeClaudeRuntimeSelection(settings),
      accountId
    )
    const nextActiveId =
      settings.activeClaudeManagedAccountId === accountId ? null : nextSelection.host
    const previousManagedAuth = await this.readManagedAuthSnapshot(
      accountId,
      account.managedAuthPath
    )
    let restoredPins: Record<string, string | null> = {}
    let removalCommitted = false
    let credentialRemovalStarted = false
    let affectedRepoIds: string[] = []

    try {
      if (
        getSelectedClaudeAccountIdForTarget(
          settings,
          getClaudeSelectionTargetForAccount(account)
        ) === accountId
      ) {
        this.store.updateSettings({
          activeClaudeManagedAccountId: nextActiveId,
          activeClaudeManagedAccountIdsByRuntime: nextSelection
        })
        await this.syncRuntimeAuthWithLivePtyGate(getClaudeSelectionTargetForAccount(account))
      } else {
        await this.syncRuntimeAuthWithLivePtyGate(getClaudeSelectionTargetForAccount(account))
      }
      // Why: worktree creation can finish while account removal awaits auth sync.
      // Snapshot pins at the durable commit boundary so none can escape cleanup.
      const pinnedWorktreeIds = Object.entries(this.store.getAllWorktreeMeta())
        .filter(([, meta]) => meta.claudeAccountId === accountId)
        .map(([worktreeId]) => worktreeId)
      affectedRepoIds = [...new Set(pinnedWorktreeIds.map(getRepoIdFromWorktreeId))]
      const clearedPins = Object.fromEntries(pinnedWorktreeIds.map((id) => [id, null]))
      restoredPins = Object.fromEntries(pinnedWorktreeIds.map((id) => [id, accountId]))
      this.commitClaudeAccountState(
        {
          claudeManagedAccounts: nextAccounts,
          activeClaudeManagedAccountId: nextActiveId,
          activeClaudeManagedAccountIdsByRuntime: nextSelection
        },
        clearedPins
      )
      removalCommitted = true
      this.rateLimits.evictInactiveClaudeCache(accountId)
      await this.rateLimits.refreshForClaudeAccountChange(
        getSelectedClaudeAccountIdForTarget(
          settings,
          getClaudeSelectionTargetForAccount(account)
        ) === accountId
          ? accountId
          : undefined,
        getClaudeSelectionTargetForAccount(account)
      )
      credentialRemovalStarted = true
      await this.safeRemoveManagedAuth(accountId, account.managedAuthPath, { strict: true })
      for (const repoId of affectedRepoIds) {
        try {
          this.onWorktreeAccountPinsChanged?.(repoId)
        } catch (error) {
          // Why: renderer invalidation is best-effort after the durable removal;
          // an event delivery failure must not resurrect deleted credentials.
          console.warn('[claude-accounts] Failed to notify cleared worktree pins:', error)
        }
      }
      return this.getSnapshot()
    } catch (error) {
      if (credentialRemovalStarted) {
        try {
          await this.restoreManagedAuthAfterRemoval(account, previousManagedAuth)
        } catch (rollbackError) {
          // Why: never resurrect an account record when its credential rollback
          // failed; the durable removed state remains the safer side of the split.
          throw new AggregateError(
            [error, rollbackError],
            'Claude account removal failed and its credentials could not be restored.'
          )
        }
      }
      if (removalCommitted) {
        this.commitClaudeAccountState(
          {
            claudeManagedAccounts: settings.claudeManagedAccounts,
            activeClaudeManagedAccountId: settings.activeClaudeManagedAccountId,
            activeClaudeManagedAccountIdsByRuntime: settings.activeClaudeManagedAccountIdsByRuntime
          },
          restoredPins
        )
      } else {
        this.restoreClaudeSettings(settings)
      }
      await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
      throw error
    }
  }

  private async doSelectAccount(
    accountId: string | null,
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRateLimitAccountsState> {
    let effectiveTarget = target
    if (accountId !== null) {
      this.assertAccountAuthIsIdle(accountId)
      const account = this.requireAccount(accountId)
      // Why: the shared ~/.claude materialization is credential-based; endpoint
      // accounts carry no Anthropic credentials and only work via per-worktree
      // CLAUDE_CONFIG_DIR injection.
      if (account.authMethod === 'custom-endpoint') {
        throw new Error('Custom endpoint accounts can only be assigned per worktree.')
      }
      const accountTarget = getClaudeSelectionTargetForAccount(account)
      const requestedTarget = normalizeClaudeAccountSelectionTarget(target ?? accountTarget)
      const normalizedAccountTarget = normalizeClaudeAccountSelectionTarget(accountTarget)
      if (
        requestedTarget.runtime !== normalizedAccountTarget.runtime ||
        (requestedTarget.wslDistro !== null &&
          requestedTarget.wslDistro !== normalizedAccountTarget.wslDistro)
      ) {
        throw new Error('That Claude account belongs to a different runtime.')
      }
      effectiveTarget = accountTarget
    }
    const previousSettings = this.store.getSettings()
    const selection = normalizeClaudeRuntimeSelection(previousSettings)
    const outgoingAccountId = getSelectedClaudeAccountIdForTarget(previousSettings, effectiveTarget)
    const applySelection = async (): Promise<ClaudeRateLimitAccountsState> => {
      const nextSelection = setSelectedClaudeAccountIdForTarget(
        selection,
        accountId,
        effectiveTarget
      )
      this.store.updateSettings({
        activeClaudeManagedAccountId:
          effectiveTarget?.runtime === 'wsl' ? nextSelection.host : accountId,
        activeClaudeManagedAccountIdsByRuntime: nextSelection
      })
      try {
        await this.syncRuntimeAuthWithLivePtyGate(effectiveTarget)
        await this.rateLimits.refreshForClaudeAccountChange(outgoingAccountId, effectiveTarget)
        return this.getSnapshot()
      } catch (error) {
        this.restoreClaudeSettings(previousSettings)
        await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
        throw error
      }
    }
    // Why: runtime sync can read back and rewrite the account being switched
    // away from, so pinned launches must exclude that account for the full switch.
    return outgoingAccountId
      ? runManagedClaudeAccountMutation(outgoingAccountId, applySelection, true)
      : applySelection()
  }

  private getSnapshot(): ClaudeRateLimitAccountsState {
    const settings = this.store.getSettings()
    return {
      accounts: settings.claudeManagedAccounts
        .map((account) => this.toSummary(account))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      activeAccountId: normalizeClaudeRuntimeSelection(settings).host,
      activeAccountIdsByRuntime: normalizeClaudeRuntimeSelection(settings)
    }
  }

  private toSummary(account: ClaudeManagedAccount): ClaudeManagedAccountSummary {
    return {
      id: account.id,
      email: account.email,
      managedAuthRuntime: account.managedAuthRuntime ?? 'host',
      wslDistro: account.wslDistro ?? parseWslUncPath(account.managedAuthPath)?.distro ?? null,
      authMethod: account.authMethod ?? 'unknown',
      organizationUuid: account.organizationUuid ?? null,
      organizationName: account.organizationName ?? null,
      endpointLabel: account.endpointLabel ?? null,
      endpointBaseUrl: account.endpointBaseUrl ?? null,
      endpointModel: account.endpointModel ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastAuthenticatedAt: account.lastAuthenticatedAt
    }
  }

  private requireAccount(accountId: string): ClaudeManagedAccount {
    const account = this.store
      .getSettings()
      .claudeManagedAccounts.find((entry) => entry.id === accountId)
    if (!account) {
      throw new Error('That Claude account no longer exists.')
    }
    return account
  }

  private assertAccountAuthIsIdle(accountId: string): void {
    if (
      !hasLiveInjectedClaudePtysForAccount(accountId) &&
      !hasLiveSharedClaudePtysForAccount(accountId)
    ) {
      return
    }
    // Why: any live CLI owns this account's refresh chain; reauth, selecting
    // the same account again, or removal would invalidate that process.
    throw new Error(
      'This Claude account is in use by an assigned worktree. Close its Claude terminal before changing the account.'
    )
  }

  private normalizeActiveSelection(): void {
    const settings = this.store.getSettings()
    const nextSelection = pruneInvalidClaudeRuntimeSelection(
      normalizeClaudeRuntimeSelection(settings),
      settings.claudeManagedAccounts
    )
    if (
      nextSelection.host !== settings.activeClaudeManagedAccountId ||
      JSON.stringify(nextSelection) !== JSON.stringify(normalizeClaudeRuntimeSelection(settings))
    ) {
      this.store.updateSettings({
        activeClaudeManagedAccountId: nextSelection.host,
        activeClaudeManagedAccountIdsByRuntime: nextSelection
      })
    }
  }

  private restoreClaudeSettings(settings: ReturnType<Store['getSettings']>): void {
    this.store.updateSettings({
      claudeManagedAccounts: settings.claudeManagedAccounts,
      activeClaudeManagedAccountId: settings.activeClaudeManagedAccountId,
      activeClaudeManagedAccountIdsByRuntime: settings.activeClaudeManagedAccountIdsByRuntime
    })
  }

  private commitClaudeAccountState(
    settingsUpdates: Parameters<Store['commitClaudeAccountState']>[0],
    worktreeAccountIds: Parameters<Store['commitClaudeAccountState']>[1]
  ): void {
    this.store.commitClaudeAccountState(settingsUpdates, worktreeAccountIds)
  }

  private async syncRuntimeAuthWithLivePtyGate(
    target?: ClaudeAccountSelectionTarget,
    operation?: () => Promise<void>
  ): Promise<void> {
    beginClaudeAuthSwitch()
    try {
      await (operation ? operation() : this.runtimeAuth.syncForCurrentSelection(target))
    } finally {
      endClaudeAuthSwitch()
    }
  }

  private async runClaudeLoginAndCapture(
    location: ManagedClaudeAuthLocation = {
      managedAuthPath: '',
      managedAuthRuntime: 'host',
      wslDistro: null,
      wslLinuxAuthPath: null
    }
  ): Promise<CapturedClaudeAuth> {
    const tempConfig = this.createTemporaryClaudeConfigDir(location)
    const loginAbortController = new AbortController()
    this.cancelPendingClaudeLogin = () => {
      if (loginAbortController.signal.aborted) {
        return false
      }
      loginAbortController.abort()
      return true
    }
    const previousLegacyKeychain = await readActiveClaudeKeychainCredentials()
    let captured: CapturedClaudeAuth | null = null
    let captureError: unknown = null
    let cleanupError: unknown = null
    try {
      if (loginAbortController.signal.aborted) {
        throw new Error('Claude sign-in was cancelled.')
      }
      await this.runClaudeCommand(['auth', 'login', '--claudeai'], tempConfig, LOGIN_TIMEOUT_MS, {
        signal: loginAbortController.signal,
        keepStdinOpen: true
      })
      this.cancelPendingClaudeLogin = null
      const status = await this.runClaudeCommand(
        ['auth', 'status', '--json'],
        tempConfig,
        STATUS_TIMEOUT_MS,
        { allowFailure: true }
      )
      captured = await this.captureAuthFromConfigDir(
        tempConfig.windowsPath,
        status,
        previousLegacyKeychain
      )
    } catch (error) {
      captureError = error
    } finally {
      if (process.platform === 'darwin') {
        try {
          await deleteActiveClaudeKeychainCredentialsStrict(tempConfig.windowsPath)
        } catch (error) {
          console.warn('[claude-accounts] Failed to clean temporary Claude Keychain item:', error)
        }
      }
      if (process.platform === 'darwin') {
        try {
          // Why: older Claude versions ignored CLAUDE_CONFIG_DIR and wrote the
          // legacy active Keychain item. Preserve that external CLI state.
          await (previousLegacyKeychain
            ? writeActiveClaudeKeychainCredentials(previousLegacyKeychain)
            : deleteActiveClaudeKeychainCredentialsStrict())
        } catch (error) {
          cleanupError = error
        }
      }
      this.removeTemporaryClaudeConfigDir(tempConfig)
      this.cancelPendingClaudeLogin = null
    }
    if (captureError) {
      throw captureError
    }
    if (cleanupError) {
      throw cleanupError
    }
    return captured!
  }

  private createTemporaryClaudeConfigDir(location: ManagedClaudeAuthLocation): {
    windowsPath: string
    linuxPath: string | null
    wslDistro: string | null
  } {
    if (location.managedAuthRuntime !== 'wsl') {
      return {
        windowsPath: mkdtempSync(join(tmpdir(), 'orca-claude-login-')),
        linuxPath: null,
        wslDistro: null
      }
    }
    if (!location.wslDistro) {
      throw new Error('Could not resolve the active WSL distribution for Claude login.')
    }
    const linuxPath = execFileSync(
      'wsl.exe',
      [
        '-d',
        location.wslDistro,
        '--',
        'bash',
        '-lc',
        'mktemp -d "${TMPDIR:-/tmp}/orca-claude-login.XXXXXX"'
      ],
      { encoding: 'utf-8', timeout: 5000 }
    )
      .replaceAll(String.fromCharCode(0), '')
      .trim()
    if (!linuxPath.startsWith('/')) {
      throw new Error('Could not create a temporary WSL Claude login directory.')
    }
    return {
      windowsPath: toWindowsWslPath(linuxPath, location.wslDistro),
      linuxPath,
      wslDistro: location.wslDistro
    }
  }

  private removeTemporaryClaudeConfigDir(tempConfig: {
    windowsPath: string
    linuxPath: string | null
    wslDistro: string | null
  }): void {
    if (tempConfig.linuxPath && tempConfig.wslDistro) {
      try {
        execFileSync(
          'wsl.exe',
          [
            '-d',
            tempConfig.wslDistro,
            '--',
            'bash',
            '-lc',
            `rm -rf -- ${shellQuote(tempConfig.linuxPath)}`
          ],
          { encoding: 'utf-8', timeout: 5000 }
        )
      } catch {
        // Best-effort cleanup.
      }
      return
    }
    rmSync(tempConfig.windowsPath, { recursive: true, force: true })
  }

  private async captureAuthFromConfigDir(
    configDir: string,
    statusOutput: string,
    previousLegacyKeychain: string | null
  ): Promise<CapturedClaudeAuth> {
    const credentialsJson = await this.readCapturedCredentials(configDir, previousLegacyKeychain)
    if (!credentialsJson) {
      throw new Error('Claude login completed, but no OAuth credentials were captured.')
    }
    const oauthAccount = this.readOauthAccountFromConfigDir(configDir)
    const identity = this.resolveIdentity(statusOutput, oauthAccount, credentialsJson)
    return { credentialsJson, oauthAccount, identity }
  }

  private async readCapturedCredentials(
    configDir: string,
    previousLegacyKeychain: string | null
  ): Promise<string | null> {
    if (process.platform === 'darwin') {
      const scopedCredentialsJson = await readActiveClaudeKeychainCredentialsStrict(configDir)
      if (scopedCredentialsJson) {
        return scopedCredentialsJson
      }
      const legacyCredentialsJson = await readActiveClaudeKeychainCredentialsStrict()
      if (legacyCredentialsJson && legacyCredentialsJson !== previousLegacyKeychain) {
        return legacyCredentialsJson
      }
    }
    const credentialsPath = join(configDir, '.credentials.json')
    return existsSync(credentialsPath) ? readFileSync(credentialsPath, 'utf-8') : null
  }

  private readOauthAccountFromConfigDir(configDir: string): unknown {
    for (const configPath of [join(configDir, '.claude.json'), join(configDir, '.config.json')]) {
      if (!existsSync(configPath)) {
        continue
      }
      try {
        const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
        if (parsed.oauthAccount) {
          return parsed.oauthAccount
        }
      } catch {
        continue
      }
    }
    return null
  }

  private resolveIdentity(
    statusOutput: string,
    oauthAccount: unknown,
    credentialsJson: string
  ): ClaudeIdentity {
    const status = this.parseJsonObject(statusOutput)
    const oauth = this.asRecord(oauthAccount)
    const credentials = this.parseJsonObject(credentialsJson)
    const credentialOauth = this.asRecord(credentials?.claudeAiOauth)

    return {
      email: this.normalizeField(
        this.readString(status, 'email') ??
          this.readString(oauth, 'emailAddress') ??
          this.readString(oauth, 'email') ??
          this.readString(credentialOauth, 'email')
      ),
      organizationUuid: this.normalizeField(
        this.readString(status, 'organizationUuid') ??
          this.readString(status, 'organizationId') ??
          this.readString(oauth, 'organizationUuid') ??
          this.readString(oauth, 'organizationId')
      ),
      organizationName: this.normalizeField(
        this.readString(status, 'organizationName') ?? this.readString(oauth, 'organizationName')
      )
    }
  }

  private async writeManagedAuth(
    accountId: string,
    managedAuthPath: string,
    captured: CapturedClaudeAuth
  ): Promise<void> {
    await this.writeManagedCredentials(accountId, managedAuthPath, captured.credentialsJson)
    await this.writeManagedOauthAccount(accountId, managedAuthPath, captured.oauthAccount)
  }

  private async writeManagedCredentials(
    accountId: string,
    managedAuthPath: string,
    credentialsJson: string
  ): Promise<void> {
    const trustedPath = this.assertManagedAuthPath(managedAuthPath, accountId)
    if (process.platform === 'darwin') {
      await writeManagedClaudeKeychainCredentials(accountId, credentialsJson)
    } else {
      writeClaudeManagedAuthFile(trustedPath, '.credentials.json', credentialsJson)
    }
  }

  private async writeManagedOauthAccount(
    accountId: string,
    managedAuthPath: string,
    oauthAccount: unknown
  ): Promise<void> {
    const trustedPath = this.assertManagedAuthPath(managedAuthPath, accountId)
    writeClaudeManagedAuthFile(
      trustedPath,
      'oauth-account.json',
      `${JSON.stringify(oauthAccount, null, 2)}\n`
    )
  }

  private async readManagedAuthSnapshot(
    accountId: string,
    managedAuthPath: string
  ): Promise<ManagedClaudeAuthSnapshot> {
    const trustedPath = this.assertManagedAuthPath(managedAuthPath, accountId)
    return {
      credentialsJson:
        process.platform === 'darwin'
          ? await readManagedClaudeKeychainCredentials(accountId)
          : readClaudeManagedAuthFile(trustedPath, '.credentials.json'),
      oauthAccountJson: readClaudeManagedAuthFile(trustedPath, 'oauth-account.json')
    }
  }

  private async restoreManagedCredentialsSnapshot(
    accountId: string,
    managedAuthPath: string,
    snapshot: ManagedClaudeAuthSnapshot
  ): Promise<void> {
    const trustedPath = this.assertManagedAuthPath(managedAuthPath, accountId)
    const credentialsPath = join(trustedPath, '.credentials.json')
    if (process.platform === 'darwin') {
      await (snapshot.credentialsJson !== null
        ? writeManagedClaudeKeychainCredentials(accountId, snapshot.credentialsJson)
        : deleteManagedClaudeKeychainCredentials(accountId))
    } else if (snapshot.credentialsJson !== null) {
      writeClaudeManagedAuthFile(trustedPath, '.credentials.json', snapshot.credentialsJson)
    } else {
      rmSync(credentialsPath, { force: true })
    }
  }

  private async restoreManagedAuthAfterRemoval(
    account: ClaudeManagedAccount,
    snapshot: ManagedClaudeAuthSnapshot
  ): Promise<void> {
    mkdirSync(account.managedAuthPath, { recursive: true })
    writeFileSync(
      join(account.managedAuthPath, '.orca-managed-claude-auth'),
      `${account.id}\n`,
      'utf-8'
    )
    await this.restoreManagedCredentialsSnapshot(account.id, account.managedAuthPath, snapshot)
    this.restoreManagedOauthSnapshot(account.id, account.managedAuthPath, snapshot)
  }

  private restoreManagedOauthSnapshot(
    accountId: string,
    managedAuthPath: string,
    snapshot: ManagedClaudeAuthSnapshot
  ): void {
    const trustedPath = this.assertManagedAuthPath(managedAuthPath, accountId)
    const oauthPath = join(trustedPath, 'oauth-account.json')
    if (snapshot.oauthAccountJson !== null) {
      writeClaudeManagedAuthFile(trustedPath, 'oauth-account.json', snapshot.oauthAccountJson)
    } else {
      rmSync(oauthPath, { force: true })
    }
  }

  private createManagedAuthDir(
    accountId: string,
    target?: ClaudeAccountAddTarget
  ): ManagedClaudeAuthLocation {
    const wslAuth = this.tryCreateWslManagedAuthDir(accountId, target)
    if (wslAuth) {
      return wslAuth
    }

    const managedAuthPath = join(this.getManagedAccountsRoot(), accountId, 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), `${accountId}\n`, 'utf-8')
    return {
      managedAuthPath: this.assertManagedAuthPath(managedAuthPath, accountId),
      managedAuthRuntime: 'host',
      wslDistro: null,
      wslLinuxAuthPath: null
    }
  }

  private tryCreateWslManagedAuthDir(
    accountId: string,
    target?: ClaudeAccountAddTarget
  ): ManagedClaudeAuthLocation | null {
    if (process.platform !== 'win32' || target?.runtime !== 'wsl') {
      return null
    }

    const distroArgs = target.wslDistro?.trim() ? ['-d', target.wslDistro.trim()] : []
    const infoOutput = execFileSync(
      'wsl.exe',
      [...distroArgs, '--', 'bash', '-lc', 'printf "%s\\n%s\\n" "$WSL_DISTRO_NAME" "$HOME"'],
      { encoding: 'utf-8', timeout: 5000 }
    )
    const [rawDistro, rawHome] = infoOutput
      .replaceAll(String.fromCharCode(0), '')
      .split(/\r?\n/)
      .map((line) => line.trim())
    const distro = target.wslDistro?.trim() || rawDistro
    const home = rawHome
    if (!distro || !home?.startsWith('/')) {
      throw new Error('Could not resolve the active WSL home directory for Claude login.')
    }

    const wslLinuxAuthPath = `${home.replace(/\/$/, '')}/.local/share/orca/claude-accounts/${accountId}/auth`
    const markerPath = `${wslLinuxAuthPath}/.orca-managed-claude-auth`
    execFileSync(
      'wsl.exe',
      [
        '-d',
        distro,
        '--',
        'bash',
        '-lc',
        `mkdir -p ${shellQuote(wslLinuxAuthPath)} && printf '%s\\n' ${shellQuote(accountId)} > ${shellQuote(markerPath)}`
      ],
      { encoding: 'utf-8', timeout: 5000 }
    )

    const managedAuthPath = toWindowsWslPath(wslLinuxAuthPath, distro)
    return {
      managedAuthPath: this.assertManagedAuthPath(managedAuthPath, accountId),
      managedAuthRuntime: 'wsl',
      wslDistro: distro,
      wslLinuxAuthPath
    }
  }

  private getManagedAccountsRoot(): string {
    const root = getClaudeManagedAccountsRoot()
    mkdirSync(root, { recursive: true })
    return root
  }

  private assertManagedAuthPath(candidatePath: string, expectedAccountId?: string): string {
    const wslInfo = parseWslUncPath(candidatePath)
    if (wslInfo) {
      if (
        !wslInfo.linuxPath.includes('/.local/share/orca/claude-accounts/') ||
        !wslInfo.linuxPath.endsWith('/auth')
      ) {
        throw new Error('Managed WSL Claude auth storage is outside Orca account storage.')
      }
      if (process.platform === 'win32') {
        try {
          const canonicalLinuxPath = execFileSync(
            'wsl.exe',
            [
              '-d',
              wslInfo.distro,
              '--',
              'bash',
              '-lc',
              buildEncodedWslBashCommand(
                [
                  'set -euo pipefail',
                  `candidate=${shellQuote(wslInfo.linuxPath)}`,
                  'managed_root="${HOME%/}/.local/share/orca/claude-accounts"',
                  'candidate_real=$(readlink -f -- "$candidate")',
                  'managed_root_real=$(readlink -f -- "$managed_root")',
                  'test -f "$candidate_real/.orca-managed-claude-auth"',
                  expectedAccountId
                    ? `test "$(cat "$candidate_real/.orca-managed-claude-auth")" = ${shellQuote(expectedAccountId)}`
                    : 'test -n "$(cat "$candidate_real/.orca-managed-claude-auth")"',
                  'case "$candidate_real" in "$managed_root_real"/*/auth) printf "%s\\n" "$candidate_real" ;; *) exit 35 ;; esac'
                ].join('\n')
              )
            ],
            { encoding: 'utf-8', timeout: 5000 }
          ).trim()
          if (!canonicalLinuxPath) {
            throw new Error('Managed Claude auth directory does not exist on disk.')
          }
          return toWindowsWslPath(canonicalLinuxPath, wslInfo.distro)
        } catch (error) {
          throw new Error('Managed WSL Claude auth storage is outside Orca account storage.', {
            cause: error
          })
        }
      }
      if (
        !existsSync(candidatePath) ||
        !existsSync(join(candidatePath, '.orca-managed-claude-auth'))
      ) {
        throw new Error('Managed Claude auth storage is not owned by Orca.')
      }
      return candidatePath
    }

    this.getManagedAccountsRoot()
    const accountId = expectedAccountId ?? this.readManagedAuthAccountIdFromPath(candidatePath)
    if (!accountId || (expectedAccountId && accountId !== expectedAccountId)) {
      throw new Error('Managed Claude auth directory does not exist on disk.')
    }
    const trustedPath = resolveOwnedClaudeManagedAuthPath(accountId, candidatePath, {
      adoptLegacyMarker: true
    })
    if (!trustedPath) {
      throw new Error('Managed Claude auth storage is not owned by Orca.')
    }
    return trustedPath
  }

  private readManagedAuthAccountIdFromPath(candidatePath: string): string | null {
    const rootPath = this.getManagedAccountsRoot()
    const relativePath = relative(resolve(rootPath), resolve(candidatePath))
    const parts = relativePath.split(sep)
    return parts.length === 2 && parts[1] === 'auth' ? parts[0] : null
  }

  private async safeRemoveManagedAuth(
    accountId: string,
    candidatePath: string,
    options?: { strict?: boolean }
  ): Promise<void> {
    try {
      const managedAuthPath = this.assertManagedAuthPath(candidatePath, accountId)
      if (process.platform === 'darwin') {
        // Why: injected launches create a config-dir-scoped credential item;
        // removing only Orca's managed item would leave usable auth orphaned.
        await deleteActiveClaudeKeychainCredentialsStrict(managedAuthPath)
      }
      rmSync(resolve(managedAuthPath, '..'), { recursive: true, force: true })
    } catch (error) {
      console.warn('[claude-accounts] Refusing to remove untrusted managed auth:', error)
      if (options?.strict) {
        throw error
      }
    }
    await deleteManagedClaudeKeychainCredentials(accountId)
  }

  private runClaudeCommand(
    args: string[],
    configDir: { windowsPath: string; linuxPath: string | null; wslDistro: string | null },
    timeoutMs: number,
    options?: { allowFailure?: boolean; signal?: AbortSignal; keepStdinOpen?: boolean }
  ): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
      const spawnConfig =
        configDir.linuxPath && configDir.wslDistro
          ? {
              command: 'wsl.exe',
              args: [
                '-d',
                configDir.wslDistro,
                '--',
                'bash',
                '-lc',
                `export CLAUDE_CONFIG_DIR=${shellQuote(configDir.linuxPath)}; exec claude ${args.map(shellQuote).join(' ')}`
              ],
              env: process.env,
              shell: false
            }
          : {
              command: resolveClaudeCommand(),
              args,
              env: {
                ...process.env,
                CLAUDE_CONFIG_DIR: configDir.windowsPath
              },
              shell: process.platform === 'win32'
            }
      const child = spawn(spawnConfig.command, spawnConfig.args, {
        // Why: Claude's browser auth can bind its callback lifetime to stdin.
        // Keeping stdin open prevents hidden managed-login runs from tearing down
        // the local callback server before the browser returns.
        stdio: [options?.keepStdinOpen ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        shell: spawnConfig.shell,
        env: spawnConfig.env,
        // Why: Claude auth can leave browser/login descendants alive after denial.
        // A process group lets cancellation terminate the whole POSIX login tree.
        detached: process.platform !== 'win32'
      })
      const stdout = child.stdout
      const stderr = child.stderr
      if (!stdout || !stderr) {
        if (options?.keepStdinOpen) {
          child.stdin?.destroy()
        }
        child.kill()
        rejectPromise(new Error('Claude command failed to open output streams.'))
        return
      }

      let settled = false
      let output = ''
      const appendOutput = (chunk: Buffer): void => {
        output = `${output}${chunk.toString()}`
        if (output.length > MAX_COMMAND_OUTPUT_CHARS) {
          output = output.slice(-MAX_COMMAND_OUTPUT_CHARS)
        }
        if (CLAUDE_AUTH_DENIED_PATTERN.test(output)) {
          // Use killChild (not child.kill) so the whole login/browser tree is torn down on
          // Windows (taskkill /t) and the detached POSIX group, matching the timeout/abort paths.
          killChild()
          settle(() => rejectPromise(new Error('Claude sign-in was denied. Please try again.')))
        }
      }
      let timeout: ReturnType<typeof setTimeout> | null = null
      const cleanupListeners = (): void => {
        if (timeout) {
          clearTimeout(timeout)
          timeout = null
        }
        stdout.off('data', appendOutput)
        stderr.off('data', appendOutput)
        child.off('error', onError)
        child.off('close', onClose)
        options?.signal?.removeEventListener('abort', onAbort)
        if (options?.keepStdinOpen) {
          child.stdin?.destroy()
        }
      }
      const settle = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        cleanupListeners()
        callback()
      }
      const timeoutError = new Error('Claude sign-in took too long to finish.')
      const cancelError = new Error('Claude sign-in was cancelled.')
      const killChild = (): void => {
        if (process.platform === 'win32' && child.pid) {
          const taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true
          })
          taskkill.on('error', () => {})
          taskkill.unref()
          return
        }
        if (process.platform !== 'win32' && child.pid) {
          try {
            process.kill(-child.pid)
            return
          } catch {
            // Fall back to the direct child if the process group is unavailable.
          }
        }
        child.kill()
      }
      timeout = setTimeout(() => {
        killChild()
        settle(() => rejectPromise(timeoutError))
      }, timeoutMs)

      const onAbort = (): void => {
        killChild()
        settle(() => rejectPromise(cancelError))
      }
      const onError = (error: Error): void => {
        settle(() => rejectPromise(error))
      }
      const onClose = (code: number | null): void => {
        settle(() => {
          if (code === 0 || options?.allowFailure) {
            resolvePromise(output)
            return
          }
          const trimmedOutput = output.trim()
          rejectPromise(
            new Error(
              trimmedOutput
                ? `Claude command failed: ${trimmedOutput}`
                : `Claude command exited with code ${code ?? 'unknown'}.`
            )
          )
        })
      }

      stdout.on('data', appendOutput)
      stderr.on('data', appendOutput)
      child.on('error', onError)
      child.on('close', onClose)
      if (options?.signal?.aborted) {
        onAbort()
      } else {
        options?.signal?.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  private parseJsonObject(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown
      return this.asRecord(parsed)
    } catch {
      return null
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }
    return value as Record<string, unknown>
  }

  private readString(value: Record<string, unknown> | null, key: string): string | null {
    const field = value?.[key]
    return typeof field === 'string' ? field : null
  }

  private normalizeField(value: string | null | undefined): string | null {
    if (!value) {
      return null
    }
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
}
