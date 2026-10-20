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

  it('seats five members and reverts the merged review once', () => {
    const frames = Array.from({ length: DEMO_FRAMES }, (_, step) => demoFrameOf(step).state)
    for (const state of frames) {
      expect(state.agents.filter((agent) => !agent.isLeader)).toHaveLength(5)
    }
    const reverts = frames.filter(
      (state, at) => frames[at - 1]?.review?.state === 'merged' && state.review?.state === 'open'
    )
    expect(reverts).toHaveLength(1)
    expect(reverts[0]?.review?.ci).toBe('failure')
  })

  it('shows a prompt action, an MCP action and a To Do grouped by status with counts', () => {
    const frames = Array.from({ length: DEMO_FRAMES }, (_, step) => demoFrameOf(step).state)
    for (const state of frames) {
      const actions = state.actions ?? []
      expect(actions.some((one) => 'prompt' in one)).toBe(true)
      expect(actions.some((one) => 'mcp' in one)).toBe(true)
      const todo = state.project?.todo
      expect(todo?.items.map((one) => one.group)).toEqual([
        'in_progress',
        'review',
        'review',
        'todo'
      ])
      expect(todo?.items.every((one) => (one.prompt ?? '') !== '')).toBe(true)
      expect(todo?.groups?.review).toBeGreaterThan(0)
      expect(todo?.total).toBeGreaterThanOrEqual(todo?.items.length ?? Infinity)
    }
  })
})
