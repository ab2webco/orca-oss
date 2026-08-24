import { z } from 'zod'

/**
 * Plugin capability model v0. The manifest declares capabilities, the user
 * consents against a fingerprint covering capabilities and worker trust, and the
 * host enforces at every plugin-callable boundary (panel bridge + worker host
 * API). Electron-free: shared by desktop main, headless serve, the relay
 * conformance path, and tests.
 *
 * A typo (or a capability from a newer Orca) fails manifest validation instead
 * of silently granting nothing.
 */

export const PLUGIN_CAPABILITY_KINDS = [
  'workspace:read',
  'terminal:send',
  'notifications:show',
  'storage',
  'secrets',
  'events:subscribe',
  'settings:own',
  'net:fetch'
] as const

export type PluginCapabilityKind = (typeof PLUGIN_CAPABILITY_KINDS)[number]

const PLUGIN_UNSCOPED_CAPABILITY_KINDS = PLUGIN_CAPABILITY_KINDS.filter(
  (kind) => kind !== 'net:fetch'
) as Exclude<PluginCapabilityKind, 'net:fetch'>[]

function normalizeNetworkHost(input: string): string | null {
  const value = input.trim().toLowerCase()
  if (value === '*') {
    return value
  }
  const wildcard = value.startsWith('*.')
  const candidate = wildcard ? value.slice(2) : value
  if (!candidate || candidate.includes('/') || candidate.includes('@')) {
    return null
  }
  try {
    const parsed = new URL(`https://${candidate}`)
    if (parsed.port || parsed.search || parsed.hash || parsed.pathname !== '/') {
      return null
    }
    const hostname = parsed.hostname.toLowerCase()
    if (wildcard && (!hostname.includes('.') || hostname.startsWith('['))) {
      return null
    }
    return wildcard ? `*.${hostname}` : hostname
  } catch {
    return null
  }
}

export const pluginNetworkHostSchema = z
  .string()
  .max(255)
  .transform((value, context) => {
    const normalized = normalizeNetworkHost(value)
    if (!normalized) {
      context.addIssue({ code: 'custom', message: 'must be a hostname or wildcard hostname' })
      return z.NEVER
    }
    return normalized
  })

const unscopedPluginCapabilitySchema = z
  .object({ kind: z.enum(PLUGIN_UNSCOPED_CAPABILITY_KINDS) })
  .strict()

const networkFetchCapabilitySchema = z
  .object({
    kind: z.literal('net:fetch'),
    hosts: z.array(pluginNetworkHostSchema).min(1).max(64)
  })
  .strict()

export const pluginCapabilitySchema = z.discriminatedUnion('kind', [
  unscopedPluginCapabilitySchema,
  networkFetchCapabilitySchema
])

export type PluginCapability = z.infer<typeof pluginCapabilitySchema>

/** Plain-language consent copy per capability. Shown verbatim in the install
 *  preview / consent dialog; keep each line honest about what is enforced. */
export const PLUGIN_CAPABILITY_DESCRIPTIONS: Record<PluginCapabilityKind, string> = {
  'workspace:read': 'Read the name, branch, and terminal list of your focused worktree',
  'terminal:send': 'Type text into a terminal you can see (always a specific terminal)',
  'notifications:show': 'Show desktop notifications labeled with the plugin name',
  storage: "Store data in the plugin's own storage folder",
  secrets: "Store and read secrets in the plugin's own encrypted vault",
  'events:subscribe':
    'Get notified when worktrees are created or removed and when agent status changes',
  'settings:own': "Read and change the plugin's own settings",
  'net:fetch': 'Connect to the declared network hosts'
}

export function describePluginCapability(capability: PluginCapability): string {
  if (capability.kind === 'net:fetch') {
    return `Connect to these network hosts: ${capability.hosts.join(', ')}`
  }
  return PLUGIN_CAPABILITY_DESCRIPTIONS[capability.kind]
}

/**
 * Canonical serialization of a capability set. Order- and duplicate-
 * insensitive so consent is stable across manifest reformatting;
 * key-sorted so future scoped fields cannot produce two encodings of the
 * same grant.
 */
export function canonicalizeCapabilitySet(capabilities: readonly PluginCapability[]): string {
  const networkHosts = [
    ...new Set(
      capabilities
        .filter((capability) => capability.kind === 'net:fetch')
        .flatMap((capability) => capability.hosts)
        .map((host) => normalizeNetworkHost(host) ?? host)
    )
  ].sort()
  const normalizedCapabilities: PluginCapability[] = capabilities.filter(
    (capability) => capability.kind !== 'net:fetch'
  )
  if (networkHosts.length > 0) {
    normalizedCapabilities.push({ kind: 'net:fetch', hosts: networkHosts })
  }
  const encoded = normalizedCapabilities.map((capability) =>
    JSON.stringify(
      Object.fromEntries(Object.entries(capability).sort(([a], [b]) => a.localeCompare(b)))
    )
  )
  return JSON.stringify([...new Set(encoded)].sort())
}

export function capabilityKinds(capabilities: readonly PluginCapability[]): PluginCapabilityKind[] {
  return [...new Set(capabilities.map((capability) => capability.kind))]
}
