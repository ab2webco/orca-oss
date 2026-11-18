import {
  ALL_EXECUTION_HOSTS_SCOPE,
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostKind,
  type ExecutionHostScope
} from '../../../../shared/execution-host'
import type { ExecutionHostHealth } from '../../../../shared/execution-host-registry'
import type { RuntimeCompatVerdict } from '../../../../shared/protocol-compat'
import type { SshConnectionStatus } from '../../../../shared/ssh-types'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Row, WorktreeRow } from './worktree-list/grouping/row-types'
import { getProjectGroupExecutionHostIdForRows } from './worktree-list/listing/host-filtering'
import { localHostDisplayLabel, localHostPlatformDetail } from '../../lib/local-host-display-label'
import { countWorktreeRows } from './host-section-worktree-count'

export type HostHeaderRow = {
  type: 'host-header'
  key: string
  hostId: ExecutionHostId
  kind: ExecutionHostKind
  label: string
  detail: string
  health: ExecutionHostHealth
  // Why: blocked-host guidance in the header menu needs the verdict reason so
  // it can deep-link an "Update server/client required" row per skew direction.
  compatibility?: RuntimeCompatVerdict
  connectionStatus?: SshConnectionStatus
  collapsed: boolean
  count: number
  // Why: the header counts the section's active agents from these (V30's '1 activo').
  worktreeIds: readonly string[]
}

export type HostSectionRow = Row | HostHeaderRow

export type HostSectionOption = {
  id: ExecutionHostId
  kind: ExecutionHostKind
  label: string
  detail: string
  health: ExecutionHostHealth
  compatibility?: RuntimeCompatVerdict
  connectionStatus?: SshConnectionStatus
}

function getRepoHostId(
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  // Why: explicit executionHostId must win over the focused/default host, or
  // runtime-owned repos group under whichever host happens to be focused.
  if (repo?.connectionId || repo?.executionHostId) {
    return getRepoExecutionHostId(repo)
  }
  return defaultHostId
}

function getSshHostId(connectionId: string): ExecutionHostId {
  return `ssh:${encodeURIComponent(connectionId)}` as ExecutionHostId
}

function getFolderWorkspaceHostId(
  folderWorkspace: Pick<FolderWorkspace, 'connectionId'>,
  projectGroup: Pick<ProjectGroup, 'connectionId'>,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  const connectionId = folderWorkspace.connectionId ?? projectGroup.connectionId
  return connectionId ? getSshHostId(connectionId) : defaultHostId
}

function getRowHostId(row: Row, defaultHostId: ExecutionHostId): ExecutionHostId | null {
  switch (row.type) {
    case 'item':
      return getWorktreeExecutionHostId(row.worktree, row.repo, defaultHostId)
    case 'pending-creation':
    case 'imported-worktrees-card':
    case 'new-external-worktrees-inbox':
      return getRepoHostId(row.repo, defaultHostId)
    case 'folder-workspace':
      return getFolderWorkspaceHostId(row.folderWorkspace, row.projectGroup, defaultHostId)
    case 'header':
      // Why: a project split per host (ORCA-1181) names its host; its anchor repo could differ.
      if (row.repo && row.hostId) {
        return row.hostId
      }
      if (row.projectGroup?.id != null) {
        return getProjectGroupExecutionHostIdForRows(row.projectGroup, defaultHostId)
      }
      return row.repo ? getRepoHostId(row.repo, defaultHostId) : null
  }
}

function getFallbackHost(hostId: ExecutionHostId): HostSectionOption {
  const isLocal = hostId === LOCAL_EXECUTION_HOST_ID
  return {
    id: hostId,
    kind: isLocal ? 'local' : hostId.startsWith('ssh:') ? 'ssh' : 'runtime',
    label: isLocal ? localHostDisplayLabel() : hostId,
    detail: isLocal ? localHostPlatformDetail() : 'Host',
    health: isLocal ? 'local' : 'available'
  }
}

function localizePendingRowsForHost(
  rows: readonly Extract<Row, { type: 'header' }>[],
  hostId: ExecutionHostId
): Extract<Row, { type: 'header' }>[] {
  const localized: Extract<Row, { type: 'header' }>[] = []
  for (const row of rows) {
    if (!row.hostWorktreeCounts) {
      localized.push(row)
      continue
    }
    const count = row.hostWorktreeCounts.get(hostId)
    if (count !== undefined && count > 0) {
      localized.push({
        ...row,
        count,
        hostId,
        worktreeIds: row.hostWorktreeIds?.get(hostId) ?? row.worktreeIds
      })
    }
  }
  return localized
}

function getPendingRowsKey(rows: readonly Extract<Row, { type: 'header' }>[]): string {
  return rows
    .map(
      (pendingRow) =>
        `${pendingRow.key}:${pendingRow.count}:${pendingRow.worktreeIds?.join(',') ?? ''}`
    )
    .join('\0')
}

// Why: V30 draws orgs and projects at their host's level, so the host is the only outer step.
function flatUnderHost(row: Row): Row {
  if (row.type === 'header') {
    return row.projectGroupDepth ? { ...row, projectGroupDepth: 0 } : row
  }
  if (row.type === 'item') {
    // Why no host chip: the host header above already names the host (ORCA-1181).
    const flat: WorktreeRow = { ...row, groupDepth: 0, underHostHeader: true }
    delete flat.hostContextLabel
    return flat
  }
  // Why 1: a folder workspace's depth counts its own folder group, which now sits at 0.
  if (row.type === 'folder-workspace') {
    return { ...row, groupDepth: Math.min(row.groupDepth, 1), underHostHeader: true }
  }
  return row
}

/**
 * Whether host cards can be drawn at all: the scope shows more than one host and the registry
 * knows more than one. They draw when, in addition, two hosts own rows.
 */
export function canDrawHostSections(
  args: Pick<
    Parameters<typeof addHostSectionRows>[0],
    'hostOptions' | 'workspaceHostScope' | 'visibleWorkspaceHostIds'
  >
): boolean {
  // Why no default-view bypass (ORCA-1181): two hosts with rows always get headers, filter or not.
  const visibleHostIds =
    args.visibleWorkspaceHostIds ??
    (args.workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [args.workspaceHostScope])
  return !(visibleHostIds && visibleHostIds.length <= 1) && args.hostOptions.length > 1
}

export function addHostSectionRows(args: {
  rows: readonly Row[]
  hostOptions: readonly HostSectionOption[]
  workspaceHostScope: ExecutionHostScope
  visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
  defaultHostId: ExecutionHostId
  // Why: host sections reuse the sidebar's persisted collapsed-group keys
  // (`host:<hostId>`) so collapse state survives restarts like other groups.
  collapsedHostKeys?: ReadonlySet<string>
  forceCollapseHosts?: boolean
}): HostSectionRow[] {
  if (!canDrawHostSections(args)) {
    return [...args.rows]
  }

  const hostOptionsById = new Map(args.hostOptions.map((host) => [host.id, host]))
  const rowsByHostId = new Map<ExecutionHostId, Row[]>()
  const globalRows: Row[] = []
  let pendingRows: Extract<Row, { type: 'header' }>[] = []
  let pendingRowsWereUsed = false
  const pendingRowsKeyByHostId = new Map<ExecutionHostId, string>()
  const flushUnusedPendingRows = (): void => {
    if (pendingRows.length === 0 || pendingRowsWereUsed) {
      return
    }
    const hostScopedRow = pendingRows.some((row) => row.hostWorktreeCounts)
    if (!hostScopedRow) {
      globalRows.push(...pendingRows)
      return
    }
    for (const row of pendingRows) {
      for (const [hostId, count] of row.hostWorktreeCounts ?? []) {
        if (count <= 0) {
          continue
        }
        const hostRows = rowsByHostId.get(hostId) ?? []
        const hostIds = row.hostWorktreeIds?.get(hostId)
        hostRows.push({
          ...row,
          count,
          hostId,
          worktreeIds: hostIds ?? row.worktreeIds
        })
        rowsByHostId.set(hostId, hostRows)
      }
    }
  }

  const pushHostRow = (rowHostId: ExecutionHostId, row: Row): void => {
    const hostRows = rowsByHostId.get(rowHostId) ?? []
    if (pendingRows.length > 0) {
      const localizedPendingRows = localizePendingRowsForHost(pendingRows, rowHostId)
      const pendingRowsKey = getPendingRowsKey(localizedPendingRows)
      if (
        localizedPendingRows.length > 0 &&
        pendingRowsKeyByHostId.get(rowHostId) !== pendingRowsKey
      ) {
        hostRows.push(...localizedPendingRows)
        pendingRowsKeyByHostId.set(rowHostId, pendingRowsKey)
      }
      pendingRowsWereUsed = pendingRowsWereUsed || localizedPendingRows.length > 0
    }
    hostRows.push(row)
    rowsByHostId.set(rowHostId, hostRows)
  }
  for (const row of args.rows) {
    const rowHostId = getRowHostId(row, args.defaultHostId)
    if (rowHostId) {
      pushHostRow(rowHostId, row)
      continue
    }
    // Why: status/"All" headers describe the rows that follow. Buffer them
    // for every host-owned run so host remains above the existing grouping.
    if (row.type === 'header') {
      flushUnusedPendingRows()
      pendingRows = [row]
      pendingRowsWereUsed = false
    } else {
      globalRows.push(row)
    }
  }

  flushUnusedPendingRows()

  const hostOrder: ExecutionHostId[] = []
  for (const host of args.hostOptions) {
    if (rowsByHostId.has(host.id)) {
      hostOrder.push(host.id)
    }
  }
  for (const hostId of rowsByHostId.keys()) {
    if (!hostOptionsById.has(hostId)) {
      hostOrder.push(hostId)
    }
  }

  // Why: a lone host section is pure noise — the grouping only earns its keep
  // when there are at least two host sections to tell apart. Registered-but-
  // empty hosts stay visible in the scope picker, not as headers.
  if (rowsByHostId.size <= 1) {
    return [...args.rows]
  }

  const result: HostSectionRow[] = [...globalRows]
  for (const hostId of hostOrder) {
    const hostRows = rowsByHostId.get(hostId)
    if (!hostRows || hostRows.length === 0) {
      continue
    }
    const host = hostOptionsById.get(hostId) ?? getFallbackHost(hostId)
    const collapsed =
      args.forceCollapseHosts || (args.collapsedHostKeys?.has(`host:${host.id}`) ?? false)
    const { count, worktreeIds } = countWorktreeRows(hostRows)
    result.push({
      type: 'host-header',
      key: `host:${host.id}`,
      hostId: host.id,
      kind: host.kind,
      label: host.label,
      detail: host.detail,
      health: host.health,
      compatibility: host.compatibility,
      connectionStatus: host.connectionStatus,
      collapsed,
      count,
      worktreeIds
    })
    if (!collapsed) {
      result.push(...hostRows.map(flatUnderHost))
    }
  }

  return result
}
