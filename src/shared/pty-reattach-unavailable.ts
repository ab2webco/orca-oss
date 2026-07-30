// Why shared: main throws this marker and the renderer has to recognize it to
// replace a blank pane with an actionable notice (ORCA-124).
export const REQUIRED_PTY_REATTACH_UNAVAILABLE = 'PTY_REQUIRED_REATTACH_UNAVAILABLE'

export function isRequiredPtyReattachUnavailableMessage(message: string): boolean {
  return message.includes(REQUIRED_PTY_REATTACH_UNAVAILABLE)
}
