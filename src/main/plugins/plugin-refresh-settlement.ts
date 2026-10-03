export async function waitForPluginRefreshSettlement(
  getCurrent: () => Promise<void>
): Promise<void> {
  while (true) {
    const pending = getCurrent()
    await pending.catch(() => undefined)
    if (pending === getCurrent()) {
      return
    }
  }
}

/** Runs refresh passes one at a time; a failed pass never blocks the next. */
export class PluginRefreshQueue {
  private chain: Promise<void> = Promise.resolve()

  enqueue(pass: () => Promise<void>): Promise<void> {
    const run = this.chain.then(pass)
    this.chain = run.catch(() => undefined)
    return run
  }

  /** Resolves once no pass is queued or running, including ones queued meanwhile. */
  settled(): Promise<void> {
    return waitForPluginRefreshSettlement(() => this.chain)
  }
}
