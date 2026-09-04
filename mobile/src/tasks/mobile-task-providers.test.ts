import { describe, expect, it } from 'vitest'
import {
  filterAvailableTaskProviders,
  isTaskProvider,
  MOBILE_RENDERABLE_TASK_PROVIDERS,
  normalizeVisibleTaskProviders,
  resolveVisibleTaskProvider
} from './mobile-task-providers'

const ALL_UNAVAILABLE = { gitlabInstalled: false, linearConnected: false }

describe('mobile task providers', () => {
  it('renders plane but never jira', () => {
    expect([...MOBILE_RENDERABLE_TASK_PROVIDERS]).toEqual(['github', 'gitlab', 'linear', 'plane'])
    expect(isTaskProvider('plane')).toBe(true)
    expect(isTaskProvider('jira')).toBe(false)
  })

  it('falls back to the renderable set, not the shared union, without settings', () => {
    expect(normalizeVisibleTaskProviders(undefined)).toEqual([
      'github',
      'gitlab',
      'linear',
      'plane'
    ])
  })

  it('drops a persisted jira entry instead of surfacing a dead tab', () => {
    expect(normalizeVisibleTaskProviders(['github', 'jira', 'plane'])).toEqual(['github', 'plane'])
  })

  it('keeps plane available while its host connection is unconfigured', () => {
    // Plane is connected from the Tasks surface itself, so hiding it when
    // disconnected would remove the entry point.
    expect(filterAvailableTaskProviders(['plane', 'linear'], ALL_UNAVAILABLE)).toEqual(['plane'])
  })

  it('resolves a preferred provider mobile cannot render back to github', () => {
    expect(resolveVisibleTaskProvider('plane', ['github', 'plane'])).toBe('plane')
    expect(resolveVisibleTaskProvider(null, [])).toBe('github')
  })
})
