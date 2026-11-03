import { quoteWithBackslashEscapes } from '../shared/backslash-escaped-quote'

export function quoteCliCommandArgument(value: string): string {
  if (/^[a-zA-Z0-9._:/@-]+$/.test(value)) {
    return value
  }
  if (process.platform === 'win32') {
    return quoteWithBackslashEscapes(value)
  }
  return `'${value.replaceAll("'", "'\\''")}'`
}
