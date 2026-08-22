import { Archive } from 'lucide-react'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { getAgentLabel } from '@/lib/agent-catalog'
import type { ResumeVaultEntry, ResumeVaultProjectGroup } from '@/lib/resume-vault-records'
import {
  releaseResumeVaultProjectRecords,
  releaseResumeVaultRecord
} from '@/lib/release-resume-vault-record'
import { translate } from '@/i18n/i18n'
import { ResumeVaultProjectGroupCard } from './ResumeVaultProjectGroupCard'

type ResumeVaultSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: ResumeVaultProjectGroup[]
}

export function ResumeVaultSheet({
  open,
  onOpenChange,
  groups
}: ResumeVaultSheetProps): React.JSX.Element {
  const confirm = useConfirmationDialog()

  const handleRelease = async (entry: ResumeVaultEntry): Promise<void> => {
    const confirmed = await confirm({
      title: translate('resumeVault.confirmRelease.title', 'Release this resume record?'),
      description: translate(
        'resumeVault.confirmRelease.description',
        'Orca will no longer offer to resume this {{value0}} session. The transcript on disk is not affected.',
        { value0: getAgentLabel(entry.record.agent) }
      ),
      confirmLabel: translate('resumeVault.release', 'Release'),
      confirmVariant: 'destructive'
    })
    if (!confirmed) {
      return
    }
    releaseResumeVaultRecord({
      paneKey: entry.paneKey,
      agent: entry.record.agent,
      providerSession: entry.record.providerSession
    })
  }

  const handleReleaseAll = async (group: ResumeVaultProjectGroup): Promise<void> => {
    const releasableCount = group.entries.filter((entry) => !entry.isCurrentlyWorking).length
    const confirmed = await confirm({
      title: translate(
        'resumeVault.confirmReleaseAll.title',
        'Release {{value0}} resume records?',
        { value0: releasableCount }
      ),
      description: translate(
        'resumeVault.confirmReleaseAll.description',
        'Orca will no longer offer to resume these sessions in {{value0}}. Transcripts on disk are not affected.',
        { value0: group.identity.worktreeDisplayName }
      ),
      confirmLabel: translate('resumeVault.releaseAll', 'Release all'),
      confirmVariant: 'destructive'
    })
    if (!confirmed) {
      return
    }
    releaseResumeVaultProjectRecords(
      group.worktreeId,
      new Set(group.entries.map((entry) => entry.paneKey))
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{translate('resumeVault.title', 'Preserved agent sessions')}</SheetTitle>
          <SheetDescription>
            {translate(
              'resumeVault.description',
              "Orca keeps a resume pointer for a session it can't yet confirm has finished. Release the ones you don't need — this never deletes the transcript."
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="scrollbar-sleek flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Archive className="size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {translate('resumeVault.empty', 'No preserved resume records right now.')}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <ResumeVaultProjectGroupCard
                key={group.worktreeId}
                group={group}
                onRelease={(entry) => void handleRelease(entry)}
                onReleaseAll={(g) => void handleReleaseAll(g)}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
