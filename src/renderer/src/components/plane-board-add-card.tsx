import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type PlaneBoardAddCardProps = {
  /** Returns true on success so the form can reset and close. */
  onCreate: (title: string) => Promise<boolean>
}

/**
 * Inline "add work item" affordance at the foot of a board column.
 *
 * Why title-only: the column already fixes the state, and everything else
 * (priority, assignee, description) is edited in the item workspace. A full form
 * here would slow down the capture this is for — seeing a gap in the board and
 * filling it without leaving the board.
 */
export function PlaneBoardAddCard({ onCreate }: PlaneBoardAddCardProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  const reset = useCallback(() => {
    setOpen(false)
    setTitle('')
  }, [])

  const submit = useCallback(async () => {
    const trimmed = title.trim()
    if (!trimmed || submitting) {
      return
    }
    setSubmitting(true)
    const ok = await onCreate(trimmed)
    setSubmitting(false)
    if (!ok) {
      // Why stay open on failure: the typed title is the user's work, so keep it
      // for a retry instead of making them write it again.
      return
    }
    setTitle('')
    // Why keep the composer open: adding several items in a row is the common
    // case when filling a column.
    inputRef.current?.focus()
  }, [title, submitting, onCreate])

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
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border/50 px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-ring/50 hover:bg-accent/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Plus className="size-3" />
        {translate('auto.components.plane-board-add-card.add', 'Add work item')}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border/50 bg-muted/20 p-2">
      <Input
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={translate(
          'auto.components.plane-board-add-card.titlePlaceholder',
          'Work item title'
        )}
        aria-label={translate('auto.components.plane-board-add-card.titleLabel', 'Work item title')}
        className="h-8 text-[12px]"
        disabled={submitting}
      />
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => void submit()}
          disabled={submitting || title.trim().length === 0}
        >
          {translate('auto.components.plane-board-add-card.create', 'Add')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={reset}
          disabled={submitting}
        >
          {translate('auto.components.plane-board-add-card.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}
