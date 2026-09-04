import { describe, expect, it } from 'vitest'
import {
  filterAvailableTaskProviders,
  isTaskProvider,
  MOBILE_RENDERABLE_TASK_PROVIDERS,
  normalizeVisibleTaskProviders,
  resolveVisibleTaskProvider
} from './mobile-task-providers'

const ALL_UNAVAILABLE = {
  gitlabInstalled: false,
  linearConnected: false,
  planeSupported: false,
  planeConnected: false
}
const PLANE_READY = { ...ALL_UNAVAILABLE, planeSupported: true, planeConnected: true }

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

  it('shows plane only when the host supports it and it is connected', () => {
    // Mobile cannot connect Plane, so a disconnected source would be a dead tab.
    expect(filterAvailableTaskProviders(['plane', 'github'], PLANE_READY)).toEqual([
      'plane',
      'github'
    ])
    expect(
      filterAvailableTaskProviders(['plane', 'github'], { ...PLANE_READY, planeConnected: false })
    ).toEqual(['github'])
    expect(
      filterAvailableTaskProviders(['plane', 'github'], { ...PLANE_READY, planeSupported: false })
    ).toEqual(['github'])
  })

  it('keeps a provider visible when gating plane empties the list', () => {
    expect(filterAvailableTaskProviders(['plane'], ALL_UNAVAILABLE)).toEqual(['github'])
  })

  it('resolves a preferred provider mobile cannot render back to github', () => {
    expect(resolveVisibleTaskProvider('plane', ['github', 'plane'])).toBe('plane')
    expect(resolveVisibleTaskProvider(null, [])).toBe('github')
  })
})
