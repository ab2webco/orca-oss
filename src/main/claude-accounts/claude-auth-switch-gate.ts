import { sharedClaudeLaunchReservations } from './live-pty-account-state'

let switchInProgress = false

export function beginClaudeAuthSwitch(): void {
  if (switchInProgress) {
    throw new Error('A Claude account switch is already in progress.')
  }
  if (sharedClaudeLaunchReservations.size > 0) {
    // Why: shared auth must not change between launch preparation and durable PTY registration.
    throw new Error('A global Claude terminal is starting. Try again when it finishes.')
  }
  switchInProgress = true
}

export function endClaudeAuthSwitch(): void {
  switchInProgress = false
}

export function isClaudeAuthSwitchInProgress(): boolean {
  return switchInProgress
}
