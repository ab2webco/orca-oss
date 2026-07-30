import {
  isRequiredPtyReattachUnavailableMessage,
  REQUIRED_PTY_REATTACH_UNAVAILABLE
} from '../../shared/pty-reattach-unavailable'

export { REQUIRED_PTY_REATTACH_UNAVAILABLE }

export function requiredPtyReattachUnavailableMessage(sessionId: string): string {
  return `${REQUIRED_PTY_REATTACH_UNAVAILABLE}: PTY session "${sessionId}" is no longer available to reattach`
}

export function isRequiredPtyReattachUnavailable(error: unknown): boolean {
  return isRequiredPtyReattachUnavailableMessage(
    error instanceof Error ? error.message : String(error)
  )
}
