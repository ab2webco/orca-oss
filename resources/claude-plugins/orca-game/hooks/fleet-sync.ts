import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { FleetState, GameState, RecentReward } from '../types'
import { syncActionCommands } from './action-commands'
import { ADVISOR_REPORT_ENV, advisorPinsOf, advisorReportOf } from './advisor-report'
import { readJevAdvisor } from './advisor-state'
import { offerArcadeOnUnlock } from './arcade-unlock'
import { cliInvocationOf } from './cli-invocation'
import {
  gameFleetArgvOf,
  gameStateArgvOf,
  gameViewArgvOf,
  openLinkArgvOf,
  tabCreateArgvOf,
  terminalFocusArgvOf
} from './game-config'
import { gameStateOf, parseGameState } from './game-state'
import type { GameViewId } from './game-view'
import { gameLocale, gameStrings, setGameLocale } from './game-strings'
import { raiseTeamEvent, syncHdTeam } from './hd-team'
import { fleetPhaseOf, partyOf } from './party'
import { isLeadStarted } from './lead-started'
import { runningLeadSubagents, withLeadSubagents } from './lead-subagents'
import { teamEventsOf } from './team-events'
import {
  clawdReact,
  demoNow,
  gameConfig,
  quest,
  questFleet,
  questLiveConfig
} from './quest-runtime'
import { earnedRewardsOf } from './fleet-rewards'
import { RECENT_KEY, recentRewardsOf, withRecent } from './recent-rewards'
import { awardXp, levelOf, signedXpOf, xpLedgerOf } from './rewards'
import { setContributedScenes } from './scenes/index'

export const POLL_EVERY_MS = 30000
const STUCK_MS = 60000
const CLI_TIMEOUT_MS = 15000
const XP_KEY = 'xp-ledger'

const EMPTY: FleetState = { isLoading: false, refreshedAt: 0, state: null, note: '', xp: 0 }

export const fleet = atom({ plugin: 'orca-game', key: 'fleet' } as const, EMPTY)

// Why: a hot reload keeps the atom, so its state may have the shape an older mod stored.
async function readFleet($: EngineInterface): Promise<FleetState> {
  const v = await read($, fleet)
  return { ...v, state: v.state === null ? null : (gameStateOf(v.state) ?? null) }
}

/** Runs the Orca CLI, through cmd.exe when Orca handed a Windows batch file; undefined when it could not. */
async function runCli(
  $: EngineInterface,
  argv: readonly string[] | undefined,
  extraEnv: Record<string, string> = {}
) {
  if (argv === undefined) {
    return undefined
  }
  const comspec = await $.env.get('ComSpec').catch(() => undefined)
  const invocation = cliInvocationOf(argv, comspec)
  if (invocation === undefined) {
    return undefined
  }
  const env = { ...invocation.env, ...extraEnv }
  const init =
    Object.keys(env).length > 0 ? { timeoutMs: CLI_TIMEOUT_MS, env } : { timeoutMs: CLI_TIMEOUT_MS }
  return await $.process.run(invocation.argv, init).catch(() => undefined)
}

// Module state: whether Orca holds a report from this pane that a Jev gone quiet must take back.
let hasReportedAdvisor = false

/** Jev's model, effort and Orca's pins for this pane's lead; nothing while Jev never published. */
async function advisorEnvOf($: EngineInterface): Promise<Record<string, string>> {
  const advisor = await readJevAdvisor($, quest.tick).catch(() => null)
  if (advisor === null && !hasReportedAdvisor) {
    return {}
  }
  const pins = await advisorPinsOf($)
  hasReportedAdvisor = advisor !== null
  return { [ADVISOR_REPORT_ENV]: advisorReportOf(advisor, pins) }
}

async function readState($: EngineInterface): Promise<GameState | undefined> {
  const argv = gameStateArgvOf(await $.env.get('ORCA_GAME_CLI').catch(() => undefined))
  const out = await runCli($, argv, await advisorEnvOf($))
  return out?.exitCode === 0 ? parseGameState(out.stdout) : undefined
}

/** What a fresh `orca game state --json` answered, for a report the person asked for. */
export type GameStateOutput =
  | { kind: 'missing' }
  | { kind: 'failed'; reason: string }
  | { kind: 'ok'; stdout: string }

export async function readGameStateOutput($: EngineInterface): Promise<GameStateOutput> {
  const argv = gameStateArgvOf(await $.env.get('ORCA_GAME_CLI').catch(() => undefined))
  if (argv === undefined) {
    return { kind: 'missing' }
  }
  const out = await runCli($, argv)
  if (out === undefined) {
    return { kind: 'failed', reason: `${argv[0]} could not be started` }
  }
  if (out.exitCode !== 0) {
    const line = (out.stderr.trim() || out.stdout.trim()).split('\n')[0]?.trim() ?? ''
    return { kind: 'failed', reason: `exit ${out.exitCode}${line === '' ? '' : `: ${line}`}` }
  }
  return { kind: 'ok', stdout: out.stdout }
}

/** What `orca game fleet` prints for this pane's project; undefined when Orca could not answer. */
export async function readFleetText($: EngineInterface): Promise<string | undefined> {
  const cli = await $.env.get('ORCA_GAME_CLI').catch(() => undefined)
  const out = await runCli($, gameFleetArgvOf(cli))
  return out?.exitCode === 0 && out.stdout.trim() !== '' ? out.stdout.trim() : undefined
}

/** Brings a teammate's Orca pane forward; false when Orca could not. */
export async function focusTerminal($: EngineInterface, handle: string): Promise<boolean> {
  const cli = await $.env.get('ORCA_GAME_CLI').catch(() => undefined)
  const out = await runCli($, terminalFocusArgvOf(cli, handle))
  return out?.exitCode === 0
}

/** Opens a link where the project asks: the system browser, else (or when that fails) an Orca tab. */
export async function openGameLink(
  $: EngineInterface,
  url: string,
  worktreeId: string
): Promise<boolean> {
  const cli = await $.env.get('ORCA_GAME_CLI').catch(() => undefined)
  const external = gameConfig().openLinks === 'system' ? openLinkArgvOf(cli, url) : undefined
  if (external !== undefined) {
    const out = await runCli($, external)
    // Why fall back: an older Orca or a host with no desktop has no system browser to offer.
    if (out?.exitCode === 0) {
      return true
    }
  }
  const out = await runCli($, tabCreateArgvOf(cli, url, worktreeId))
  return out?.exitCode === 0
}

/** Asks Orca to store a view for this project or every project; false when it could not. */
export async function storeGameView(
  $: EngineInterface,
  view: GameViewId,
  scope: 'project' | 'global'
): Promise<boolean> {
  const cli = await $.env.get('ORCA_GAME_CLI').catch(() => undefined)
  const out = await runCli($, gameViewArgvOf(cli, view, scope))
  return out?.exitCode === 0
}

type Score = { xp: number; recent: readonly RecentReward[] }

async function syncXp(
  $: EngineInterface,
  before: GameState | null,
  next: GameState
): Promise<Score> {
  const [stored, kept] = await Promise.all([
    $.store.get(XP_KEY).then(xpLedgerOf, () => xpLedgerOf(undefined)),
    $.store.get(RECENT_KEY).then(recentRewardsOf, () => [])
  ])
  const earned = earnedRewardsOf(before, next)
  const now = await $.clock.now()
  const { ledger, awarded } = awardXp(stored, earned, now)
  if (awarded.length === 0) {
    return { xp: stored.total, recent: kept }
  }
  const recent = withRecent(kept, awarded, now)
  await $.store.set(XP_KEY, ledger).catch(() => undefined)
  await $.store.set(RECENT_KEY, recent).catch(() => undefined)
  for (const one of awarded) {
    $.ui.toast(`${signedXpOf(one.xp)} XP · ${one.label}`)
  }
  const art = gameStrings().art
  const merged = awarded.find((one) => one.kind === 'review-merged')?.review
  if (merged !== undefined) {
    raiseTeamEvent($, 'merged', art.mergedFloat(merged))
  } else {
    const sum = awarded.reduce((total, one) => total + one.xp, 0)
    raiseTeamEvent($, 'xp', `${signedXpOf(sum)} ${art.xp}`)
  }
  if (levelOf(ledger.total).level > levelOf(stored.total).level) {
    clawdReact($, 'level')
  }
  return { xp: ledger.total, recent }
}

export async function refresh($: EngineInterface): Promise<void> {
  const before = await readFleet($)
  const startedAt = await $.clock.now()
  await update($, fleet, (s) => ({ ...s, isLoading: true, refreshedAt: startedAt }))
  const next = await readState($)
  if (next !== undefined) {
    if (setContributedScenes(next.extensions.scenes.map((one) => one.definition))) {
      $.ui.invalidate('ui.render')
    }
    // Why: ORCA_GAME_LOCALE is fixed at launch; the state carries a UI language changed since.
    if (next.locale !== undefined && next.locale !== gameLocale()) {
      setGameLocale(next.locale)
      $.ui.invalidate('ui.render')
    }
    questLiveConfig($, next.config, next.sources)
  }
  const config = gameConfig()
  const kept: Score = { xp: before.xp, recent: before.recent ?? [] }
  const { xp, recent } =
    next !== undefined && config.rewards
      ? await syncXp($, before.state, next).catch(() => kept)
      : kept
  const note = next === undefined ? gameStrings().text.unavailable : (next.warnings[0] ?? '')
  const doneAt = await $.clock.now()
  await update($, fleet, (s) => ({
    ...s,
    isLoading: false,
    refreshedAt: doneAt,
    state: next ?? s.state,
    note,
    xp,
    recent
  }))
  quest.clockMs = doneAt
  if (next !== undefined) {
    syncHdTeam(next, config.rewards)
    for (const one of teamEventsOf(before.state, next)) {
      raiseTeamEvent($, one.kind, one.text)
    }
    await syncActionCommands($, next.actions ?? []).catch(() => undefined)
    const waiting = next.agents.find((agent) => !agent.isLeader && agent.state === 'waiting')
    questFleet($, fleetPhaseOf(partyOf(next, config.rewards)), waiting?.displayName ?? '')
    // Why after questFleet: a teammate waiting on the user must already hold the offer it opens.
    if (config.rewards) {
      await offerArcadeOnUnlock($, before.state, next).catch(() => undefined)
    }
  }
}

export async function refreshSoon($: EngineInterface): Promise<void> {
  if (quest.isDemo) {
    return
  }
  const state = await read($, fleet)
  if (state.isLoading && (await $.clock.now()) - state.refreshedAt < STUCK_MS) {
    return
  }
  void refresh($).catch(() => undefined)
}

export type FleetView = FleetState & { isDemo: boolean }

export async function viewOf($: EngineInterface): Promise<FleetView> {
  const v = await readFleet($)
  if (!quest.isDemo) {
    const now = await $.clock.now()
    const state =
      v.state && withLeadSubagents(v.state, runningLeadSubagents, now, await isLeadStarted($))
    return { ...v, state, isDemo: false }
  }
  const frame = demoNow()
  return { ...v, state: frame.state, xp: frame.xp, note: '', isLoading: false, isDemo: true }
}
