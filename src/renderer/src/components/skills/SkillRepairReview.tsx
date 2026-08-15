import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { SkillRepairPreview, SkillRepairResult } from '../../../../shared/skill-freshness'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'

export function SkillRepairReview({
  placementId,
  onCancel,
  onRepaired
}: {
  placementId: string
  onCancel: () => void
  onRepaired: (result: Extract<SkillRepairResult, { repaired: true }>) => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<SkillRepairPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [repairing, setRepairing] = useState(false)

  useEffect(() => {
    let active = true
    setPreview(null)
    setError(null)
    void window.api.skills.previewRepair(placementId).then(
      (result) => active && setPreview(result),
      (reason: unknown) =>
        active && setError(reason instanceof Error ? reason.message : String(reason))
    )
    return () => {
      active = false
    }
  }, [placementId])

  const handleRepair = async (): Promise<void> => {
    if (!preview || repairing) {
      return
    }
    setRepairing(true)
    setError(null)
    try {
      const result = await window.api.skills.repairUnrecognized({
        placementId: preview.placementId,
        expectedObservedPackageDigest: preview.expectedObservedPackageDigest
      })
      if (result.repaired) {
        onRepaired(result)
      } else {
        setError(result.message)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRepairing(false)
    }
  }

  return (
    <section className="min-w-0 space-y-3 rounded-md border border-border bg-card p-3">
      <div className="space-y-1">
        <h3 className="text-[13px] font-medium text-foreground">
          {translate('auto.components.skills.SkillRepairReview.title', 'Review replacement')}
        </h3>
        <p className="text-xs leading-5 text-muted-foreground">
          {translate(
            'auto.components.skills.SkillRepairReview.description',
            'Orca will keep a recoverable backup, then reinstall through the official installer.'
          )}
        </p>
      </div>
      {!preview && !error ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {translate('auto.components.skills.SkillRepairReview.loading', 'Comparing copies…')}
        </div>
      ) : null}
      {preview ? (
        <>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.skills.SkillRepairReview.summary',
              '{{value0}} installed line will be removed · {{value1}} official line will be added',
              { value0: preview.removedLines, value1: preview.addedLines }
            )}
          </p>
          <pre className="scrollbar-sleek max-h-56 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-border bg-muted px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground">
            {preview.diff}
          </pre>
        </>
      ) : null}
      {error ? (
        <p className="flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span className="[overflow-wrap:anywhere]">{error}</span>
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={repairing}>
          {translate('auto.components.skills.SkillRepairReview.cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleRepair()}
          disabled={!preview || repairing}
        >
          {repairing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {translate('auto.components.skills.SkillRepairReview.repairing', 'Reinstalling…')}
            </>
          ) : (
            translate('auto.components.skills.SkillRepairReview.confirm', 'Back up and reinstall')
          )}
        </Button>
      </div>
    </section>
  )
}
