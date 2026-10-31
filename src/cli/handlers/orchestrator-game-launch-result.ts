import {
  GAME_GLOBAL_LOGIN_LABEL,
  gameGlobalLoginNoteOf,
  type GameGlobalLoginLaunch
} from './orchestrator-game-launch-account'
import { formatSetupQueue, type GameSetupQueue } from './orchestrator-game-setup-queue'

export type GameLaunchResult = GameGlobalLoginLaunch & {
  ticket: string
  /** The scene character the member was named after; absent once the roster ran out. */
  name?: string
  agent: string
  /** The managed account's email and id; absent when Orca's own account selection applies. */
  account?: string
  accountId?: string
  /** Why `auto` picked the account. */
  accountWhy?: string
  runId: string
  taskId: string
  /** Absent while the member waits for the host's setup slot. */
  dispatchId?: string
  state: string
  setupQueue?: GameSetupQueue
  lastError?: string
}

export const formatGameLaunch = (launched: GameLaunchResult): string => {
  const who = [
    launched.agent,
    launched.account ?? (launched.globalLogin ? GAME_GLOBAL_LOGIN_LABEL : undefined)
  ]
    .filter(Boolean)
    .join(' · ')
  const what = launched.setupQueue
    ? formatSetupQueue(launched.setupQueue, who)
    : `member ${launched.dispatchId} [${launched.state}] ${who}`
  return `${launched.ticket}${launched.name ? ` (${launched.name})` : ''}: ${what}${launched.accountWhy ? `\n${launched.accountWhy}` : ''}${launched.globalLogin ? `\n${gameGlobalLoginNoteOf(launched)}` : ''}${launched.lastError ? `\n${launched.lastError}` : ''}`
}

/** A queued member is on its way, not a failed launch. */
export const isLaunchUnderway = (launched: GameLaunchResult): boolean =>
  launched.state === 'ready' || launched.state === 'queued'
