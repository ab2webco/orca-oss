import { Loader2, TerminalSquare } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type {
  ClaudeAccountWorktreeUsage,
  ClaudeAccountWorktreeUsageReport
} from '../../../../shared/claude-account-worktree-usage'
import { planClaudeAccountReassignment } from './claude-account-reassign-plan'

// Why: Radix Select items cannot carry an empty-string value, so the system
// default login needs a sentinel of its own.
const SYSTEM_DEFAULT_VALUE = '__system_default__'

export type ClaudeAccountReassignDestination = {
  accountId: string | null
  label: string
}

export type ClaudeAccountReassignConfirmation = {
  toAccountId: string | null
  /** False when nothing is live, so a runtime without a PTY terminator is never
   *  asked to close terminals that do not exist. */
  closeLiveTerminals: boolean
  closeLiveTerminalAccountIds: string[]
}

export type ClaudeAccountReassignDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The account being removed or changed, already labeled for display. */
  accountLabel: string
  /** null while the report is still loading. */
  report: ClaudeAccountWorktreeUsageReport | null
  destinations: readonly ClaudeAccountReassignDestination[]
  destination: string | null
  onDestinationChange: (accountId: string | null) => void
  /** `remove` deletes the account after reassigning; `unblock` only reassigns. */
  mode: 'remove' | 'unblock'
  submitting: boolean
  onConfirm: (confirmation: ClaudeAccountReassignConfirmation) => void
  /** Resolves the email/label of an account that blocks from outside this one. */
  resolveAccountLabel: (accountId: string) => string
}

function WorktreeRow({ worktree }: { worktree: ClaudeAccountWorktreeUsage }): React.JSX.Element {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="truncate font-medium">{worktree.displayName}</span>
      {worktree.hasLiveTerminal ? (
        <Badge variant="destructive" className="shrink-0 gap-1">
          <TerminalSquare size={11} />
          {translate(
            'auto.components.settings.ClaudeAccountReassignDialog.liveBadge',
            'Live terminal'
          )}
        </Badge>
      ) : (
        <Badge variant="secondary" className="shrink-0">
          {translate('auto.components.settings.ClaudeAccountReassignDialog.pinnedBadge', 'Pinned')}
        </Badge>
      )}
    </li>
  )
}

export function ClaudeAccountReassignDialog({
  open,
  onOpenChange,
  accountLabel,
  report,
  destinations,
  destination,
  onDestinationChange,
  mode,
  submitting,
  onConfirm,
  resolveAccountLabel
}: ClaudeAccountReassignDialogProps): React.JSX.Element {
  const plan = report ? planClaudeAccountReassignment(report) : null
  const worktrees = report?.worktrees ?? []
  // Why: with nothing pinned there is no reassignment to make — the dialog is
  // then just the ordinary destructive removal confirmation.
  const showReassignment = worktrees.length > 0
  const blockingLabels = (plan?.blockingAccountIds ?? []).map(resolveAccountLabel)
  const blockingWorktreeNames = (report?.blockedByOtherAccounts ?? [])
    .map((terminal) => terminal.displayName)
    .filter((name): name is string => name !== null)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onOpenChange(false)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {mode === 'unblock'
              ? translate(
                  'auto.components.settings.ClaudeAccountReassignDialog.unblockTitle',
                  'Reassign the worktrees using {{account}}?',
                  { account: accountLabel }
                )
              : showReassignment
                ? translate(
                    'auto.components.settings.ClaudeAccountReassignDialog.removeTitle',
                    'Remove {{account}} and reassign its worktrees?',
                    { account: accountLabel }
                  )
                : translate(
                    'auto.components.settings.ClaudeAccountReassignDialog.plainRemoveTitle',
                    'Remove {{account}}?',
                    { account: accountLabel }
                  )}
          </DialogTitle>
          <DialogDescription>
            {mode === 'remove' && !showReassignment
              ? translate(
                  'auto.components.settings.ClaudeAccountReassignDialog.plainRemoveDescription',
                  'Orca will delete the managed Claude auth for this saved account. If it is currently active, Orca falls back to the system default Claude login.'
                )
              : translate(
                  'auto.components.settings.ClaudeAccountReassignDialog.description',
                  'A pinned Claude CLI owns this account’s single-use refresh chain, so Orca cannot change it underneath a running session. Pick where these worktrees go and Orca closes the live terminals first.'
                )}
          </DialogDescription>
        </DialogHeader>

        {report === null ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            {translate(
              'auto.components.settings.ClaudeAccountReassignDialog.loading',
              'Checking which worktrees use this account…'
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {showReassignment ? (
              <>
                <div className="space-y-1.5">
                  <Label>
                    {translate(
                      'auto.components.settings.ClaudeAccountReassignDialog.worktreesLabel',
                      'Worktrees using this account'
                    )}
                  </Label>
                  <ScrollArea className="max-h-44 rounded-md border px-3">
                    <ul className="divide-y">
                      {worktrees.map((worktree) => (
                        <WorktreeRow key={worktree.worktreeId} worktree={worktree} />
                      ))}
                    </ul>
                  </ScrollArea>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="claude-reassign-destination">
                    {translate(
                      'auto.components.settings.ClaudeAccountReassignDialog.destinationLabel',
                      'Reassign these worktrees to'
                    )}
                  </Label>
                  <Select
                    value={destination ?? SYSTEM_DEFAULT_VALUE}
                    onValueChange={(value) =>
                      onDestinationChange(value === SYSTEM_DEFAULT_VALUE ? null : value)
                    }
                  >
                    <SelectTrigger id="claude-reassign-destination" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {destinations.map((option) => (
                        <SelectItem
                          key={option.accountId ?? SYSTEM_DEFAULT_VALUE}
                          value={option.accountId ?? SYSTEM_DEFAULT_VALUE}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : null}

            {plan && plan.liveWorktrees.length > 0 ? (
              <p className="text-sm text-destructive">
                {translate(
                  'auto.components.settings.ClaudeAccountReassignDialog.closeWarning',
                  'Orca will close the Claude terminal in {{worktrees}}. Those sessions end.',
                  { worktrees: plan.liveWorktrees.map((worktree) => worktree.displayName).join(', ') }
                )}
              </p>
            ) : null}

            {blockingLabels.length > 0 ? (
              <p className="text-sm text-destructive">
                {translate(
                  'auto.components.settings.ClaudeAccountReassignDialog.blockedByOther',
                  'The active account {{accounts}} also has a live Claude terminal in {{worktrees}}. Orca closes it too, or the change stays blocked.',
                  {
                    accounts: blockingLabels.join(', '),
                    worktrees:
                      blockingWorktreeNames.length > 0
                        ? blockingWorktreeNames.join(', ')
                        : translate(
                            'auto.components.settings.ClaudeAccountReassignDialog.unknownWorktree',
                            'an unnamed workspace'
                          )
                  }
                )}
              </p>
            ) : null}

            {plan?.waitingOnLaunch ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {translate(
                  'auto.components.settings.ClaudeAccountReassignDialog.pendingLaunch',
                  'A Claude terminal is still starting up, and it holds this account until it finishes. Wait a moment, then try again.'
                )}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {translate('auto.components.settings.ClaudeAccountReassignDialog.cancel', 'Cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={report === null || submitting}
            onClick={() =>
              onConfirm({
                toAccountId: destination,
                closeLiveTerminals: plan?.closesTerminals ?? false,
                closeLiveTerminalAccountIds: plan?.blockingAccountIds ?? []
              })
            }
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {mode === 'unblock'
              ? translate(
                  'auto.components.settings.ClaudeAccountReassignDialog.confirmUnblock',
                  'Reassign & continue'
                )
              : showReassignment
                ? translate(
                    'auto.components.settings.ClaudeAccountReassignDialog.confirmRemove',
                    'Reassign & remove'
                  )
                : translate(
                    'auto.components.settings.ClaudeAccountReassignDialog.confirmPlainRemove',
                    'Remove Account'
                  )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
