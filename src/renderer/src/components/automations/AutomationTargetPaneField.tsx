import React from 'react'
import { Info } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { resolveRenderedAgentRowLabels } from '@/components/agent-row-label-resolution'
import { useWorktreeAgentRows } from '@/components/sidebar/useWorktreeAgentRows'
import { useAppStore } from '@/store'
import { Field } from './automation-page-parts'
import type { AutomationDraft } from './AutomationEditorDialog'
import { translate } from '@/i18n/i18n'

// Why: Radix Select cannot use '' as an item value, so automatic mode needs a sentinel.
const AUTOMATIC_TARGET = 'automatic'

type AutomationTargetPaneFieldProps = {
  draft: AutomationDraft
  pickerTriggerClassName: string
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
}

export function AutomationTargetPaneField({
  draft,
  pickerTriggerClassName,
  onDraftChange
}: AutomationTargetPaneFieldProps): React.JSX.Element | null {
  const visible = draft.workspaceMode === 'existing' && draft.reuseSession
  const rows = useWorktreeAgentRows(draft.workspaceId, visible && Boolean(draft.workspaceId))
  const generatedTitlesEnabled = useAppStore((s) => s.settings?.tabAutoGenerateTitle === true)
  const liveRows = React.useMemo(
    () => rows.filter((row) => row.rowSource === undefined || row.rowSource === 'live'),
    [rows]
  )
  const labelsByPaneKey = React.useMemo(
    () => resolveRenderedAgentRowLabels(liveRows, generatedTitlesEnabled),
    [liveRows, generatedTitlesEnabled]
  )
  if (!visible) {
    return null
  }
  const savedTargetMissing = Boolean(
    draft.targetPaneKey && !liveRows.some((row) => row.paneKey === draft.targetPaneKey)
  )
  return (
    <Field
      label={
        <span className="inline-flex items-center gap-1">
          {translate(
            'auto.components.automations.AutomationTargetPaneField.bf9bd09d7c',
            'Target pane'
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={translate(
                  'auto.components.automations.AutomationTargetPaneField.dbb80ca24e',
                  'Target pane help'
                )}
                className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Info className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="max-w-72">
              {translate(
                'auto.components.automations.AutomationTargetPaneField.1286051832',
                'Send reuse runs to this open agent pane. If it is gone at run time, Orca falls back to the previous automation session or a fresh one.'
              )}
            </TooltipContent>
          </Tooltip>
        </span>
      }
    >
      <Select
        value={draft.targetPaneKey || AUTOMATIC_TARGET}
        onValueChange={(value) =>
          onDraftChange((current) => ({
            ...current,
            targetPaneKey: value === AUTOMATIC_TARGET ? '' : value
          }))
        }
      >
        <SelectTrigger className={`w-full ${pickerTriggerClassName}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" side="bottom" align="start" sideOffset={4}>
          <SelectItem value={AUTOMATIC_TARGET}>
            {translate(
              'auto.components.automations.AutomationTargetPaneField.55c1ce2470',
              'Automatic'
            )}
          </SelectItem>
          {savedTargetMissing ? (
            <SelectItem value={draft.targetPaneKey}>
              {translate(
                'auto.components.automations.AutomationTargetPaneField.064973b416',
                'Saved pane (not open)'
              )}
            </SelectItem>
          ) : null}
          {liveRows.map((row) => (
            <SelectItem key={row.paneKey} value={row.paneKey}>
              {labelsByPaneKey.get(row.paneKey) || row.tab.title || row.agentType}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
