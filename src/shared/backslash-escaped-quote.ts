/**
 * Double-quotes a value for a CommandLineToArgvW-style parser: backslashes stay
 * literal unless they precede a quote, so only those runs and a trailing run double.
 */
export function quoteWithBackslashEscapes(value: string): string {
  let quoted = '"'
  let backslashes = 0
  for (const ch of value) {
    if (ch === '\\') {
      backslashes += 1
      continue
    }
    quoted += '\\'.repeat(ch === '"' ? backslashes * 2 + 1 : backslashes) + ch
    backslashes = 0
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`
}
