// Why no length floor, unlike the transcript's: status text is cut at 160 chars, so a line can hold only a token's head.
const DISPATCH_CAPABILITY = /dcap_[A-Za-z0-9_-]+/g

/** A worker's own command lines carry its capability, a bearer secret no row may show. */
export const redactDispatchCapability = (text: string): string =>
  text.replace(DISPATCH_CAPABILITY, '[redacted]')
