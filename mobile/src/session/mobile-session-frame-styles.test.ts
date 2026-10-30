import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: { create: <T>(styles: T): T => styles }
}))

import { mobileSessionFrameStyles } from './mobile-session-frame-styles'

describe('session tab strip', () => {
  // Why: at the capped text size a tab outgrows 36, and a height cap clipped the bottom of "zsh".
  it('lets the tab strip grow with its tabs instead of capping its height', () => {
    expect(mobileSessionFrameStyles.tabScroll).not.toHaveProperty('maxHeight')
    expect(mobileSessionFrameStyles.tab.minHeight).toBe(36)
  })
})
