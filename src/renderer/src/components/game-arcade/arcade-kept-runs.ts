import type { ArcadeRun } from './arcade-run-state'

// Why outside React: the editor unmounts the Arcade tab while the conversation shows, and Esc
// promises the run is still there when the tab comes back.
// One entry per Arcade tab, so at most one per worktree.
const kept = new Map<string, { play: number; run: ArcadeRun }>()

/** The run this play left when its tab was last shown; a newer play of the same tab starts fresh. */
export function keptArcadeRunOf(tabId: string, play: number): ArcadeRun | undefined {
  const one = kept.get(tabId)
  return one?.play === play ? one.run : undefined
}

export function keepArcadeRun(tabId: string, play: number, run: ArcadeRun): void {
  kept.set(tabId, { play, run })
}
