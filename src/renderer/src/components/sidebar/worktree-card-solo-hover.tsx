import React from 'react'
import { SidebarSoloHoverContent } from './SidebarSoloHoverContent'
import { sidebarSoloTicketSource, type SidebarSoloHoverOpen } from './sidebar-solo-hover'
import type { SidebarSoloAgent } from './sidebar-solo-row'
import type { WorktreeCardController } from './use-worktree-card-controller'

type Opener = ((event: React.MouseEvent) => void) | undefined

/** The handler that opens the ticket the Ticket line names, under the classic card's own conditions. */
function ticketOpenerOf(card: WorktreeCardController): Opener {
  switch (sidebarSoloTicketSource(card.worktree)) {
    case 'plane':
      return card.planeWorkItem ? card.handleOpenPlaneWorkItemInOrca : undefined
    case 'linear':
      return card.linearIssue?.url ? card.handleOpenLinearIssueInOrca : undefined
    case 'issue':
      return card.hoverIssue && 'url' in card.hoverIssue && card.hoverIssue.url
        ? card.handleOpenGitHubIssueInOrca
        : undefined
    // Why none for Jira: Orca has no Jira page; the classic card links it out instead.
    case 'jira':
    case null:
      return undefined
  }
}

/** V30's solo facts for the top of a one-agent worktree's details card. */
export function WorktreeCardSoloFacts({
  card,
  solo
}: {
  card: WorktreeCardController
  solo: SidebarSoloAgent
}): React.JSX.Element {
  const review = card.hoverReview
  const openers: Record<SidebarSoloHoverOpen, Opener> = {
    pr: review?.url && review.provider === 'github' ? card.handleOpenReviewInOrca : undefined,
    ticket: ticketOpenerOf(card)
  }
  // Why close first: the classic card's own actions dismiss it before they run.
  const onOpen: Partial<Record<SidebarSoloHoverOpen, (event: React.MouseEvent) => void>> = {}
  for (const key of ['pr', 'ticket'] as const) {
    const open = openers[key]
    if (open) {
      onOpen[key] = (event) => {
        card.detailsHoverControl.closeHover()
        open(event)
      }
    }
  }
  return (
    <SidebarSoloHoverContent
      worktree={card.worktree}
      repo={card.repo}
      paneKey={solo.agent.paneKey}
      onOpen={onOpen}
    />
  )
}
