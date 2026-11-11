import { describe, expect, it } from 'vitest'
import { TAB_CONTAINER_WIDTH_CLASSES, TAB_LABEL_WIDTH_CLASSES } from './tab-width-rules'

// Why (ORCA-717): beside the +N count and the +, a 48 px tab left a 97 px bar a sliver.
describe('tab width rules', () => {
  it('drops a tab to its 32 px icon and hides its label under a 120 px tab bar', () => {
    expect(TAB_CONTAINER_WIDTH_CLASSES).toContain('@max-[120px]/tab-bar:min-w-8')
    expect(TAB_LABEL_WIDTH_CLASSES).toContain('@max-[120px]/tab-bar:hidden')
  })
})
