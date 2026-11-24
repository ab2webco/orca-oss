import { existsSync, readFileSync } from 'node:fs'
import type { Store } from '../persistence'
import type { Repo } from '../../shared/repo-types'
import { UsageCacheSnapshotWriter } from '../usage-cache-snapshot-writer'
import { loadKnownUsageWorktreesByRepo } from '../usage-worktree-metadata'
import type { UsageScanWorktreeRef } from './usage-provider-contract'
import { createWorktreeRefs, getUsageWorktreeFingerprint } from './usage-worktree-refs'
import { getUsageRepoLabels, type UsageRepoLabels } from './usage-repo-project-grouping'
import {
  getPreviouslyAttributedWorktreeRefs,
  getRepoWorkspaceRootRefs
} from './usage-retired-worktree-refs'

const STALE_MS = 5 * 60_000

type UsageProviderScanState = {
  enabled: boolean
  lastScanStartedAt: number | null
  lastScanCompletedAt: number | null
  lastScanError: string | null
}

type UsageProviderStoreState<SourceKey extends string> = {
  worktreeFingerprint: string | null
  sessions: unknown[]
  dailyAggregates: unknown[]
  scanState: UsageProviderScanState
} & Record<SourceKey, unknown[]>

type UsageProviderScanProjection<
  SourceKey extends string,
  State extends UsageProviderStoreState<SourceKey>
> = Pick<State, SourceKey | 'sessions' | 'dailyAggregates'>

type UsageProviderStoreLifecycleConfig<
  SourceKey extends string,
  State extends UsageProviderStoreState<SourceKey>,
  DataPresenceKey extends string
> = {
  logTag: string
  resolveCacheFile: () => string
  createDefaultState: () => State
  normalizeState: (state: State) => State
  sourceKey: SourceKey
  dataPresenceKey: DataPresenceKey
  jsonIndent?: number
  scan: (
    worktrees: UsageScanWorktreeRef[],
    previous: State[SourceKey]
  ) => Promise<UsageProviderScanProjection<SourceKey, State>>
}

type UsageProviderBackingStore = Pick<Store, 'getRepos' | 'getAllWorktreeMeta'> &
  Partial<Pick<Store, 'getSettings'>>

type PublicUsageProviderScanState<DataPresenceKey extends string> = UsageProviderScanState & {
  isScanning: boolean
} & Record<DataPresenceKey, boolean>

export abstract class UsageProviderStoreLifecycle<
  SourceKey extends string,
  State extends UsageProviderStoreState<SourceKey>,
  DataPresenceKey extends string
> {
  protected state: State
  private scanPromise: Promise<void> | null = null
  private readonly writer: UsageCacheSnapshotWriter

  constructor(
    private readonly store: UsageProviderBackingStore,
    private readonly config: UsageProviderStoreLifecycleConfig<SourceKey, State, DataPresenceKey>
  ) {
    this.writer = new UsageCacheSnapshotWriter(config.logTag, config.resolveCacheFile)
    this.state = this.load()
  }

  getScanState(): PublicUsageProviderScanState<DataPresenceKey> {
    return {
      ...this.state.scanState,
      isScanning: this.scanPromise !== null,
      [this.config.dataPresenceKey]:
        this.state.sessions.length > 0 || this.state.dailyAggregates.length > 0
    } as PublicUsageProviderScanState<DataPresenceKey>
  }

  /** Await queued cache writes so quit does not drop the final snapshot. */
  flush(): Promise<void> {
    return this.writer.flush()
  }

  async setEnabled(enabled: boolean): Promise<PublicUsageProviderScanState<DataPresenceKey>> {
    this.state.scanState.enabled = enabled
    await this.writeToDisk()
    return this.getScanState()
  }

  async refresh(force = false): Promise<PublicUsageProviderScanState<DataPresenceKey>> {
    if (!this.state.scanState.enabled) {
      return this.getScanState()
    }
    const currentWorktreeFingerprint = await this.getCurrentWorktreeFingerprint()
    if (!force && this.state.scanState.lastScanCompletedAt) {
      const ageMs = Date.now() - this.state.scanState.lastScanCompletedAt
      if (ageMs < STALE_MS && this.state.worktreeFingerprint === currentWorktreeFingerprint) {
        return this.getScanState()
      }
    }
    await this.runScan()
    return this.getScanState()
  }

  protected getRepoLabels(): UsageRepoLabels {
    return getUsageRepoLabels(this.store.getRepos())
  }

  protected writeToDisk(): Promise<void> {
    return this.writer.write(() => JSON.stringify(this.state, null, this.config.jsonIndent))
  }

  private load(): State {
    const defaults = this.config.createDefaultState()
    try {
      const cacheFile = this.config.resolveCacheFile()
      if (!existsSync(cacheFile)) {
        return defaults
      }
      const parsed = JSON.parse(readFileSync(cacheFile, 'utf-8')) as State
      return this.config.normalizeState({
        ...defaults,
        ...parsed,
        scanState: { ...defaults.scanState, ...parsed.scanState }
      })
    } catch (error) {
      console.error(`${this.config.logTag} Failed to load persisted state, starting fresh:`, error)
      return defaults
    }
  }

  private async runScan(): Promise<void> {
    if (this.scanPromise) {
      await this.scanPromise
      return
    }

    this.state.scanState.lastScanStartedAt = Date.now()
    this.state.scanState.lastScanError = null

    // Assign before yielding so concurrent refreshes share one scan.
    this.scanPromise = (async () => {
      try {
        const { repos, refs, worktreeFingerprint } = await this.loadScanWorktrees()
        const result = await this.config.scan(
          [
            ...refs,
            ...getPreviouslyAttributedWorktreeRefs(this.state.dailyAggregates, repos, refs)
          ],
          this.state.worktreeFingerprint === worktreeFingerprint
            ? this.state[this.config.sourceKey]
            : this.config.createDefaultState()[this.config.sourceKey]
        )
        this.state[this.config.sourceKey] = result[this.config.sourceKey]
        this.state.sessions = result.sessions
        this.state.dailyAggregates = result.dailyAggregates
        this.state.worktreeFingerprint = worktreeFingerprint
        this.state.scanState.lastScanCompletedAt = Date.now()
        this.state.scanState.lastScanError = null
        // Persistence failures do not turn a successful source scan into a scan failure.
        await this.writeToDisk().catch(() => {})
      } catch (error) {
        this.state.scanState.lastScanError = error instanceof Error ? error.message : String(error)
        await this.writeToDisk().catch(() => {})
      } finally {
        this.scanPromise = null
      }
    })()

    await this.scanPromise
  }

  private async getCurrentWorktreeFingerprint(): Promise<string> {
    return (await this.loadScanWorktrees()).worktreeFingerprint
  }

  private async loadScanWorktrees(): Promise<{
    repos: Repo[]
    refs: UsageScanWorktreeRef[]
    worktreeFingerprint: string
  }> {
    const repos = this.store.getRepos()
    const worktreesByRepo = loadKnownUsageWorktreesByRepo(this.store, repos)
    const rootRefs = await getRepoWorkspaceRootRefs(repos, this.store.getSettings?.() ?? null)
    const baseFingerprint = getUsageWorktreeFingerprint(worktreesByRepo)
    return {
      repos,
      refs: [...createWorktreeRefs(repos, worktreesByRepo), ...rootRefs],
      // Why: roots join the fingerprint so the first scan after upgrade re-attributes old turns.
      worktreeFingerprint:
        rootRefs.length === 0
          ? baseFingerprint
          : JSON.stringify([baseFingerprint, rootRefs.map((ref) => ref.worktreeId).sort()])
    }
  }
}
