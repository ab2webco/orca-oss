import { describe, expect, it } from 'vitest'

import { DEMO_FRAMES, demoFrameOf } from '../hooks/demo'
import { ACTIONS } from '../hooks/quest-policy'

describe('demo', () => {
  it('cycles every reaction and action, with one level-up and fake data only', () => {
    const frames = Array.from({ length: DEMO_FRAMES }, (_, step) => demoFrameOf(step))
    const actions = frames.flatMap((one) => (one.action === undefined ? [] : [one.action]))
    expect(new Set(actions)).toEqual(new Set(ACTIONS))
    expect(frames.some((one) => one.state.agents.some((agent) => agent.state === 'waiting'))).toBe(
      true
    )
    expect(frames.some((one) => one.state.review?.ci === 'failure')).toBe(true)
    expect(frames.some((one) => one.state.agents.some((agent) => agent.state === 'done'))).toBe(
      true
    )
    expect(frames.some((one) => one.isResting)).toBe(true)
    expect(frames.filter((one) => one.isLevelUp)).toHaveLength(1)
    expect(frames.every((one) => (one.state.project?.reviews?.items.length ?? 0) > 0)).toBe(true)
    expect(frames.every((one) => (one.state.project?.todo?.items.length ?? 0) > 0)).toBe(true)
    const project = frames.flatMap((one) => [
      one.state.project?.reviews?.url ?? '',
      one.state.project?.todo?.url ?? '',
      ...[
        ...(one.state.project?.reviews?.items ?? []),
        ...(one.state.project?.todo?.items ?? [])
      ].map((item) => item.url)
    ])
    const urls = [
      ...frames.flatMap((one) => [one.state.review?.url ?? '', one.state.workItem?.url ?? '']),
      ...project
    ]
    expect(
      urls.filter((url) => url !== '').every((url) => url.startsWith('https://example.invalid/'))
    ).toBe(true)
    expect(demoFrameOf(DEMO_FRAMES)).toEqual(demoFrameOf(0))
  })
})
