import React, { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { SidebarProjectFilterPanel } from './SidebarProjectFilterPanel'
import type { Repo } from '../../../../shared/repo-types'
import { translate } from '@/i18n/i18n'
import { getRepoHostQualifiedLabels } from '@/lib/repo-display-labels'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import { buildSidebarHostOptions } from './sidebar-host-options'

function getProjectFilterVisibilityLabel({
  selectedCount,
  selectedRepos,
  labelByRepoId
}: {
  selectedCount: number
  selectedRepos: readonly Repo[]
  labelByRepoId: ReadonlyMap<string, string>
}): string {
  if (selectedCount === 0) {
    return translate(
      'auto.components.sidebar.SidebarRepositoryFilterSection.allProjects',
      'All projects'
    )
  }
  if (selectedCount === 1) {
    const selected = selectedRepos[0]
    return (
      (selected ? (labelByRepoId.get(selected.id) ?? selected.displayName) : undefined) ??
      translate('auto.components.sidebar.SidebarRepositoryFilterSection.7679f0c268', 'Projects')
    )
  }
  return translate(
    'auto.components.sidebar.SidebarRepositoryFilterSection.selectedProjectsCount',
    '{{value0}} projects',
    { value0: selectedCount }
  )
}

type SidebarRepositoryFilterSectionProps = {
  preserveWorkspaceBoardOpen?: boolean
}

const SidebarRepositoryFilterSection = React.memo(function SidebarRepositoryFilterSection({
  preserveWorkspaceBoardOpen = false
}: SidebarRepositoryFilterSectionProps) {
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const setFilterRepoIds = useAppStore((s) => s.setFilterRepoIds)
  const repos = useAppStore((s) => s.repos)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)
  const settings = useAppStore((s) => s.settings)
  // Why: this list mixes hosts, so a name repeated on another host reads "orca-oss · m1" (ORCA-1181).
  const labelByRepoId = useMemo(() => {
    const hosts = buildSidebarHostOptions({
      repos,
      sshTargetLabels,
      sshConnectionStates,
      settings,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId,
      hostLabelOverrides: getHostDisplayLabelOverrides(settings)
    })
    return getRepoHostQualifiedLabels(repos, new Map(hosts.map((host) => [host.id, host.label])))
  }, [
    repos,
    sshTargetLabels,
    sshConnectionStates,
    settings,
    runtimeEnvironments,
    runtimeStatusByEnvironmentId
  ])

  const canFilterRepos = repos.length > 1
  // Why: derive from current repos so stale ids (e.g. lingering after a repo
  // is removed) don't inflate counts or falsely signal an applied filter.
  const selectedRepoIdSet = useMemo(() => {
    const set = new Set<string>()
    for (const repo of repos) {
      if (filterRepoIds.includes(repo.id)) {
        set.add(repo.id)
      }
    }
    return set
  }, [repos, filterRepoIds])
  const selectedCount = selectedRepoIdSet.size
  const hasRepoFilter = selectedCount > 0
  const selectedRepos = useMemo(
    () => repos.filter((repo) => selectedRepoIdSet.has(repo.id)),
    [repos, selectedRepoIdSet]
  )
  const availableRepos = useMemo(
    () => repos.filter((repo) => !selectedRepoIdSet.has(repo.id)),
    [repos, selectedRepoIdSet]
  )
  const visibilityLabel = getProjectFilterVisibilityLabel({
    selectedCount,
    selectedRepos,
    labelByRepoId
  })

  const clearRepos = useCallback(() => setFilterRepoIds([]), [setFilterRepoIds])

  if (!canFilterRepos) {
    return null
  }

  // Why: same Sort-by-style single row as Hosts — label left, current value
  // right; search/selection lives in the nested panel only.
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="flex flex-1 items-center justify-between gap-3">
          <span>
            {translate(
              'auto.components.sidebar.SidebarRepositoryFilterSection.7679f0c268',
              'Projects'
            )}
          </span>
          <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
            {visibilityLabel}
          </span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="w-64"
        data-workspace-board-preserve-open={preserveWorkspaceBoardOpen ? '' : undefined}
      >
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {translate(
              'auto.components.sidebar.SidebarRepositoryFilterSection.7679f0c268',
              'Projects'
            )}
            {hasRepoFilter && (
              <span className="ml-1.5 font-medium text-foreground">· {selectedCount}</span>
            )}
          </span>
          <button
            type="button"
            onClick={clearRepos}
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent"
            disabled={!hasRepoFilter}
          >
            {translate(
              'auto.components.sidebar.SidebarRepositoryFilterSection.d3a9c4cea1',
              'Clear'
            )}
          </button>
        </div>

        <SidebarProjectFilterPanel
          availableRepos={availableRepos}
          selectedRepos={selectedRepos}
          labelByRepoId={labelByRepoId}
          hasRepoFilter={hasRepoFilter}
          filterRepoIds={filterRepoIds}
          setFilterRepoIds={setFilterRepoIds}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
})

export default SidebarRepositoryFilterSection
