import React, { useEffect, useState } from 'react'
import type { ClaudeStatusLineOwnership } from '../../../../shared/agent-hook-types'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import {
  getClaudeStatusLineOwnershipAction,
  getClaudeStatusLineOwnershipCancelLabel,
  getClaudeStatusLineOwnershipConfirmLabel,
  getClaudeStatusLineOwnershipDialogBody,
  getClaudeStatusLineOwnershipDialogTitle,
  getClaudeStatusLineOwnershipFailureNote,
  getClaudeStatusLineOwnershipHomeBody,
  getClaudeStatusLineOwnershipHomeLocationLabel,
  getClaudeStatusLineOwnershipTitle,
  getClaudeStatusLineOwnershipVaultBody,
  getClaudeStatusLineOwnershipVaultLocationLabel
} from './claude-statusline-items-copy'

/**
 * Shown only when a user-owned statusLine occupies the shared home slot or survives as a
 * cloned copy inside account vaults. Replacement is strictly consent-first: the managed
 * install never overwrites a user slot on its own, so this notice carries the one explicit
 * action that does — after a confirmation listing every location it will touch.
 */
export function ClaudeStatusLineOwnershipNotice(): React.JSX.Element | null {
  const [ownership, setOwnership] = useState<ClaudeStatusLineOwnership | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [failedCount, setFailedCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    void window.api.agentHooks
      .claudeStatusLineOwnership()
      .then((next) => {
        if (!cancelled) {
          setOwnership(next)
        }
      })
      .catch(() => {
        // Detection is best-effort UI context: an IPC failure just hides the notice.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ownership || (!ownership.userOwnedHome && ownership.userOwnedVaultCount === 0)) {
    return null
  }

  const userOwnedLocations = [
    ...(ownership.userOwnedHome ? [getClaudeStatusLineOwnershipHomeLocationLabel()] : []),
    ...ownership.universes
      .filter((universe) => universe.universe === 'vault' && universe.state === 'user')
      .map((universe) =>
        getClaudeStatusLineOwnershipVaultLocationLabel(universe.accountEmail ?? '')
      )
  ]

  const replace = async (): Promise<void> => {
    setReplacing(true)
    try {
      const result = await window.api.agentHooks.claudeStatusLineReplaceUserOwned()
      setOwnership(result.ownership)
      setFailedCount(result.failedCount)
    } catch {
      setFailedCount(userOwnedLocations.length)
    } finally {
      setReplacing(false)
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border/50 bg-muted/30 p-3">
      <p className="text-sm font-medium">{getClaudeStatusLineOwnershipTitle()}</p>
      <div className="space-y-1 text-xs text-muted-foreground">
        {ownership.userOwnedHome ? <p>{getClaudeStatusLineOwnershipHomeBody()}</p> : null}
        {ownership.userOwnedVaultCount > 0 ? (
          <p>{getClaudeStatusLineOwnershipVaultBody(ownership.userOwnedVaultCount)}</p>
        ) : null}
        {failedCount > 0 ? <p>{getClaudeStatusLineOwnershipFailureNote(failedCount)}</p> : null}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        {getClaudeStatusLineOwnershipAction()}
      </Button>
      <Dialog open={confirming} onOpenChange={(open) => !replacing && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{getClaudeStatusLineOwnershipDialogTitle()}</DialogTitle>
            <DialogDescription>{getClaudeStatusLineOwnershipDialogBody()}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {userOwnedLocations.map((location) => (
              <li key={location}>{location}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={replacing}
              onClick={() => setConfirming(false)}
            >
              {getClaudeStatusLineOwnershipCancelLabel()}
            </Button>
            <Button type="button" disabled={replacing} onClick={() => void replace()}>
              {getClaudeStatusLineOwnershipConfirmLabel()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
