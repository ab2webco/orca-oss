import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

import { translate } from '@/i18n/i18n'
import {
  planeCreateState,
  planeUpdateState,
  type RuntimePlaneSettings
} from '@/runtime/runtime-plane-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { planPlaneBoardColumnInsertion } from './plane-board-drag'
import type { PlaneState, PlaneStateGroup } from '../../../shared/plane-types'

type PlaneBoardAddColumnProps = {
  compact?: boolean
  insertionIndex: number
  /** Returns true on success so the form can reset and close. */
  onCreate: (insertionIndex: number, name: string, group: PlaneStateGroup) => Promise<boolean>
}

const STATE_GROUPS: readonly PlaneStateGroup[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled'
]

export async function createPlaneBoardColumnAtPosition(args: {
  providerSettings: RuntimePlaneSettings
  projectId: string
  workspaceId: string | null
  name: string
  group: PlaneStateGroup
  insertionIndex: number
  states: readonly PlaneState[]
  showError: (error: unknown, fallback: string) => void
}): Promise<boolean> {
  const created = await planeCreateState(
    args.providerSettings,
    { projectId: args.projectId, name: args.name, group: args.group },
    args.workspaceId
  )
  if (!created.ok) {
    args.showError(
      created.error,
      translate('auto.components.task-page-plane-board.createFailed', 'Failed to create column.')
    )
    return false
  }
  const sequence = planPlaneBoardColumnInsertion(
    args.states.map((state) => state.id),
    new Map(args.states.map((state) => [state.id, state.sequence] as const)),
    args.insertionIndex
  )
  const positioned = await planeUpdateState(
    args.providerSettings,
    { projectId: args.projectId, stateId: created.state.id, sequence },
    args.workspaceId
  )
  if (!positioned.ok) {
    args.showError(
      positioned.error,
      translate(
        'auto.components.task-page-plane-board.createPositionFailed',
        "The column was created at the end, but couldn't be moved into position. You can drag it into place."
      )
    )
  }
  return true
}

function groupLabel(group: PlaneStateGroup): string {
  switch (group) {
    case 'backlog':
      return translate('auto.components.plane-board-add-column.groupBacklog', 'Backlog')
    case 'unstarted':
      return translate('auto.components.plane-board-add-column.groupUnstarted', 'Unstarted')
    case 'started':
      return translate('auto.components.plane-board-add-column.groupStarted', 'Started')
    case 'completed':
      return translate('auto.components.plane-board-add-column.groupCompleted', 'Completed')
    case 'cancelled':
      return translate('auto.components.plane-board-add-column.groupCancelled', 'Cancelled')
  }
}

export function PlaneBoardAddColumn({
  compact = false,
  insertionIndex,
  onCreate
}: PlaneBoardAddColumnProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [group, setGroup] = useState<PlaneStateGroup>('unstarted')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  const reset = useCallback(() => {
    setOpen(false)
    setName('')
    setGroup('unstarted')
  }, [])

  const submit = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || submitting) {
      return
    }
    setSubmitting(true)
    const ok = await onCreate(insertionIndex, trimmed, group)
    setSubmitting(false)
    if (ok) {
      reset()
    }
  }, [name, group, submitting, insertionIndex, onCreate, reset])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        void submit()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        reset()
      }
    },
    [submit, reset]
  )

  if (!open) {
    if (compact) {
      const label = translate('auto.components.plane-board-add-column.addHere', 'Add column here')
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={label}
              onClick={() => setOpen(true)}
              className="h-8 w-6 shrink-0 self-start border border-dashed border-border/50 text-muted-foreground hover:border-ring/50 hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {label}
          </TooltipContent>
        </Tooltip>
      )
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-52 shrink-0 self-start items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/10 px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:border-ring/50 hover:bg-accent/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1.5">
          <Plus className="size-3.5" />
          {translate('auto.components.plane-board-add-column.add', 'Add column')}
        </span>
      </button>
    )
  }

  return (
    <div className="flex w-72 shrink-0 self-start flex-col gap-2 rounded-md border border-border/50 bg-muted/20 p-3">
      <Input
        ref={inputRef}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={translate(
          'auto.components.plane-board-add-column.namePlaceholder',
          'Column name'
        )}
        aria-label={translate('auto.components.plane-board-add-column.nameLabel', 'Column name')}
        className="h-8 text-[12px]"
      />
      <Select value={group} onValueChange={(value) => setGroup(value as PlaneStateGroup)}>
        <SelectTrigger
          aria-label={translate('auto.components.plane-board-add-column.groupLabel', 'State group')}
          className="h-8 text-[12px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATE_GROUPS.map((value) => (
            <SelectItem key={value} value={value} className="text-[12px]">
              {groupLabel(value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-[12px]" onClick={reset}>
          {translate('auto.components.plane-board-add-column.cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-[12px]"
          disabled={!name.trim() || submitting}
          onClick={() => void submit()}
        >
          {translate('auto.components.plane-board-add-column.create', 'Add')}
        </Button>
      </div>
    </div>
  )
}
