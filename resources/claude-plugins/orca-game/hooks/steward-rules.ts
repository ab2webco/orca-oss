// The Orca steward's rules (ORCA-1242): which model and effort a member's main loop runs on, from
// the lead's effort plan, the kind table and the floors that always win. Pure, so specs pin them.

export type StewardPhase = 'map' | 'design' | 'implement' | 'test-fix' | 'captures' | 'pr-ci'
export type StewardEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type StewardPick = { model: string; effort: StewardEffort | null }
export type StewardPlanPhase = {
  phase: StewardPhase
  model: string
  effort: StewardEffort
  why: string
}

export const STEWARD_PHASES: readonly StewardPhase[] = [
  'map',
  'design',
  'implement',
  'test-fix',
  'captures',
  'pr-ci'
]
export const STEWARD_EFFORTS: readonly StewardEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// Why a copy: the plugin cannot import Orca's src/shared; it mirrors PHASE_DEFAULTS there.
const PHASE_DEFAULTS: Readonly<Record<StewardPhase, Required<StewardPick>>> = {
  map: { model: 'claude-sonnet-5-5', effort: 'medium' },
  design: { model: 'claude-opus-5-5', effort: 'high' },
  implement: { model: 'claude-opus-5-5', effort: 'high' },
  'test-fix': { model: 'claude-opus-5-5', effort: 'high' },
  captures: { model: 'claude-sonnet-5-5', effort: 'medium' },
  'pr-ci': { model: 'claude-haiku-5-5', effort: 'low' }
}

// Why (owner): editing code and review/design never run below Opus 5.5.
const FLOOR_MODEL = 'claude-opus-5-5'
const FLOORED: ReadonlySet<StewardPhase> = new Set(['implement', 'test-fix', 'design'])
const SURE = 0.7
const RISK_EFFORT: StewardEffort = 'xhigh'
/** Built-in high-risk path parts; orca.yaml `orchestratorGame.steward.highRiskPaths` adds to them. */
export const STEWARD_HIGH_RISK_PATHS: readonly string[] = [
  'migrations/',
  '.github/workflows/',
  'auth/',
  'security/',
  'crypto/',
  'billing/',
  'payments/',
  'infra/',
  'terraform/'
]
export const QUOTA_NEAR = 85

const FAMILY_RANK: Readonly<Record<string, number>> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }

// Why unknown ranks as Opus: a model this build does not know is never lowered toward Haiku.
export const modelRankOf = (model: string): number =>
  FAMILY_RANK[/(haiku|sonnet|opus|fable)/i.exec(model)?.[1]?.toLowerCase() ?? ''] ?? 3

export const stewardEffortOf = (value: unknown): StewardEffort | null =>
  STEWARD_EFFORTS.includes(value as StewardEffort) ? (value as StewardEffort) : null

export const isSamePick = (a: StewardPick, b: StewardPick): boolean =>
  a.model === b.model && a.effort === b.effort

const effortRankOf = (effort: StewardEffort | null): number =>
  effort === null ? -1 : STEWARD_EFFORTS.indexOf(effort)

const higherOf = (a: StewardPick, b: StewardPick): StewardPick => ({
  model: modelRankOf(b.model) > modelRankOf(a.model) ? b.model : a.model,
  effort: effortRankOf(b.effort) > effortRankOf(a.effort) ? b.effort : a.effort
})

export type StewardChoice = { pick: StewardPick; source: 'plan' | 'default'; isFloored: boolean }

/**
 * The phase's planned pick, else the kind table's; a judgment under 0.7 only raises; floors last.
 * Why the floor after an edit: a lower model would write the next edit before a moment raised it.
 */
export function stewardChoiceOf(input: {
  phase: StewardPhase
  plan: readonly StewardPlanPhase[] | null
  current: StewardPick
  confidence?: number
  hasEdited?: boolean
  /** A high-risk path was edited: implementing runs at xhigh or above. */
  isHighRisk?: boolean
}): StewardChoice {
  const planned = input.plan?.find((one) => one.phase === input.phase)
  const base = planned ?? PHASE_DEFAULTS[input.phase]
  let pick: StewardPick = { model: base.model, effort: base.effort }
  if (input.confidence !== undefined && input.confidence < SURE) {
    pick = higherOf(input.current, pick)
  }
  const isFloorPhase = FLOORED.has(input.phase) || input.hasEdited === true
  const isModelFloored = isFloorPhase && modelRankOf(pick.model) < modelRankOf(FLOOR_MODEL)
  const isRiskRaise =
    input.isHighRisk === true &&
    (input.phase === 'implement' || input.phase === 'test-fix') &&
    effortRankOf(pick.effort) < effortRankOf(RISK_EFFORT)
  const isFloored = isModelFloored || isRiskRaise
  return {
    pick: {
      model: isModelFloored ? FLOOR_MODEL : pick.model,
      effort: isRiskRaise ? RISK_EFFORT : pick.effort
    },
    source: planned ? 'plan' : 'default',
    isFloored
  }
}

/** Where a plan starts; a review plan starts in design, since a review shows no edit to move it. */
export function stewardStartPhaseOf(plan: readonly StewardPlanPhase[]): StewardPhase | null {
  const has = (phase: StewardPhase) => plan.some((one) => one.phase === phase)
  return has('design') && !has('implement') ? 'design' : (plan[0]?.phase ?? null)
}

/** What Orca pinned at launch (`--model`, `--effort`, orca.yaml) stays as it is. */
export const withPins = (
  next: StewardPick,
  current: StewardPick,
  pins: { model: boolean; effort: boolean }
): StewardPick => ({
  model: pins.model ? current.model : next.model,
  effort: pins.effort ? current.effort : next.effort
})

/** Near a 5-hour or 7-day limit the effort drops one level; the model, and so its floor, stays. */
export function withQuota(pick: StewardPick, percentUsed: number): StewardPick {
  const rank = effortRankOf(pick.effort)
  return percentUsed < QUOTA_NEAR || rank <= 0
    ? pick
    : { ...pick, effort: STEWARD_EFFORTS[rank - 1] ?? pick.effort }
}

export type StewardTrack = {
  phase: StewardPhase | null
  failing: string | null
  hasEdited: boolean
  hasRiskyEdit?: boolean
}
export type StewardToolCall = { tool: string; command?: string; path?: string; isError: boolean }
export type StewardMomentReason = 'edit' | 'high-risk' | 'test-loop' | 'pr-ci' | 'captures'
export type StewardMoment = {
  track: StewardTrack
  phase?: StewardPhase
  reason?: StewardMomentReason
}

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TEST_COMMAND =
  /\b(?:vitest|jest|pytest|mocha|playwright test|go test|cargo test|(?:npm|pnpm|yarn|bun)(?: run)? test)\b/
const PR_CI_COMMAND = /\b(?:git push|gh pr (?:create|checks)|gh run (?:watch|view))\b/
// Why a script, not the word: `ls tmp/captures-1262` or a commit message is no capture work.
const CAPTURE_COMMAND = /\b(?:(?:npm|pnpm|yarn|bun) (?:run )?capture[:\w-]*|screencapture)\b/
const IMAGE_PATH = /\.(?:png|jpe?g|webp)$/i

const moved = (
  track: StewardTrack,
  phase: StewardPhase,
  reason: StewardMomentReason
): StewardMoment =>
  track.phase === phase ? { track } : { track: { ...track, phase }, phase, reason }

// Why a path part, not a prefix: the tool's path is absolute and the list is relative to any root.
export const isHighRiskPath = (path: string, parts: readonly string[]): boolean => {
  const at = `/${path.replace(/\\/g, '/').replace(/^\/+/, '')}`
  return parts.some((part) => part !== '' && at.includes(`/${part.replace(/^\/+/, '')}`))
}

/** A tool call the member just made: a key moment when it moves the member to another phase. */
export function stewardMomentOf(
  track: StewardTrack,
  call: StewardToolCall,
  riskyPaths: readonly string[] = STEWARD_HIGH_RISK_PATHS
): StewardMoment {
  const command = call.command?.trim().replace(/\s+/g, ' ')
  if (call.tool === 'Bash' && command !== undefined && TEST_COMMAND.test(command)) {
    if (!call.isError) {
      return { track: { ...track, failing: null } }
    }
    // Why twice: one red run is how a fix starts; the same one again is a loop worth a moment.
    return track.failing === command
      ? moved(track, 'test-fix', 'test-loop')
      : { track: { ...track, failing: command } }
  }
  if (call.tool === 'Bash' && command !== undefined && PR_CI_COMMAND.test(command)) {
    return moved(track, 'pr-ci', 'pr-ci')
  }
  if (call.tool === 'Bash' && command !== undefined && CAPTURE_COMMAND.test(command)) {
    return moved(track, 'captures', 'captures')
  }
  const isEditing = track.phase === 'implement' || track.phase === 'test-fix'
  // Why not while editing: checking a shot of the change is part of implementing it.
  if (call.tool === 'Read' && !isEditing && call.path !== undefined && IMAGE_PATH.test(call.path)) {
    return moved(track, 'captures', 'captures')
  }
  if (EDIT_TOOLS.has(call.tool)) {
    const edited = { ...track, hasEdited: true }
    // Why once: every later edit of the path would re-send the same raise.
    if (!track.hasRiskyEdit && call.path !== undefined && isHighRiskPath(call.path, riskyPaths)) {
      const phase = isEditing && track.phase ? track.phase : 'implement'
      return { track: { ...edited, phase, hasRiskyEdit: true }, phase, reason: 'high-risk' }
    }
    return isEditing ? { track: edited } : moved(edited, 'implement', 'edit')
  }
  return { track }
}
