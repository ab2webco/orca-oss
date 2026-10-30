/**
 * Orca's own gh calls against github.com in the last hour, per command shape.
 *
 * Why: the account's budget is shared with every session's own gh; GitHub reports only the
 * total, so this is the only way to tell Orca's spend from everyone else's (ORCA-877).
 */
import { findGhApiEndpoint, type GhRateLimitBucket } from './gh-rate-limit-breaker'

const WINDOW_MS = 60 * 60 * 1000
const MAX_SHAPES = 256
const TOP_SHAPES = 5

export type GhSpendShape = { shape: string; bucket: GhRateLimitBucket; calls: number }

export type GhSpend = {
  calls: Record<GhRateLimitBucket, number>
  top: GhSpendShape[]
}

const ledger = new Map<string, { bucket: GhRateLimitBucket; at: number[] }>()

const GRAPHQL_OPERATION = /^\s*(?:query|mutation)\s+([A-Za-z_]\w*)/

function graphqlOperation(args: readonly string[]): string | null {
  for (const arg of args) {
    if (arg.startsWith('query=')) {
      return GRAPHQL_OPERATION.exec(arg.slice('query='.length))?.[1] ?? null
    }
  }
  return null
}

function restPathShape(endpoint: string): string {
  const segments = endpoint.replace(/^\//, '').split('?')[0].split('/')
  return segments
    .map((segment, i) => {
      if (segments[0] === 'repos' && i === 1) {
        return ':owner'
      }
      if (segments[0] === 'repos' && i === 2) {
        return ':repo'
      }
      if (segments[i - 1] === 'commits' || /^[0-9a-f]{40}$/i.test(segment)) {
        return ':ref'
      }
      return /^\d+$/.test(segment) ? ':n' : segment
    })
    .join('/')
}

export function ghCommandShape(args: readonly string[]): string {
  if (args[0] !== 'api') {
    return args.slice(0, 2).join(' ')
  }
  const endpoint = findGhApiEndpoint(args)
  if (!endpoint) {
    return 'api'
  }
  const path = restPathShape(endpoint)
  const operation = path === 'graphql' ? graphqlOperation(args) : null
  const shape = operation ? `api graphql ${operation}` : `api ${path}`
  // Why: gh may answer these from its disk cache without spending anything.
  return args.includes('--cache') ? `${shape} (cache)` : shape
}

function prune(at: number[], now: number): number[] {
  const firstLive = at.findIndex((t) => t > now - WINDOW_MS)
  return firstLive === -1 ? [] : firstLive === 0 ? at : at.slice(firstLive)
}

export function recordGhSpend(
  args: readonly string[],
  bucket: GhRateLimitBucket,
  now = Date.now()
): void {
  const shape = ghCommandShape(args)
  const entry = ledger.get(shape)
  // Why delete then set: Map order then tracks the last call, so the cap evicts the stalest shape.
  ledger.delete(shape)
  ledger.set(shape, { bucket, at: [...prune(entry?.at ?? [], now), now] })
  if (ledger.size > MAX_SHAPES) {
    const stalest = ledger.keys().next().value
    if (stalest !== undefined) {
      ledger.delete(stalest)
    }
  }
}

export function ghSpendSince(sinceMs: number, now = Date.now()): GhSpend {
  const calls: Record<GhRateLimitBucket, number> = { core: 0, graphql: 0, search: 0 }
  const shapes: GhSpendShape[] = []
  for (const [shape, entry] of ledger) {
    const count = prune(entry.at, now).filter((t) => t >= sinceMs).length
    if (count > 0) {
      calls[entry.bucket] += count
      shapes.push({ shape, bucket: entry.bucket, calls: count })
    }
  }
  shapes.sort((a, b) => b.calls - a.calls || a.shape.localeCompare(b.shape))
  return { calls, top: shapes.slice(0, TOP_SHAPES) }
}

/** @internal — test-only */
export function _resetGhSpendLedger(): void {
  ledger.clear()
}
