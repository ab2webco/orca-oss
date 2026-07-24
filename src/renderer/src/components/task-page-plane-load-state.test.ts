import { describe, expect, it } from 'vitest'
import { createTaskPagePlaneLoadFailureState } from './task-page-plane-load-state'

describe('TaskPage Plane load state', () => {
  it('explains Plane forbidden errors while clearing stale work items', () => {
    expect(createTaskPagePlaneLoadFailureState(new Error('Forbidden'))).toEqual({
      items: [],
      error: {
        title:
          'Error 403: Plane denied access to this work item search. Check project permissions or try a different PQL query.',
        details: 'Forbidden'
      }
    })
  })

  it('keeps raw provider detail separate from the Plane status summary', () => {
    expect(createTaskPagePlaneLoadFailureState(new Error('Error 403: XSRF check failed'))).toEqual({
      items: [],
      error: {
        title:
          'Error 403: Plane denied access to this work item search. Check project permissions or try a different PQL query.',
        details: 'XSRF check failed'
      }
    })
  })

  it('explains malformed PQL errors', () => {
    expect(createTaskPagePlaneLoadFailureState(new Error('Malformed PQL'))).toEqual({
      items: [],
      error: {
        title: "Plane couldn't run this PQL query. Check the syntax and try again.",
        details: 'Malformed PQL'
      }
    })
  })

  it('explains network errors', () => {
    expect(createTaskPagePlaneLoadFailureState(new Error('Network request failed'))).toEqual({
      items: [],
      error: {
        title: "Couldn't reach Plane. Check your connection and try again.",
        details: 'Network request failed'
      }
    })
  })

  it('explains Plane server errors', () => {
    expect(createTaskPagePlaneLoadFailureState(new Error('Service Unavailable'))).toEqual({
      items: [],
      error: {
        title:
          'Error 503: Plane had a server error while loading work items. Try again in a moment.',
        details: 'Service Unavailable'
      }
    })
  })

  it('uses the generic load error for non-Error rejections', () => {
    expect(createTaskPagePlaneLoadFailureState('failed')).toEqual({
      items: [],
      error: {
        title: "Couldn't load Plane work items. Try again in a moment.",
        details: 'Failed to load Plane work items.'
      }
    })
  })
})
