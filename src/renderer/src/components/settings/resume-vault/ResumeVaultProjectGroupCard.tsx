import { FolderGit2 } from 'lucide-react'
import type { ResumeVaultEntry, ResumeVaultProjectGroup } from '@/lib/resume-vault-records'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { ResumeVaultRecordRow } from './ResumeVaultRecordRow'

type ResumeVaultProjectGroupCardProps = {
  group: ResumeVaultProjectGroup
  onRelease: (entry: ResumeVaultEntry) => void
  onReleaseAll: (group: ResumeVaultProjectGroup) => void
}

export function ResumeVaultProjectGroupCard({
  group,
  onRelease,
  onReleaseAll
}: ResumeVaultProjectGroupCardProps): React.JSX.Element {
  const releasableCount = group.entries.filter((entry) => !entry.isCurrentlyWorking).length

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          <FolderGit2 className="size-3.5 shrink-0" />
          <span className="truncate normal-case tracking-normal text-foreground">
            {group.identity.repoDisplayName}
          </span>
          <span className="truncate normal-case tracking-normal">
            {group.identity.worktreeDisplayName}
          </span>
          {!group.identity.isAvailable ? (
            <span className="shrink-0 normal-case tracking-normal">
              {translate('resumeVault.workspaceUnavailable', '(workspace not open)')}
            </span>
          ) : null}
        </h4>
        {releasableCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => onReleaseAll(group)}
          >
            {translate('resumeVault.releaseAllInProject', 'Release all ({{value0}})', {
              value0: releasableCount
            })}
          </Button>
        ) : null}
      </div>
      <div className="space-y-1.5">
        {group.entries.map((entry) => (
          <ResumeVaultRecordRow key={entry.paneKey} entry={entry} onRelease={onRelease} />
        ))}
      </div>
    </section>
  )
}
