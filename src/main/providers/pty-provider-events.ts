import type { TerminalGitHubPRLink } from '../../shared/terminal-github-pr-link-detector'

export type PtyDataEvent = {
  id: string
  data: string
  sequenceChars?: number
  transformed?: boolean
  seq?: number
}

/** Notification-bearing fact a thinning transport detected while it held
 *  scan authority for a backgrounded PTY (see onBackgroundStreamEvent). */
export type PtyTransientFact =
  | { kind: 'bell' }
  | { kind: 'command-finished'; exitCode: number | null }
  | { kind: 'pr-link'; link: TerminalGitHubPRLink }
  | { kind: '2031-subscribe' }
  | { kind: '2031-unsubscribe' }

export type PtyBackgroundStreamEvent =
  | {
      id: string
      kind: 'backgroundMarker'
      background: boolean
      scanSeedAnsi?: string
      mode2031PendingSubscribe?: true
    }
  | { id: string; kind: 'dataGap'; droppedChars: number; sequenceChars?: number }
  | { id: string; kind: 'transientFact'; fact: PtyTransientFact }
  /** `withheld`: the shell-ready budget elapsed with this PTY's launch command
   *  unwritten, so the pane holds a shell and no agent. `delivered`: the shell
   *  finally reached a prompt and the held command went in (ORCA-210). */
  | { id: string; kind: 'startupCommandDelivery'; state: 'withheld' | 'delivered' }
