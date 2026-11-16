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
const QUOTA_NEAR = 85

const FAMILY_RANK: Readonly<Record<string, number>> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }

// Why unknown ranks as Opus: a model this build does not know is never lowered toward Haiku.
const modelRankOf = (model: string): number =>
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

/** The phase's planned pick, else the kind table's; a judgment under 0.7 only raises; floors last. */
export function stewardChoiceOf(input: {
  phase: StewardPhase
  plan: readonly StewardPlanPhase[] | null
  current: StewardPick
  confidence?: number
}): StewardChoice {
  const planned = input.plan?.find((one) => one.phase === input.phase)
  const base = planned ?? PHASE_DEFAULTS[input.phase]
  let pick: StewardPick = { model: base.model, effort: base.effort }
  if (input.confidence !== undefined && input.confidence < SURE) {
    pick = higherOf(input.current, pick)
  }
  const isFloored = FLOORED.has(input.phase) && modelRankOf(pick.model) < modelRankOf(FLOOR_MODEL)
  return {
    pick: isFloored ? { ...pick, model: FLOOR_MODEL } : pick,
    source: planned ? 'plan' : 'default',
    isFloored
  }
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

export type StewardTrack = { phase: StewardPhase | null; failing: string | null }
export type StewardToolCall = { tool: string; command?: string; path?: string; isError: boolean }
export type StewardMomentReason = 'edit' | 'test-loop' | 'pr-ci' | 'captures'
export type StewardMoment = {
  track: StewardTrack
  phase?: StewardPhase
  reason?: StewardMomentReason
}

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TEST_COMMAND =
  /\b(?:vitest|jest|pytest|mocha|playwright test|go test|cargo test|(?:npm|pnpm|yarn|bun)(?: run)? test)\b/
const PR_CI_COMMAND = /\b(?:git push|gh pr (?:create|checks)|gh run (?:watch|view|list))\b/
const CAPTURE_COMMAND = /\b(?:screenshots?|captures?)\b/i
const IMAGE_PATH = /\.(?:png|jpe?g|webp)$/i

const moved = (
  track: StewardTrack,
  phase: StewardPhase,
  reason: StewardMomentReason
): StewardMoment =>
  track.phase === phase ? { track } : { track: { ...track, phase }, phase, reason }

/** A tool call the member just made: a key moment when it moves the member to another phase. */
export function stewardMomentOf(track: StewardTrack, call: StewardToolCall): StewardMoment {
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
  if (call.tool === 'Read' && call.path !== undefined && IMAGE_PATH.test(call.path)) {
    return moved(track, 'captures', 'captures')
  }
  if (EDIT_TOOLS.has(call.tool) && track.phase !== 'implement' && track.phase !== 'test-fix') {
    return moved(track, 'implement', 'edit')
  }
  return { track }
}
