import React from 'react'
import type {
  GameOwnerQuestion,
  GameOwnerReply
} from '../../../../shared/orchestrator-game-owner-questions'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { translate } from '@/i18n/i18n'
import { GameOwnerQuestionCard } from './GameOwnerQuestionCard'

/** The project's Orca Game Inbox; "For you" lists what the lead asked the person. */
export function GameInboxSheet({
  open,
  onOpenChange,
  questions,
  onAnswer
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  questions: GameOwnerQuestion[]
  onAnswer: (id: string, reply: GameOwnerReply) => Promise<void>
}): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:w-[min(92vw,520px)] sm:max-w-[520px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        data-testid="game-inbox-sheet"
      >
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>
            {translate('auto.components.game-inbox.GameInboxSheet.title', 'Inbox')}
          </SheetTitle>
          <SheetDescription>
            {translate(
              'auto.components.game-inbox.GameInboxSheet.description',
              "What the project's lead asked you to decide."
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
            {translate('auto.components.game-inbox.GameInboxSheet.forYou', 'For you')}
          </h3>
          <span className="text-xs text-muted-foreground tabular-nums">{questions.length}</span>
        </div>
        <div className="scrollbar-sleek min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          {questions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {translate(
                'auto.components.game-inbox.GameInboxSheet.empty',
                'No questions are waiting for you.'
              )}
            </p>
          ) : (
            questions.map((question) => (
              <GameOwnerQuestionCard
                key={question.id}
                question={question}
                onAnswer={(reply) => onAnswer(question.id, reply)}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
