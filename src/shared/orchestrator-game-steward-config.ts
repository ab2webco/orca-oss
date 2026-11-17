/** orca.yaml `orchestratorGame.steward` (ORCA-1242): paths whose first edit raises the member's effort. */
export type GameStewardConfig = { highRiskPaths: string[] }

const PATHS_MAX = 50
const PATH_MAX = 200

/** Extends the steward's built-in list, never replaces it; an entry is a path part like `src/main/runtime/`. */
export function parseGameStewardConfig(raw: unknown): {
  value: GameStewardConfig | undefined
  warnings: string[]
} {
  const paths = (raw as { highRiskPaths?: unknown } | null)?.highRiskPaths
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !Array.isArray(paths)) {
    return { value: undefined, warnings: ['orchestratorGame.steward.highRiskPaths must be a list'] }
  }
  const kept = paths
    .filter((one): one is string => typeof one === 'string' && one.trim() !== '')
    .map((one) => one.trim().replace(/\\/g, '/').slice(0, PATH_MAX))
    .slice(0, PATHS_MAX)
  const warnings =
    kept.length < paths.length
      ? [`orchestratorGame.steward.highRiskPaths keeps up to ${PATHS_MAX} non-empty paths`]
      : []
  return { value: { highRiskPaths: kept }, warnings }
}
