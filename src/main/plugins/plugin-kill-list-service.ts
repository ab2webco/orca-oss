import {
  findKilledPlugin,
  isPluginKillListTooFarInFuture,
  pluginKillListSchema,
  type PluginKillList,
  type PluginKillListEntry
} from '../../shared/plugins/plugin-kill-list'
import { cancelUnreadResponseBody } from '../lib/unread-response-body'
import {
  applyKillListExemptions,
  FORK_KILL_LIST_EXEMPTIONS,
  newlyRevokedPluginKeys
} from './plugin-kill-list-exemptions'
import { PluginKillListStore } from './plugin-kill-list-store'

// Why this stays upstream's: the list revokes plugins from upstream's
// marketplace, which this fork still consumes and does not curate. Hosting a
// copy would mean publishing an empty file and calling it a safety feature.
// `plugin-kill-list-exemptions.ts` carries the half the fork can own.
export const PLUGIN_KILL_LIST_URL = 'https://onorca.dev/plugins/kill-list.json'
const PLUGIN_KILL_LIST_DOWNLOAD_LIMIT = 4 * 1024 * 1024

type PluginKillListFetcher = () => Promise<PluginKillList>

export class PluginKillListService {
  private readonly store: PluginKillListStore
  private readonly fetcher: PluginKillListFetcher
  private readonly exemptions: ReadonlySet<string>
  private readonly listeners = new Set<() => void>()
  private currentList: PluginKillList | null = null
  private loadPromise: Promise<void> | null = null
  private refreshChain: Promise<PluginKillList> = Promise.resolve({
    version: 1,
    generatedAt: '1970-01-01T00:00:00Z',
    plugins: []
  })

  constructor(options: {
    pluginsDataDir: string
    store?: PluginKillListStore
    fetcher?: PluginKillListFetcher
    exemptions?: ReadonlySet<string>
  }) {
    this.store = options.store ?? new PluginKillListStore(options.pluginsDataDir)
    this.fetcher = options.fetcher ?? (() => fetchPluginKillList())
    this.exemptions = options.exemptions ?? FORK_KILL_LIST_EXEMPTIONS
  }

  async initialize(): Promise<void> {
    this.loadPromise ??= this.store
      .read()
      .then((killList) => {
        // Exemptions apply to the cache too: a list cached before the exemption
        // shipped would otherwise keep the plugin dead until the next refresh.
        this.currentList = killList ? this.enforce(killList) : null
      })
      .catch((error) => {
        // Why: an unusable cache must not prevent Orca from starting; a valid
        // network refresh can still restore runtime revocations this session.
        console.warn('[plugins] ignoring invalid cached plugin safety list:', error)
        this.currentList = null
      })
    await this.loadPromise
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  find(pluginKey: string): PluginKillListEntry | null {
    return this.currentList ? findKilledPlugin(this.currentList, pluginKey) : null
  }

  reason(pluginKey: string): string | null {
    return this.find(pluginKey)?.reason ?? null
  }

  snapshot(): PluginKillList | null {
    return this.currentList
  }

  refresh(): Promise<PluginKillList> {
    const refresh = this.refreshChain
      .catch(() => this.currentList ?? emptyKillList())
      .then(() => this.performRefresh())
    this.refreshChain = refresh
    return refresh
  }

  private async performRefresh(): Promise<PluginKillList> {
    await this.initialize()
    const fetched = pluginKillListSchema.parse(await this.fetcher())
    if (isPluginKillListTooFarInFuture(fetched)) {
      throw new Error('refusing a plugin kill list generated too far in the future')
    }
    if (
      this.currentList &&
      Date.parse(fetched.generatedAt) < Date.parse(this.currentList.generatedAt)
    ) {
      throw new Error('refusing to replace the plugin kill list with an older snapshot')
    }
    // The cache keeps what upstream published, not what we enforce: dropping an
    // exemption in a later release must restore the revocation without a fetch.
    await this.store.write(fetched)
    const effective = this.enforce(fetched)
    const revoked = newlyRevokedPluginKeys(this.currentList, effective)
    if (revoked.length > 0) {
      // Why: upstream can disable a plugin inside this build between two
      // launches. Without this line that change leaves no trace anywhere.
      console.info(`[plugins] upstream safety list newly revokes: ${revoked.join(', ')}`)
    }
    this.currentList = effective
    for (const listener of this.listeners) {
      listener()
    }
    return effective
  }

  private enforce(killList: PluginKillList): PluginKillList {
    const { effective, exempted } = applyKillListExemptions(killList, this.exemptions)
    if (exempted.length > 0) {
      console.info(`[plugins] this fork exempts from the safety list: ${exempted.join(', ')}`)
    }
    return effective
  }
}

export async function fetchPluginKillList(
  // Why spelled out instead of a bare `= fetch` alias: the alias never reads as
  // a call, so the global-fetch audit could not see this site at all. It is the
  // fork's one remaining upstream request — it should be the audit's business.
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  url = PLUGIN_KILL_LIST_URL
): Promise<PluginKillList> {
  const response = await fetcher(url, { cache: 'no-store' })
  // Why cancel before every throw: this is global fetch, so an unread body can
  // crash the process from inside undici (see global-fetch-call-site-audit).
  if (!response.ok) {
    await cancelUnreadResponseBody(response)
    throw new Error(`plugin kill-list request failed with HTTP ${response.status}`)
  }
  const declaredBytes = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredBytes) && declaredBytes > PLUGIN_KILL_LIST_DOWNLOAD_LIMIT) {
    await cancelUnreadResponseBody(response)
    throw new Error('plugin kill-list response exceeds its size limit')
  }
  if (!response.body) {
    throw new Error('plugin kill-list response has no body')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) {
      break
    }
    totalBytes += chunk.value.byteLength
    if (totalBytes > PLUGIN_KILL_LIST_DOWNLOAD_LIMIT) {
      await reader.cancel()
      throw new Error('plugin kill-list response exceeds its size limit')
    }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const parsed = pluginKillListSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
    if (isPluginKillListTooFarInFuture(parsed)) {
      throw new Error('generatedAt is too far in the future')
    }
    return parsed
  } catch (error) {
    throw new Error(
      `invalid plugin kill-list response: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function emptyKillList(): PluginKillList {
  return { version: 1, generatedAt: '1970-01-01T00:00:00Z', plugins: [] }
}
