import React from 'react'
import type {
  GameOwnerQuestion,
  GameOwnerReply
} from '../../../../shared/orchestrator-game-owner-questions'
import type { GameInboxThreads } from '../../../../shared/orchestrator-game-inbox-threads'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { GameOwnerQuestionCard } from './GameOwnerQuestionCard'
import { GameInboxWaitingList } from './GameInboxWaitingList'
import { GameInboxThreadsView } from './GameInboxThreadsView'

function TabCount({ count }: { count: number }): React.JSX.Element | null {
  return count > 0 ? (
    <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
  ) : null
}

// Why smaller below sm: the tabs must fit a 320px window.
const TAB = 'px-1.5 text-xs sm:px-2 sm:text-sm'

const LIST_PANEL = 'scrollbar-sleek mt-0 min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4'

/** The project's Orca Game Inbox: what the lead asked the person, what waits on the lead, each ticket's thread. */
export function GameInboxSheet({
  open,
  onOpenChange,
  questions,
  onAnswer,
  threads
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  questions: GameOwnerQuestion[]
  onAnswer: (id: string, reply: GameOwnerReply) => Promise<void>
  threads: GameInboxThreads
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
              'What the lead asked you, what waits on it, and how it talks with each member.'
            )}
          </SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="for-you" className="min-h-0 flex-1 gap-0">
          <div className="px-4 pt-3">
            <TabsList className="w-full">
              <TabsTrigger value="for-you" className={TAB}>
                {translate('auto.components.game-inbox.GameInboxSheet.forYou', 'For you')}
                <TabCount count={questions.length} />
              </TabsTrigger>
              <TabsTrigger value="waiting" className={TAB}>
                {translate('auto.components.game-inbox.GameInboxSheet.waiting', 'Waiting')}
                <TabCount count={threads.waiting.length} />
              </TabsTrigger>
              <TabsTrigger value="threads" className={TAB}>
                {translate('auto.components.game-inbox.GameInboxSheet.threads', 'Threads')}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="for-you" className={`${LIST_PANEL} space-y-3`}>
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
          </TabsContent>
          <TabsContent value="waiting" className={LIST_PANEL}>
            <GameInboxWaitingList items={threads.waiting} />
          </TabsContent>
          <TabsContent value="threads" className="mt-0 flex min-h-0 flex-1 flex-col pt-2">
            <GameInboxThreadsView threads={threads.threads} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
