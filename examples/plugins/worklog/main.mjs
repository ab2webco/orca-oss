/**
 * Worklog worker entry.
 *
 * Runs in the out-of-process plugin worker: plain Node, forked with
 * ELECTRON_RUN_AS_NODE under Node's permission model, with a scrubbed env.
 * There is no `electron`, no filesystem write, and no `process.env` from your
 * shell — everything durable goes through `orca.host.call`.
 *
 * The default export IS the activation hook. It is awaited before the host
 * marks the worker ready, so keep it short: the ready deadline is 10s
 * (src/shared/plugins/plugin-host-protocol.ts:108).
 */

const ENTRIES_KEY = 'entries'
const SETTINGS_MIRROR_KEY = 'settings-mirror'

/** Storage values are plain JSON; a fresh install reads back `undefined`. */
async function readEntries(orca) {
  const stored = await orca.host.call('storage.get', { key: ENTRIES_KEY })
  return Array.isArray(stored?.value) ? stored.value : []
}

async function writeEntries(orca, entries, maxEntries) {
  // Trim before writing: one value is capped at 256 KiB and the whole store at
  // 5 MiB (src/shared/plugins/plugin-host-api.ts:68), and a rejected write
  // comes back as an error, not a silent truncation.
  const trimmed = entries.slice(-maxEntries)
  await orca.host.call('storage.set', { key: ENTRIES_KEY, value: trimmed })
  return trimmed
}

/**
 * `settings.*` is worker-only — panels cannot call it
 * (src/shared/plugins/plugin-host-api.ts:233-252). Mirroring the resolved
 * values into a storage key is how a panel gets to see them at all.
 */
async function publishSettings(orca) {
  const result = await orca.host.call('settings.get')
  const settings = result?.settings ?? {}
  const hasToken = await orca.host
    .call('secrets.get', { key: 'exportToken' })
    .then((secret) => typeof secret?.value === 'string' && secret.value.length > 0)
    .catch(() => false)
  const mirror = {
    author: typeof settings.author === 'string' ? settings.author : 'me',
    recordNewWorktrees: settings.recordNewWorktrees !== false,
    maxEntries: typeof settings.maxEntries === 'number' ? settings.maxEntries : 50,
    // Never mirror the secret itself: the panel only needs to know it is set.
    exportTokenConfigured: hasToken,
    publishedAt: new Date().toISOString()
  }
  await orca.host.call('storage.set', { key: SETTINGS_MIRROR_KEY, value: mirror })
  return mirror
}

async function appendEntry(orca, text, source) {
  const settings = await publishSettings(orca)
  const entries = await readEntries(orca)
  entries.push({ at: new Date().toISOString(), author: settings.author, source, text })
  const saved = await writeEntries(orca, entries, settings.maxEntries)
  return { count: saved.length, entry: saved.at(-1) }
}

export default async function activate(orca) {
  // Published once on activation so a panel opened later already has values;
  // the worker is lazy, so until something triggers it the mirror is absent.
  await publishSettings(orca)

  orca.commands.register('worklog.note', async (args) => {
    // `workspace.readContext` answers for the FOCUSED worktree and returns null
    // when none is focused — it is not an error case.
    const context = await orca.host.call('workspace.readContext')
    const label = context ? `${context.displayName} (${context.branch})` : 'no focused worktree'
    const text = typeof args?.text === 'string' && args.text ? args.text : label
    const result = await appendEntry(orca, text, 'command')
    await orca.host.call('notifications.show', {
      title: 'Worklog',
      body: `Recorded: ${text}`
    })
    return result
  })

  orca.commands.register('worklog.publish-settings', () => publishSettings(orca))

  orca.commands.register('worklog.clear', async () => {
    await orca.host.call('storage.set', { key: ENTRIES_KEY, value: [] })
    return { count: 0 }
  })

  // Subscribed declaratively in the manifest, so this event is also what wakes
  // the worker when it is not running.
  orca.events.on('worktree.created', async (payload) => {
    const settings = await publishSettings(orca)
    if (!settings.recordNewWorktrees) {
      return
    }
    await appendEntry(orca, `worktree ${payload.branch || payload.worktreeId} created`, 'event')
  })
}

/** Optional. Awaited on shutdown, before the 2s grace runs out. */
export function deactivate() {
  // Nothing to release: all state already lives in host storage.
}
