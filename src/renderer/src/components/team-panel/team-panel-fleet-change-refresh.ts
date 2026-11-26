/**
 * Re-reads the open Team panel on the host's fleet changes, at most once per `gapMs` (ORCA-1441).
 * Why a gap: each member state change and heartbeat bumps the fleet, and each read is a game.state.
 */
export function createTeamPanelFleetChangeRefresh(
  refresh: () => void,
  gapMs: number
): { changed: () => void; cancel: () => void } {
  let lastAt = Number.NEGATIVE_INFINITY
  let timer: ReturnType<typeof setTimeout> | null = null
  const fire = (): void => {
    timer = null
    lastAt = Date.now()
    refresh()
  }
  return {
    changed: () => {
      if (timer) {
        return
      }
      const wait = lastAt + gapMs - Date.now()
      if (wait <= 0) {
        fire()
        return
      }
      timer = setTimeout(fire, wait)
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
