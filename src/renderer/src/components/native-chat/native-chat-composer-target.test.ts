import { describe, expect, it } from 'vitest'
import { formatNativeChatFileReference } from './native-chat-composer-target'

describe('formatNativeChatFileReference', () => {
  it('leaves a path without whitespace bare', () => {
    expect(formatNativeChatFileReference('C:\\repo\\a.ts')).toBe('@C:\\repo\\a.ts')
  })

  it('quotes a spaced Windows path without touching its interior backslashes', () => {
    expect(formatNativeChatFileReference('C:\\my repo\\a.ts')).toBe('@"C:\\my repo\\a.ts"')
  })

  it('doubles a trailing backslash so the reference keeps its closing quote', () => {
    expect(formatNativeChatFileReference('C:\\my repo\\')).toBe('@"C:\\my repo\\\\"')
  })
})
