const MAX_URL = 2048

/** The value when it is an http(s) URL: the only kind handed to a terminal link or Orca's browser. */
export const httpUrlOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length > MAX_URL) {
    return undefined
  }
  try {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:' ? value : undefined
  } catch {
    return undefined
  }
}
