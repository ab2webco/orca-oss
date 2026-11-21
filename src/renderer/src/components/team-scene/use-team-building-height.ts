import { useCallback, useState } from 'react'

/** The building's view between `min` (today's height, or every floor when fewer) and all floors. */
export const teamBuildingHeightOf = (
  wanted: number | null,
  bounds: { min: number; max: number }
): number => Math.min(bounds.max, Math.max(bounds.min, wanted ?? bounds.min))

// Why try/catch: storage may be blocked or absent, and the building still opens at its minimum.
function readStored(key: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeStored(key: string, value: number | null): void {
  try {
    window.localStorage.setItem(key, value === null ? '' : String(Math.round(value)))
  } catch {
    // Kept for this session only.
  }
}

/**
 * The height the owner dragged the building to, kept on this machine; null is the default.
 * Clamped where it is drawn, so a team that lost floors still opens inside its bounds (ORCA-1219).
 */
export function useTeamBuildingHeight(
  key = 'orca.teamBuilding.height'
): [number | null, (next: number | null) => void] {
  const [wanted, setWanted] = useState<number | null>(() => readStored(key))
  const set = useCallback(
    (next: number | null) => {
      setWanted(next)
      writeStored(key, next)
    },
    [key]
  )
  return [wanted, set]
}
