import { getRepoExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import { hostDisplayLabel } from './local-host-display-label'

type RepoDisplayLabelItem = {
  path: string
  displayName: string
  connectionId?: string | null
  executionHostId?: ExecutionHostId | null
}

// Why: two repos can share the same absolute path across hosts (e.g. a local
// /Users/alice and an SSH host's /Users/alice). Keying labels by raw path alone
// lets one repo's label overwrite the other's, so scope the key by execution
// host. getRepoExecutionHostId returns 'local' for local repos and falls back to
// the connectionId (ssh:<id>) for SSH folder-repos that leave executionHostId unset.
export function getRepoDisplayLabelKey(
  item: Pick<RepoDisplayLabelItem, 'path' | 'connectionId' | 'executionHostId'>
): string {
  return `${getRepoExecutionHostId(item)}::${item.path}`
}

function normalizePathSegments(path: string): string[] {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').split('/').filter(Boolean)
}

function labelForDepth(item: RepoDisplayLabelItem, depth: number): string {
  const segments = normalizePathSegments(item.path)
  const suffix = segments.slice(Math.max(0, segments.length - depth))
  if (suffix.length === 0) {
    return item.displayName
  }
  suffix[suffix.length - 1] = item.displayName
  return suffix.join('/')
}

function hasDuplicateLabels(labels: readonly string[]): boolean {
  return new Set(labels).size !== labels.length
}

export function getRepoDisplayLabelsByPath(
  items: readonly RepoDisplayLabelItem[]
): Map<string, string> {
  const labels = new Map<string, string>()
  const itemsByName = new Map<string, RepoDisplayLabelItem[]>()

  for (const item of items) {
    const displayName = item.displayName || item.path
    labels.set(getRepoDisplayLabelKey(item), displayName)
    // Why per host (ORCA-1181): a twin on another host would drag every same-name repo to its full path.
    const collisionKey = `${getRepoExecutionHostId(item)}\0${displayName}`
    const colliding = itemsByName.get(collisionKey) ?? []
    colliding.push({ ...item, displayName })
    itemsByName.set(collisionKey, colliding)
  }

  for (const collidingItems of itemsByName.values()) {
    if (collidingItems.length < 2) {
      continue
    }
    const maxDepth = Math.max(
      ...collidingItems.map((item) => normalizePathSegments(item.path).length)
    )
    let depth = 1
    let nextLabels = collidingItems.map((item) => labelForDepth(item, depth))
    while (depth < maxDepth && hasDuplicateLabels(nextLabels)) {
      depth += 1
      nextLabels = collidingItems.map((item) => labelForDepth(item, depth))
    }
    collidingItems.forEach((item, index) => {
      labels.set(getRepoDisplayLabelKey(item), nextLabels[index] ?? item.displayName)
    })
  }

  return labels
}

/** Labels for lists that mix hosts: a label repeated on another host gains " · <host>". */
export function getRepoHostQualifiedLabels(
  repos: readonly (RepoDisplayLabelItem & { id: string })[],
  hostLabelById: ReadonlyMap<string, string>
): Map<string, string> {
  const labelsByKey = getRepoDisplayLabelsByPath(repos)
  const hostIdsByLabel = new Map<string, Set<string>>()
  const baseById = new Map<string, { label: string; hostId: ExecutionHostId }>()
  for (const repo of repos) {
    const label = labelsByKey.get(getRepoDisplayLabelKey(repo)) ?? repo.displayName
    const hostId = getRepoExecutionHostId(repo)
    baseById.set(repo.id, { label, hostId })
    hostIdsByLabel.set(label, (hostIdsByLabel.get(label) ?? new Set()).add(hostId))
  }
  const labels = new Map<string, string>()
  for (const [id, { label, hostId }] of baseById) {
    const repeatsOnAnotherHost = (hostIdsByLabel.get(label)?.size ?? 0) > 1
    labels.set(
      id,
      repeatsOnAnotherHost
        ? `${label} · ${hostLabelById.get(hostId) ?? hostDisplayLabel(hostId)}`
        : label
    )
  }
  return labels
}
