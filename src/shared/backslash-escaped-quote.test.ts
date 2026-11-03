import { describe, expect, it } from 'vitest'
import { quoteWithBackslashEscapes } from './backslash-escaped-quote'

// Mirror of CommandLineToArgvW for one quoted token, so each case checks the round trip.
function parseQuotedToken(token: string): string {
  let out = ''
  let backslashes = 0
  for (let i = 1; i < token.length; i += 1) {
    const ch = token[i]
    if (ch === '\\') {
      backslashes += 1
      continue
    }
    if (ch === '"') {
      out += '\\'.repeat(Math.floor(backslashes / 2))
      if (backslashes % 2 === 0) {
        expect(i).toBe(token.length - 1)
        return out
      }
      out += '"'
    } else {
      out += '\\'.repeat(backslashes) + ch
    }
    backslashes = 0
  }
  throw new Error(`unterminated token: ${token}`)
}

describe('quoteWithBackslashEscapes', () => {
  it('leaves interior backslashes of a Windows path alone', () => {
    expect(quoteWithBackslashEscapes('C:\\Program Files\\node.exe')).toBe(
      '"C:\\Program Files\\node.exe"'
    )
  })

  it('doubles a trailing backslash so it cannot escape the closing quote', () => {
    expect(quoteWithBackslashEscapes('C:\\my dir\\')).toBe('"C:\\my dir\\\\"')
  })

  it.each(['plain', 'C:\\my dir\\', 'a"b', 'a\\"b', 'a\\\\', '\\\\server\\share\\', 'x\\\\"y"'])(
    'round-trips %s',
    (value) => {
      expect(parseQuotedToken(quoteWithBackslashEscapes(value))).toBe(value)
    }
  )
})
