import { registerHooks } from 'node:module'

const DENIED_NETWORK_MODULES = new Set([
  'net',
  'http',
  'https',
  'http2',
  'tls',
  'dns',
  'dns/promises',
  'dgram'
])

const NETWORK_HOSTS_ENV = 'ORCA_PLUGIN_NET_FETCH_HOSTS'

function deniedModuleName(specifier: string): string | null {
  const name = specifier.startsWith('node:') ? specifier.slice(5) : specifier
  return DENIED_NETWORK_MODULES.has(name) ? name : null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const denied = deniedModuleName(specifier)
    if (denied) {
      throw new Error(`Plugin network access denied: ${denied} requires net:fetch`)
    }
    return nextResolve(specifier, context)
  }
})

function readAllowedHosts(): string[] {
  const encoded = process.env[NETWORK_HOSTS_ENV]
  delete process.env[NETWORK_HOSTS_ENV]
  if (!encoded) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(encoded)
    return Array.isArray(parsed)
      ? parsed.filter((host): host is string => typeof host === 'string')
      : []
  } catch {
    return []
  }
}

function hostIsAllowed(hostname: string, patterns: readonly string[]): boolean {
  const normalized = hostname.toLowerCase()
  return patterns.some((pattern) => {
    if (pattern === '*') {
      return true
    }
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1)
      return normalized.endsWith(suffix) && normalized.length > suffix.length
    }
    return normalized === pattern
  })
}

const allowedHosts = readAllowedHosts()
const nativeFetch = globalThis.fetch?.bind(globalThis)
const NativeRequest = globalThis.Request
const NativeURL = globalThis.URL

const guardedFetch: typeof fetch = async (input, init) => {
  const request = new NativeRequest(input, init)
  if (request.url.startsWith('http://') || request.url.startsWith('https://')) {
    const hostname = new NativeURL(request.url).hostname.toLowerCase()
    if (hostIsAllowed(hostname, allowedHosts)) {
      if (!nativeFetch) {
        throw new Error('Plugin network access denied: fetch is unavailable')
      }
      return nativeFetch(request, { redirect: 'manual' })
    }
  }
  throw new Error(`Plugin network access denied: net:fetch does not allow ${request.url}`)
}

Object.defineProperty(globalThis, 'fetch', {
  value: guardedFetch,
  writable: false,
  configurable: false
})
Reflect.deleteProperty(globalThis, 'WebSocket')

type RestrictedProcess = NodeJS.Process & {
  binding?: unknown
  _linkedBinding?: unknown
  getBuiltinModule?: unknown
  dlopen?: unknown
}

const restrictedProcess = process as RestrictedProcess
for (const key of ['binding', '_linkedBinding', 'getBuiltinModule', 'dlopen'] as const) {
  Object.defineProperty(restrictedProcess, key, {
    value: undefined,
    writable: false,
    configurable: false
  })
}
