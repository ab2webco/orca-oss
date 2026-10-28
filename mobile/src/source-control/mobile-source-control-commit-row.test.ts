import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: { create: <T>(styles: T): T => styles, hairlineWidth: 1 }
}))

import { listStyles } from './mobile-source-control-list-styles'

const content = readFileSync(new URL('./MobileSourceControlContent.tsx', import.meta.url), 'utf8')

describe('Source Control commit row at the capped text size', () => {
  // Why: at 320 dp the input left beside the two buttons clipped its placeholder to "Commit mes".
  it('gives the commit input its own row and end-aligns the buttons in a compact layout', () => {
    expect(listStyles.commitRowStacked).toMatchObject({
      flexWrap: 'wrap',
      justifyContent: 'flex-end'
    })
    expect(listStyles.commitInputStacked).toMatchObject({ flexBasis: '100%' })

    expect(content).toContain('useCompactTextLayout()')
    expect(content).toContain('compact && styles.commitRowStacked')
    expect(content).toContain('compact && styles.commitInputStacked')
  })
})
