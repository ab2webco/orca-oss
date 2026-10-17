// The last frame each Raster shows, so a tick that draws the same cells sends nothing.

const shown = new Map<string, Map<string, string>>()

/** Records cells a render or blit put on screen. */
export const rememberFrame = (requestId: string, key: string, cells: string): void => {
  const own = shown.get(requestId) ?? new Map<string, string>()
  shown.set(requestId, own)
  own.set(key, cells)
}

/** True, and remembered, when the cells differ from what that Raster shows now. */
export const isNewFrame = (requestId: string, key: string, cells: string): boolean => {
  if (shown.get(requestId)?.get(key) === cells) {
    return false
  }
  rememberFrame(requestId, key, cells)
  return true
}

/** Forgets one request's frames, or all of them. */
export const forgetFrames = (requestId?: string): void => {
  if (requestId === undefined) {
    shown.clear()
  } else {
    shown.delete(requestId)
  }
}
