// @vitest-environment happy-dom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ShortActivityAgeLabel } from './ShortActivityAgeLabel'

describe('ShortActivityAgeLabel', () => {
  it('draws the short age of a timestamp', () => {
    const { container } = render(<ShortActivityAgeLabel since={Date.now() - 5 * 3_600_000} />)
    expect(container.querySelector('[data-activity-age]')?.textContent).toBe('5 h')
  })

  it('draws nothing for a workspace with no activity timestamp', () => {
    const { container } = render(<ShortActivityAgeLabel since={0} />)
    expect(container.querySelector('[data-activity-age]')).toBeNull()
    const { container: none } = render(<ShortActivityAgeLabel since={undefined} />)
    expect(none.querySelector('[data-activity-age]')).toBeNull()
  })
})
