const LAST_REVIEWS_MAX = 64

/** How the game finds a worktree's review: its branch first, a known PR number only after a clean miss. */
export type GameBranchReviewLookup<T> = {
  byBranch: () => Promise<T | null>
  byNumber?: () => Promise<T | null>
}

/**
 * The last answer per branch, so a failed read answers it instead of nothing or a weaker guess.
 * Why the number only after the branch: the renderer's PR cache can still name a closed PR the
 * branch has since replaced with an open one (ORCA-1435).
 */
export class GameBranchReviews<T> {
  private readonly last = new Map<string, T | null>()

  async read(key: string, lookup: GameBranchReviewLookup<T>): Promise<T | null> {
    try {
      const read = (await lookup.byBranch()) ?? (lookup.byNumber ? await lookup.byNumber() : null)
      this.last.delete(key)
      this.last.set(key, read)
      if (this.last.size > LAST_REVIEWS_MAX) {
        this.last.delete(this.last.keys().next().value as string)
      }
      return read
    } catch (error) {
      if (this.last.has(key)) {
        return this.last.get(key) ?? null
      }
      throw error
    }
  }
}
