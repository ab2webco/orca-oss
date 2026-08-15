import type { SkillRepairResult } from '../../../../shared/skill-freshness'
import { translate } from '@/i18n/i18n'
import { SkillRepairReview } from './SkillRepairReview'

export function SkillRepairSection({
  placementId,
  backupPath,
  onCancel,
  onRepaired
}: {
  placementId: string | null
  backupPath: string | null
  onCancel: () => void
  onRepaired: (result: Extract<SkillRepairResult, { repaired: true }>) => void
}): React.JSX.Element | null {
  if (!placementId && !backupPath) {
    return null
  }
  return (
    <>
      {placementId ? (
        <SkillRepairReview placementId={placementId} onCancel={onCancel} onRepaired={onRepaired} />
      ) : null}
      {backupPath ? (
        <div className="min-w-0 space-y-1 rounded-md border border-border bg-muted p-3">
          <p className="text-xs font-medium text-foreground">
            {translate(
              'auto.components.skills.SkillRepairReview.backupSaved',
              'Recoverable backup saved'
            )}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={backupPath}>
            {backupPath}
          </p>
        </div>
      ) : null}
    </>
  )
}
