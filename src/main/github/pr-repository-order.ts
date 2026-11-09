import type { GitHubOwnerRepo } from '../../shared/github/pull-request-types'
import { githubRepoIdentityKey } from '../../shared/github/repository-identity-key'
import { gitExecFileAsync } from '../git/runner'
import { REMOTE_URL_PROBE_TIMEOUT_MS } from '../git/remote-url-probe'
import { getSshGitProvider, getSshGitProviderGeneration } from '../providers/ssh-git-dispatch'
import type { GitHubRepoContext } from './github-repository-identity'

/** `remote.<name>.gh-resolved` values, as `gh repo set-default` writes them: `base` or `owner/repo`. */
export type GhResolvedRemotes = ReadonlyMap<string, string>

const GH_RESOLVED_LINE_RE = /^remote\.(.+)\.gh-resolved\s+(\S+)\s*$/
const GH_RESOLVED_CACHE_TTL_MS = 30_000
const GH_RESOLVED_CACHE_MAX_ENTRIES = 512

const ghResolvedCache = new Map<string, { value: GhResolvedRemotes; expiresAt: number }>()
const ghResolvedInFlight = new Map<string, Promise<GhResolvedRemotes>>()

/** @internal - exposed for tests only */
export function _resetGhResolvedRemotesCache(): void {
  ghResolvedCache.clear()
  ghResolvedInFlight.clear()
}

export function parseGhResolvedRemotes(stdout: unknown): GhResolvedRemotes {
  const resolved = new Map<string, string>()
  if (typeof stdout !== 'string') {
    return resolved
  }
  for (const line of stdout.split(/\r?\n/)) {
    const match = GH_RESOLVED_LINE_RE.exec(line.trim())
    if (match) {
      resolved.set(match[1], match[2])
    }
  }
  return resolved
}

async function readGhResolvedConfig(context: GitHubRepoContext): Promise<GhResolvedRemotes> {
  const args = ['config', '--get-regexp', '^remote\\..*\\.gh-resolved$']
  try {
    if (context.connectionId) {
      const provider = getSshGitProvider(context.connectionId)
      if (!provider) {
        return new Map()
      }
      const { stdout } = await provider.exec(args, context.repoPath, {
        signal: AbortSignal.timeout(REMOTE_URL_PROBE_TIMEOUT_MS)
      })
      return parseGhResolvedRemotes(stdout)
    }
    const result = await gitExecFileAsync(args, {
      cwd: context.repoPath,
      timeout: REMOTE_URL_PROBE_TIMEOUT_MS,
      ...(context.wslDistro ? { wslDistro: context.wslDistro } : {})
    })
    return parseGhResolvedRemotes(result?.stdout)
  } catch {
    // Why: git exits 1 when no remote has a gh default; any failure just keeps the origin-first order.
    return new Map()
  }
}

/** The repo's `gh repo set-default` choice, read once per repo and TTL. */
export async function readGhResolvedRemotes(
  context: GitHubRepoContext
): Promise<GhResolvedRemotes> {
  const runtimeKey = context.connectionId
    ? `ssh:${context.connectionId}:${getSshGitProviderGeneration(context.connectionId)}`
    : `local:${context.wslDistro ?? 'host'}`
  const key = `${runtimeKey}\0${context.repoPath}`
  const now = Date.now()
  const cached = ghResolvedCache.get(key)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }
  const inFlight = ghResolvedInFlight.get(key)
  if (inFlight) {
    return inFlight
  }
  const read = readGhResolvedConfig(context)
    .then((value) => {
      ghResolvedCache.delete(key)
      ghResolvedCache.set(key, { value, expiresAt: Date.now() + GH_RESOLVED_CACHE_TTL_MS })
      while (ghResolvedCache.size > GH_RESOLVED_CACHE_MAX_ENTRIES) {
        const oldest = ghResolvedCache.keys().next().value
        if (oldest === undefined) {
          break
        }
        ghResolvedCache.delete(oldest)
      }
      return value
    })
    .finally(() => ghResolvedInFlight.delete(key))
  ghResolvedInFlight.set(key, read)
  return read
}

const sameOwnerRepo = (repo: GitHubOwnerRepo, slug: string): boolean =>
  `${repo.owner}/${repo.repo}`.toLowerCase() === slug.trim().toLowerCase()

function ghDefaultRepoOf<T extends GitHubOwnerRepo>(
  remotes: { origin: T | null; upstream: T | null },
  ghResolved: GhResolvedRemotes
): T | null {
  for (const name of ['origin', 'upstream'] as const) {
    const value = ghResolved.get(name)
    const repo = remotes[name]
    if (value === 'base' && repo) {
      return repo
    }
  }
  // Why: gh also records the default as `owner/repo`; only a configured remote may win, never a new repo.
  for (const value of ghResolved.values()) {
    const match = [remotes.origin, remotes.upstream].find(
      (repo): repo is T => repo !== null && value !== 'base' && sameOwnerRepo(repo, value)
    )
    if (match) {
      return match
    }
  }
  return null
}

/**
 * The repos a PR number or branch is looked up in, most likely owner first.
 * Why (ORCA-1148): a fork hosting its own PRs shares numbers with upstream, so
 * upstream-first resolved `#936` to an unrelated upstream PR; the worktree's own
 * repo goes first unless `gh repo set-default` or an explicit preference names upstream.
 */
export function orderPullRequestRepositories<T extends GitHubOwnerRepo>(
  remotes: { origin: T | null; upstream: T | null },
  ghResolved: GhResolvedRemotes,
  preferUpstream = false
): T[] {
  const ordered = preferUpstream
    ? [remotes.upstream, remotes.origin]
    : [ghDefaultRepoOf(remotes, ghResolved), remotes.origin, remotes.upstream]
  const seen = new Set<string>()
  const candidates: T[] = []
  for (const candidate of ordered) {
    if (!candidate) {
      continue
    }
    const key = githubRepoIdentityKey(candidate)
    if (!seen.has(key)) {
      seen.add(key)
      candidates.push(candidate)
    }
  }
  return candidates
}

/** Reads the gh default only when two distinct repos make the order matter. */
export async function resolvePullRequestRepositoryOrder<T extends GitHubOwnerRepo>(
  context: GitHubRepoContext,
  remotes: { origin: T | null; upstream: T | null },
  preferUpstream = false
): Promise<T[]> {
  const { origin, upstream } = remotes
  const ambiguous =
    !preferUpstream &&
    origin !== null &&
    upstream !== null &&
    githubRepoIdentityKey(origin) !== githubRepoIdentityKey(upstream)
  const ghResolved = ambiguous ? await readGhResolvedRemotes(context) : new Map<string, string>()
  return orderPullRequestRepositories(remotes, ghResolved, preferUpstream)
}
