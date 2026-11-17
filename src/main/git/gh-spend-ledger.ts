/**
 * Orca's own gh calls against github.com in the last hour, per command shape.
 *
 * Why: the account's budget is shared with every session's own gh; GitHub reports only the
 * total, so this is the only way to tell Orca's spend from everyone else's (ORCA-877).
 */
import { currentGhCallOrigin } from './gh-call-origin'
import { findGhApiEndpoint, type GhRateLimitBucket } from './gh-rate-limit-breaker'

const WINDOW_MS = 60 * 60 * 1000
const MAX_SHAPES = 256
const TOP_SHAPES = 5

export type GhSpendShape = { shape: string; bucket: GhRateLimitBucket; calls: number }
export type GhSpendPoller = { poller: string; calls: number; shape: string }

export type GhSpend = {
  calls: Record<GhRateLimitBucket, number>
  top: GhSpendShape[]
  /** Who sent the calls, busiest first, each with its own busiest shape. */
  pollers: GhSpendPoller[]
  /** Conditional reads GitHub answered 304, which it does not bill. */
  notModified: number
}

type LedgerEntry = { poller: string; shape: string; bucket: GhRateLimitBucket; at: number[] }

const ledger = new Map<string, LedgerEntry>()
let notModifiedAt: number[] = []

const ledgerKey = (poller: string, shape: string): string => `${poller}\0${shape}`

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
  const poller = currentGhCallOrigin()
  const key = ledgerKey(poller, shape)
  const entry = ledger.get(key)
  // Why delete then set: Map order then tracks the last call, so the cap evicts the stalest shape.
  ledger.delete(key)
  ledger.set(key, { poller, shape, bucket, at: [...prune(entry?.at ?? [], now), now] })
  if (ledger.size > MAX_SHAPES) {
    const stalest = ledger.keys().next().value
    if (stalest !== undefined) {
      ledger.delete(stalest)
    }
  }
}

/** Takes back the spend `recordGhSpend` booked for a call GitHub answered 304. */
export function refundGhSpendAsNotModified(args: readonly string[], now = Date.now()): void {
  const entry = ledger.get(ledgerKey(currentGhCallOrigin(), ghCommandShape(args)))
  if (!entry?.at.length) {
    return
  }
  entry.at = entry.at.slice(0, -1)
  notModifiedAt = [...prune(notModifiedAt, now), now]
}

const busiestFirst =
  <T extends { calls: number }>(name: (one: T) => string) =>
  (a: T, b: T): number =>
    b.calls - a.calls || name(a).localeCompare(name(b))

export function ghSpendSince(sinceMs: number, now = Date.now()): GhSpend {
  const calls: Record<GhRateLimitBucket, number> = { core: 0, graphql: 0, search: 0 }
  const shapes = new Map<string, GhSpendShape>()
  const pollers = new Map<string, Map<string, number>>()
  for (const entry of ledger.values()) {
    const count = prune(entry.at, now).filter((t) => t >= sinceMs).length
    if (count === 0) {
      continue
    }
    calls[entry.bucket] += count
    const shape = shapes.get(entry.shape)
    shapes.set(entry.shape, {
      shape: entry.shape,
      bucket: entry.bucket,
      calls: (shape?.calls ?? 0) + count
    })
    const byShape = pollers.get(entry.poller) ?? new Map<string, number>()
    byShape.set(entry.shape, (byShape.get(entry.shape) ?? 0) + count)
    pollers.set(entry.poller, byShape)
  }
  const pollerOf = (poller: string, byShape: Map<string, number>): GhSpendPoller => {
    const counts = [...byShape]
      .map(([shape, n]) => ({ shape, calls: n }))
      .sort(busiestFirst((one) => one.shape))
    return {
      poller,
      calls: counts.reduce((sum, one) => sum + one.calls, 0),
      shape: counts[0].shape
    }
  }
  return {
    calls,
    top: [...shapes.values()].sort(busiestFirst((one) => one.shape)).slice(0, TOP_SHAPES),
    pollers: [...pollers]
      .map(([poller, byShape]) => pollerOf(poller, byShape))
      .sort(busiestFirst((one) => one.poller))
      .slice(0, TOP_SHAPES),
    notModified: prune(notModifiedAt, now).filter((t) => t >= sinceMs).length
  }
}

/** @internal — test-only */
export function _resetGhSpendLedger(): void {
  ledger.clear()
  notModifiedAt = []
}
