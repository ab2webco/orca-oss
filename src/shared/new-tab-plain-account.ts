export type PlainRowAccount = {
  accountId: string | null
  source: 'worktree-pin' | 'global' | 'shared-home'
}

// Why: mirrors the plain launch order (worktree pin, then global selection) without passing an id.
export function plainRowAccountOf(input: {
  worktreePinId: string | null
  globalActiveId: string | null
}): PlainRowAccount {
  if (input.worktreePinId) {
    return { accountId: input.worktreePinId, source: 'worktree-pin' }
  }
  if (input.globalActiveId) {
    return { accountId: input.globalActiveId, source: 'global' }
  }
  return { accountId: null, source: 'shared-home' }
}
