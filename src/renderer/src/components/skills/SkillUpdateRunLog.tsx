import { ChevronDown } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export function SkillUpdateRunLog({ output }: { output: string }): React.JSX.Element | null {
  if (!output.trim()) {
    return null
  }
  return (
    <Collapsible className="min-w-0">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="group -ml-2 gap-1.5 text-muted-foreground"
        >
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
          {translate('auto.components.skills.SkillFreshnessUpdateDialog.showLog', 'Show log')}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 min-w-0">
        <pre className="scrollbar-sleek max-h-40 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-border bg-muted px-3 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {output.trim()}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}
