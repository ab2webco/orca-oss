import { normalizeGitRemoteUrl } from './git-remote-identity'
import { isFolderRepo } from './repo-kind'
import type { RepoKind } from './repo-types'

/** A repo as the member-repo check reads it, on this host or a paired one. */
export type GameRepoSummary = {
  id: string
  displayName: string
  path: string
  /** The repo's canonical git remote (`github.com/org/repo`); null without one. A fork's names its upstream. */
  remoteKey: string | null
  /**
   * The repo's own remote (a fork's origin, never an upstream it shares with other forks); null when
   * unknown. Absent from an older runtime's read, which then matches by `remoteKey` (ORCA-1198).
   */
  ownRemoteKey?: string | null
  kind?: RepoKind
}

/** What `game.memberRepoScope` reads: the lead's repo here, and the target repo where it would run. */
export type GameMemberRepoScopeRead = {
  /** The paired host's name for `--on`; null for this host. */
  host: string | null
  lead: GameRepoSummary | null
  /** The repo `--repo` selects there; null when it selects nothing. */
  repo: GameRepoSummary | null
  /** Every repo registered on the paired host; empty for this host. */
  repos: GameRepoSummary[]
}

export const GAME_REPO_OUTSIDE_PROJECT = 'repo_outside_project'

const CANONICAL_KEY = /^[^\s:/@]+\/[^\s:@]+$/

/** An orca.yaml `memberRepos` entry as a canonical remote key: a URL or `host/org/repo`. */
export function memberRepoKeyOf(entry: string): string | null {
  const text = entry.trim()
  const fromUrl = normalizeGitRemoteUrl(text)
  if (fromUrl) {
    return fromUrl
  }
  return CANONICAL_KEY.test(text)
    ? text
        .toLowerCase()
        .replace(/\/+$/, '')
        .replace(/\.git$/, '')
    : null
}

const sameKey = (a: string | null, b: string): boolean => a !== null && a.toLowerCase() === b

const ownKeyOf = (repo: GameRepoSummary): string | null =>
  repo.ownRemoteKey === undefined ? repo.remoteKey : repo.ownRemoteKey

/**
 * Whether a lead's members can start on a paired host, as `game launch --on` decides it, so the
 * Machines tab never offers a host the launch refuses (ORCA-1207). `reason` is the launch's text.
 */
export type GameHostLaunch =
  | { kind: 'ready'; repo: GameRepoSummary }
  | { kind: 'unregistered'; project: string; reason: string }
  | { kind: 'refused'; reason: string }
  /** The host did not list its repos in time (ORCA-1199). */
  | { kind: 'unanswered' }

const NO_LEAD_PROJECT =
  "Orca cannot tell this lead's project, so it launches no member with --repo."
const NO_WORKTREE = ' No worktree was created.'
const PROJECT_RULE =
  'A lead launches members only into its own repo or a repo listed in orchestratorGame.orchestrator.memberRepos.'

// Why own keys: a fork's identity is its upstream, which every other fork of it shares.
function inProjectOf(
  lead: GameRepoSummary,
  host: string | null,
  memberRepos: readonly string[] = []
): (repo: GameRepoSummary) => boolean {
  const leadKey = ownKeyOf(lead)?.toLowerCase() ?? null
  const listed = memberRepos.flatMap((entry) => {
    const key = memberRepoKeyOf(entry)
    return key ? [key.toLowerCase()] : []
  })
  return (repo) =>
    // Why only here: an id names a repo in one Orca's store, never the same one on another host.
    (host === null && repo.id === lead.id) ||
    (leadKey !== null && sameKey(ownKeyOf(repo), leadKey)) ||
    listed.some((key) => sameKey(repo.remoteKey, key) || sameKey(ownKeyOf(repo), key))
}

/** The lead's project among a paired host's repos, or why a member cannot start there. */
export function gameHostLaunchOf(args: {
  lead: GameRepoSummary | null
  host: string
  repos: readonly GameRepoSummary[]
  memberRepos?: readonly string[]
}): Exclude<GameHostLaunch, { kind: 'unanswered' }> {
  const { lead, host, repos } = args
  if (lead === null) {
    return { kind: 'refused', reason: NO_LEAD_PROJECT }
  }
  const own = repos.find(inProjectOf(lead, host, args.memberRepos))
  if (own) {
    return { kind: 'ready', repo: own }
  }
  const upstream = lead.remoteKey?.toLowerCase() ?? null
  // A host clone named by its upstream may be this fork or any other one (ORCA-1198).
  const namedByUpstream =
    upstream === null
      ? undefined
      : repos.find((repo) => ownKeyOf(repo) === null && sameKey(repo.remoteKey, upstream))
  if (namedByUpstream) {
    return {
      kind: 'refused',
      reason: `${namedByUpstream.displayName} on ${host} names ${upstream}, the upstream every fork of it shares, so Orca cannot tell it is ${lead.displayName}'s clone. If it is, list ${upstream} in orchestratorGame.orchestrator.memberRepos.`
    }
  }
  // Why not unregistered: a repo whose identity is not read yet may be this project (ORCA-1250).
  const unidentified = repos.find((repo) => repo.remoteKey === null && !isFolderRepo(repo))
  if (unidentified) {
    return {
      kind: 'refused',
      reason: `${unidentified.displayName} on ${host} has no remote identity yet, so Orca cannot tell whether it is ${lead.displayName}'s clone. See ORCA-1250.`
    }
  }
  return {
    kind: 'unregistered',
    project: lead.displayName,
    reason: `${lead.displayName} is not registered on ${host}, so no member can start there for it. With the owner's OK, clone it on ${host} and register it: orca repo add --path <path on ${host}> --environment ${host}.`
  }
}

/**
 * Why a refusal text, not a boolean: a lead must launch only into its own project, the same scope as
 * ORCA-970, and say what to do instead of borrowing another project's repo (ORCA-1156).
 */
export function gameMemberRepoRefusalOf(args: {
  read: GameMemberRepoScopeRead
  selector: string
  memberRepos?: readonly string[]
}): string | null {
  const { read, selector, memberRepos } = args
  const lead = read.lead
  if (lead === null) {
    return NO_LEAD_PROJECT
  }
  const inProject = inProjectOf(lead, read.host, memberRepos)
  if (read.host === null) {
    if (read.repo === null) {
      return `--repo ${selector} is not a repo registered in this Orca Lab.`
    }
    return inProject(read.repo)
      ? null
      : `--repo ${selector} is ${read.repo.displayName}, outside this lead's project (${lead.displayName}). ${PROJECT_RULE}`
  }
  if (read.repo && inProject(read.repo)) {
    return null
  }
  const launch = gameHostLaunchOf({ lead, host: read.host, repos: read.repos, memberRepos })
  if (launch.kind !== 'ready') {
    return `${launch.reason}${NO_WORKTREE}`
  }
  const own = launch.repo
  const there = `use --repo id:${own.id} (${own.path}).`
  return read.repo === null
    ? `--repo ${selector} is not a repo on ${read.host}; ${lead.displayName} is there: ${there}`
    : `--repo ${selector} on ${read.host} is ${read.repo.displayName}, outside this lead's project (${lead.displayName}); ${there} ${PROJECT_RULE}`
}
