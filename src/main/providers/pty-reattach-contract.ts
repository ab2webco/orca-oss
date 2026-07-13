export const REQUIRED_PTY_REATTACH_UNAVAILABLE = 'PTY_REQUIRED_REATTACH_UNAVAILABLE'

export function requiredPtyReattachUnavailableMessage(sessionId: string): string {
  return `${REQUIRED_PTY_REATTACH_UNAVAILABLE}: PTY session "${sessionId}" is no longer available to reattach`
}
