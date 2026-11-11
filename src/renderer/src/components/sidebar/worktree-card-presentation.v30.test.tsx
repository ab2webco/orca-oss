// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import type { WorktreeCardController } from './use-worktree-card-controller'
import { buildWorktreeCardPresentation } from './worktree-card-presentation'

function cardOf(style: 'legacy' | 'compact' | 'new'): WorktreeCardController {
  return {
    worktree: { id: 'wt-81', isMainWorktree: true, displayName: 'NETSA-81 Secuencias D2' },
    repo: { id: 'r', displayName: 'helpdesk_netsat' },
    inPinnedSection: false,
    hideRepoBadge: true,
    hostContextLabel: 'Local Mac',
    newCardStyle: style === 'new',
    compactCards: style === 'compact',
    isFolder: false,
    detachedHeadDisplay: { kind: 'sha', label: 'Detached HEAD @ 1a2b3c4' },
    branch: 'netsa-81',
    identityDisplay: 'netsa-81',
    showIdentityInNewCard: false,
    conflictOperation: null,
    cardProps: [],
    cacheStartedAt: null,
    hasDetails: false,
    hasPorts: false,
    showStatus: true,
    showInlineAgentList: false,
    showLineageChildChip: false,
    remoteBranchConflict: null,
    visibleCardTitle: 'NETSA-81 Secuencias D2',
    workspacePorts: [],
    showDeleteQuickAction: false
  } as unknown as WorktreeCardController
}

describe('a row with no agent is one V30 line in every card style (ORCA-1149)', () => {
  it.each(['legacy', 'compact', 'new'] as const)(
    '%s: no host chip, HEAD, branch or principal',
    (style) => {
      const presentation = buildWorktreeCardPresentation(cardOf(style))

      expect(presentation).toMatchObject({
        showHeaderActions: false,
        hasMetaRow: false,
        titleOnlyCard: true
      })
    }
  )
})
