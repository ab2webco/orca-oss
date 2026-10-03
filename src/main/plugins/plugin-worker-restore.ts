import type { ValidDiscoveredPlugin } from './plugin-discovery'

export type PluginWorkerRestoreOptions = {
  /** The current discovered revision, approved or not. */
  findPlugin: (pluginKey: string) => ValidDiscoveredPlugin | null
  isRestorable: (plugin: ValidDiscoveredPlugin) => boolean
  ensure: (plugin: ValidDiscoveredPlugin) => Promise<unknown>
  /** Resolves once no refresh is in flight. */
  whenSettled: () => Promise<void>
}

/**
 * Brings back workers a refresh stopped while they were running. Passes run
 * off the refresh chain so a worker's startup never holds plugin lists behind
 * it, and serially so a newer refresh's pass sees the previous outcome.
 */
export class PluginWorkerRestore {
  private readonly pending = new Set<string>()
  private chain: Promise<void> = Promise.resolve()
  private stopped = false

  constructor(private readonly options: PluginWorkerRestoreOptions) {}

  schedule(stoppedWhileRunning: readonly string[], stillApproved: ReadonlySet<string>): void {
    for (const pluginKey of stoppedWhileRunning) {
      if (stillApproved.has(pluginKey)) {
        this.pending.add(pluginKey)
      }
    }
    if (this.pending.size > 0) {
      this.chain = this.chain.then(() => this.restorePending())
    }
  }

  /** Starts no further worker; resolves when the pass in flight is done. */
  stop(): Promise<void> {
    this.stopped = true
    return this.chain
  }

  private async restorePending(): Promise<void> {
    // A refresh in flight has already revoked runtime approval but not yet
    // published its revision, so starting now would fail for no real reason.
    await this.options.whenSettled()
    await Promise.all([...this.pending].map((pluginKey) => this.restore(pluginKey)))
  }

  private async restore(pluginKey: string): Promise<void> {
    for (;;) {
      const plugin = this.options.findPlugin(pluginKey)
      if (this.stopped || !plugin?.manifest.main || !this.options.isRestorable(plugin)) {
        this.pending.delete(pluginKey)
        return
      }
      try {
        await this.options.ensure(plugin)
        this.pending.delete(pluginKey)
        return
      } catch {
        await this.options.whenSettled()
        // A newer refresh replaced this revision mid-start; start that one instead.
        if (this.options.findPlugin(pluginKey) === plugin) {
          this.pending.delete(pluginKey)
          return
        }
      }
    }
  }
}
