import type { GameBoardCaller, GameBoardProject } from './orchestrator-game-board'
import type { GameLeadRecord } from './orchestrator-game-lead-roster'

export type GameLeadsDeps = {
  projectOf: (caller: GameBoardCaller) => Promise<GameBoardProject>
  isLive: (handle: string) => boolean
  /** False once the pane is back at its shell: a lead that ran /exit, or a resume Claude refused. */
  isRunning?: (handle: string) => Promise<boolean>
  now?: () => Date
  wait?: (ms: number) => Promise<void>
  sessions?: {
    read: (projectKey: string) => Promise<GameLeadSession | null>
    write: (projectKey: string, session: GameLeadSession) => Promise<void>
    clear: (projectKey: string) => Promise<void>
  }
  sessionOf?: (handle: string) => Promise<GameLeadSession | null>
  /** Reopens the conversation in a new pane and returns that pane's handle. */
  resume?: (session: GameLeadSession) => Promise<string>
  /** The managed account `resume` reopens a conversation on; the recorded one when absent. */
  reopenAccountOf?: (session: GameLeadSession) => string | null
  focus?: (handle: string) => Promise<void>
  roster?: {
    read: () => Promise<GameLeadRecord[]>
    write: (records: GameLeadRecord[]) => Promise<void>
  }
  paneOf?: (handle: string) => string | null
  /** The handle of a pane whose terminal is connected now; null until the pane is back. */
  handleOfPane?: (paneKey: string) => string | null
  /** `starting` is anything that is neither Claude nor a shell, and an unreadable pane. */
  paneState?: (handle: string) => Promise<'running' | 'shell' | 'starting'>
}

export type GameLeadListing = {
  project: string
  label: string
  handle: string
  since: string
  paneKey?: string
  /** The lead's worktree; absent from an older CLI's registration, so the phone shows no team line. */
  worktreeId?: string
}

/** A lead kept from before a restart whose pane is not back yet; `paneKey` is the pane it led from. */
export type GameLeadRestoring = { project: string; paneKey: string }

/** What reopens a project's lead conversation once its pane is gone; `accountId` is the managed account it ran on. */
export type GameLeadSession = {
  sessionId: string
  agentArgs: string | null
  worktreeId: string
  accountId: string | null
  /** Where Claude keeps the conversation; names its account when `accountId` was not recorded. */
  transcriptPath?: string
}

/** `registered: false` with `live` or `resumed` names the pane that is the lead instead of the caller. */
export type GameLeadRegistration = {
  registered: boolean
  live?: { handle: string }
  resumed?: { handle: string }
  /** Why the stored conversation did not reopen, so the caller became a new lead. */
  resumeError?: string
}
