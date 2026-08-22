import { Loader2 } from 'lucide-react'
import type { ResumeVaultEntry, ResumeVaultHeldReason } from '@/lib/resume-vault-records'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

function getHeldReasonLabel(reason: ResumeVaultHeldReason): string {
  switch (reason) {
    case 'finished':
      return translate('resumeVault.reason.finished', 'Reported finished (unconfirmed)')
    case 'interrupted':
      return translate('resumeVault.reason.interrupted', 'Closed mid-turn')
    case 'unknown':
      return translate('resumeVault.reason.unknown', 'Still working when captured')
  }
}

type ResumeVaultRecordRowProps = {
  entry: ResumeVaultEntry
  onRelease: (entry: ResumeVaultEntry) => void
}

export function ResumeVaultRecordRow({
  entry,
  onRelease
}: ResumeVaultRecordRowProps): React.JSX.Element {
  const { record } = entry
  const identifyingText = record.terminalTitle || record.lastAssistantMessage || record.prompt
  const capturedLabel = formatUiRelativeTime(record.capturedAt - Date.now())

  return (
    <div className="flex items-start gap-3 rounded-md border border-border/50 px-3 py-2">
      <AgentIcon agent={record.agent} size={16} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{getAgentLabel(record.agent)}</span>
          <Badge variant="outline" className="text-[10px]">
            {getHeldReasonLabel(entry.heldReason)}
          </Badge>
        </div>
        {identifyingText ? (
          <p className="truncate text-xs text-muted-foreground" title={identifyingText}>
            {identifyingText}
          </p>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          {translate('resumeVault.captured', 'Captured {{value0}}', { value0: capturedLabel })}
        </p>
      </div>
      {entry.isCurrentlyWorking ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1.5 self-center text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {translate('resumeVault.currentlyWorking', 'Working')}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate(
              'resumeVault.currentlyWorkingTooltip',
              "This agent is currently working — its resume record can't be released until it stops."
            )}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRelease(entry)}
          aria-label={translate('resumeVault.release', 'Release')}
        >
          {translate('resumeVault.release', 'Release')}
        </Button>
      )}
    </div>
  )
}
