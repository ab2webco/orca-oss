import { describe, expect, it } from 'vitest'
import { isSupportedGitHubProjectViewLayout } from './github-project-view-layout'

describe('isSupportedGitHubProjectViewLayout', () => {
  it.each([
    ['TABLE_LAYOUT', true],
    ['BOARD_LAYOUT', true],
    ['ROADMAP_LAYOUT', false]
  ] as const)('classifies %s support as %s', (layout, expected) => {
    expect(isSupportedGitHubProjectViewLayout(layout)).toBe(expected)
  })
})
