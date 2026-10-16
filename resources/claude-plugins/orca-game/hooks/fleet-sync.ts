import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { FleetState, GameState } from '../types'
import { parseGameState } from './game-state'
import { fleetPhaseOf, partyOf } from './party'
import {
  clawdReact,
  demoNow,
  gameConfig,
  quest,
  questFleet,
  questLiveConfig
} from './quest-runtime'
import { awardXp, levelOf, rewardsOf, xpLedgerOf } from './rewards'

export const POLL_EVERY_MS = 30000
const STUCK_MS = 60000
const CLI_TIMEOUT_MS = 15000
const XP_KEY = 'xp-ledger'
export const GAME_STATE_ARGV = ['orca', 'game', 'state', '--json'] as const
export const UNAVAILABLE = 'orca game state unavailable'

const EMPTY: FleetState = { isLoading: false, refreshedAt: 0, state: null, note: '', xp: 0 }

export const fleet = atom({ plugin: 'orca-game', key: 'fleet' } as const, EMPTY)

async function readState($: EngineInterface): Promise<GameState | undefined> {
  const out = await $.process
    .run(GAME_STATE_ARGV, { timeoutMs: CLI_TIMEOUT_MS })
    .catch(() => undefined)
  return out?.exitCode === 0 ? parseGameState(out.stdout) : undefined
}

async function syncXp($: EngineInterface, before: GameState | null, next: GameState) {
  const stored = xpLedgerOf(await $.store.get(XP_KEY).catch(() => undefined))
  const { ledger, awarded } = awardXp(stored, rewardsOf(before, next), await $.clock.now())
  if (awarded.length === 0) {
    return stored.total
  }
  await $.store.set(XP_KEY, ledger).catch(() => undefined)
  for (const one of awarded) {
    $.ui.toast(`+${one.xp} XP · ${one.label}`)
  }
  if (levelOf(ledger.total).level > levelOf(stored.total).level) {
    clawdReact($, 'level')
  }
  return ledger.total
}

export async function refresh($: EngineInterface): Promise<void> {
  const before = await read($, fleet)
  const startedAt = await $.clock.now()
  await update($, fleet, (s) => ({ ...s, isLoading: true, refreshedAt: startedAt }))
  const next = await readState($)
  if (next !== undefined) {
    questLiveConfig($, next.config)
  }
  const config = gameConfig()
  const xp =
    next !== undefined && config.rewards
      ? await syncXp($, before.state, next).catch(() => before.xp)
      : before.xp
  const note = next === undefined ? UNAVAILABLE : (next.warnings[0] ?? '')
  const doneAt = await $.clock.now()
  await update($, fleet, (s) => ({
    ...s,
    isLoading: false,
    refreshedAt: doneAt,
    state: next ?? s.state,
    note,
    xp
  }))
  if (next !== undefined) {
    const waiting = next.agents.find((agent) => !agent.isLeader && agent.state === 'waiting')
    questFleet($, fleetPhaseOf(partyOf(next, config.rewards)), waiting?.displayName ?? '')
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
  const v = await read($, fleet)
  if (!quest.isDemo) {
    return { ...v, isDemo: false }
  }
  const frame = demoNow()
  return { ...v, state: frame.state, xp: frame.xp, note: '', isLoading: false, isDemo: true }
}
