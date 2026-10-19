import { describe, expect, it } from 'vitest'

import {
  advisorCallAfter,
  advisorCallRowOf,
  advisorPoseOf,
  isAdvisorActingOf,
  type AdvisorScene,
  type StoredRow
} from '../hooks/advisor-calls'
import { REFEREE } from '../hooks/advisor-art'
import { cueTicksOf } from '../hooks/advisor-cues'

// The two rows Claude Code 2.1.303 kept for one advisor call, 80 s apart, encrypted_content cut.
const CALL: StoredRow = {
  type: 'assistant',
  content: [
    { type: 'server_tool_use', id: 'srvtoolu_019eMoTkm1NZbJoeEyN9H61U', name: 'advisor', input: {} }
  ]
}
const RESULT: StoredRow = {
  type: 'assistant',
  content: [
    {
      type: 'advisor_tool_result',
      tool_use_id: 'srvtoolu_019eMoTkm1NZbJoeEyN9H61U',
      content: { type: 'advisor_redacted_result', encrypted_content: 'ErcfCioIFBgCIiRl' }
    }
  ]
}
const WEB_SEARCH: StoredRow = {
  type: 'assistant',
  content: [
    { type: 'server_tool_use', id: 'srvtoolu_01Web', name: 'web_search', input: { query: 'x' } }
  ]
}
const BASH: StoredRow = {
  type: 'assistant',
  content: [{ type: 'tool_use', id: 'toolu_01Bash', name: 'Bash', input: { command: 'ls' } }]
}
const BASH_RESULT: StoredRow = {
  type: 'user',
  content: [{ type: 'tool_result', tool_use_id: 'toolu_01Bash', content: 'ok' }]
}
const ID = 'srvtoolu_019eMoTkm1NZbJoeEyN9H61U'

const replay = (rows: readonly StoredRow[]) =>
  rows.reduce<{ scene: AdvisorScene; cues: string[] }>(
    (seen, row, tick) => {
      const next = advisorCallAfter(seen.scene.call, advisorCallRowOf(row), tick)
      return {
        scene: { ...seen.scene, call: next.call },
        cues: next.cue === undefined ? seen.cues : [...seen.cues, next.cue.gesture]
      }
    },
    { scene: { isJevShown: false, call: undefined, playing: undefined }, cues: [] }
  )

describe('advisor calls in the stored rows', () => {
  it('opens on the advisor server_tool_use and closes on its advisor_tool_result', () => {
    expect(advisorCallRowOf(CALL)).toEqual({ opened: ID, closed: undefined })
    expect(advisorCallRowOf(RESULT)).toEqual({ opened: undefined, closed: ID })
  })

  it('ignores another server tool, a client tool and its result', () => {
    for (const row of [WEB_SEARCH, BASH, BASH_RESULT]) {
      expect(advisorCallRowOf(row)).toEqual({ opened: undefined, closed: undefined })
    }
  })

  it('plays the call when it opens and the reaction when its result comes back', () => {
    const open = advisorCallAfter(undefined, advisorCallRowOf(CALL), 10)
    expect(open.call).toEqual({ id: ID, at: 10 })
    expect(open.cue?.gesture).toBe('consulting')
    const done = advisorCallAfter(open.call, advisorCallRowOf(RESULT), 900)
    expect(done.call).toBeUndefined()
    expect(done.cue?.gesture).toBe('advised')
  })

  it('a result for another call leaves the open one thinking and plays nothing', () => {
    const open = advisorCallAfter(undefined, advisorCallRowOf(CALL), 10)
    const other = advisorCallAfter(open.call, { opened: undefined, closed: 'srvtoolu_other' }, 20)
    expect(other).toEqual({ call: open.call, cue: undefined })
  })

  it('a session without the advisor plays nothing', () => {
    expect(replay([BASH, BASH_RESULT, WEB_SEARCH])).toEqual({
      scene: { isJevShown: false, call: undefined, playing: undefined },
      cues: []
    })
  })
})

describe('the advisor while a call is open', () => {
  const cue = (gesture: 'consulting' | 'advised' | 'approved' | 'escalated', at: number) => ({
    cue: { gesture, text: gesture, isRoutine: gesture === 'approved' },
    at
  })

  it('arrives without Jev, thinks for the whole call, reacts, then leaves', () => {
    const call = { id: ID, at: 0 }
    const opening = { isJevShown: false, call, playing: cue('consulting', 0) }
    expect(advisorPoseOf(opening, 5, REFEREE, false)).toMatchObject({
      gesture: 'consulting',
      age: 5
    })
    // Long past the opening cue: the call is still open, so it is still thinking.
    const long = advisorPoseOf(opening, 1200, REFEREE, false)
    expect(long).toMatchObject({ gesture: 'consulting', age: 1200 })
    expect(long?.bubble).not.toBe('')
    const answered = { isJevShown: false, call: undefined, playing: cue('advised', 1300) }
    expect(advisorPoseOf(answered, 1310, REFEREE, false)).toMatchObject({
      gesture: 'advised',
      age: 10
    })
    expect(advisorPoseOf(answered, 1300 + cueTicksOf('advised'), REFEREE, false)).toBeUndefined()
  })

  it('never draws Jev’s own cue while Jev is not shown, but keeps thinking under it', () => {
    const scene = { isJevShown: false, call: { id: ID, at: 0 }, playing: cue('escalated', 100) }
    expect(advisorPoseOf(scene, 110, REFEREE, false)).toMatchObject({ gesture: 'consulting' })
    const after = { isJevShown: false, call: undefined, playing: cue('approved', 100) }
    expect(advisorPoseOf(after, 110, REFEREE, false)).toBeUndefined()
  })

  it('with Jev shown, a stronger cue of Jev’s plays over the call, then thinking resumes', () => {
    const scene = { isJevShown: true, call: { id: ID, at: 0 }, playing: cue('escalated', 100) }
    expect(advisorPoseOf(scene, 110, REFEREE, false)).toMatchObject({ gesture: 'escalated' })
    const resumed = advisorPoseOf(scene, 100 + cueTicksOf('escalated'), REFEREE, false)
    expect(resumed).toMatchObject({ gesture: 'consulting' })
  })

  it('with Jev shown and no call, Jev’s advisor stands idle as before', () => {
    const scene = { isJevShown: true, call: undefined, playing: undefined }
    expect(advisorPoseOf(scene, 50, REFEREE, false)).toEqual({
      sprite: REFEREE,
      age: 0,
      bubble: ''
    })
  })

  it('acts the whole call, even in zen', () => {
    const scene = { isJevShown: false, call: { id: ID, at: 0 }, playing: undefined }
    expect(isAdvisorActingOf(scene, 5000, true)).toBe(true)
    expect(isAdvisorActingOf({ ...scene, call: undefined }, 5000, true)).toBe(false)
  })
})
