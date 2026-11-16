import { describe, expect, it } from 'vitest'
import type { TeamSceneInput } from '../../../src/shared/team-scene/team-scene-types'
import {
  teamSceneEngineCommandOf,
  teamSceneEngineEventOf,
  type TeamSceneEngineCommand
} from './team-scene-webview-messages'

const input: TeamSceneInput = {
  lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' },
  advisor: { line: null },
  members: [
    {
      key: 'pane-1',
      name: 'Mario',
      characterKey: 'mario',
      activity: 'needsYou',
      reportId: null,
      mergedPr: 12,
      site: { stage: 1, broken: false },
      decisions: [{ id: 'd1', verdict: 'allow', gesture: null }],
      ci: 'pending'
    }
  ],
  desks: { taken: 1, free: 2 }
}

const scene: TeamSceneEngineCommand = {
  type: 'scene',
  setup: {
    sceneId: 'quest',
    extension: null,
    timezone: 'America/Bogota',
    colors: { attention: '#f00', done: '#a0f', working: '#0f0', risk: '#fa0' }
  },
  input,
  reducedMotion: false
}

describe('teamSceneEngineCommandOf', () => {
  it('reads a scene command sent as JSON text, as postMessage delivers it', () => {
    expect(teamSceneEngineCommandOf(JSON.stringify(scene))).toEqual(scene)
  })

  it('reads a run command', () => {
    expect(teamSceneEngineCommandOf('{"type":"run","running":false}')).toEqual({
      type: 'run',
      running: false
    })
  })

  it('keeps the host’s entry for a scene that is not built in', () => {
    const extension = { id: 'acme/farm', pluginId: 'acme', definition: { name: 'Farm' } }
    const custom = { ...scene, setup: { ...scene.setup, sceneId: 'acme/farm', extension } }
    expect(teamSceneEngineCommandOf(JSON.stringify(custom))).toEqual(custom)
  })

  it.each([
    ['not JSON', '{'],
    ['no type', '{}'],
    ['an unknown type', '{"type":"paint"}'],
    ['a run without a flag', '{"type":"run"}'],
    ['a scene without input', JSON.stringify({ ...scene, input: undefined })],
    ['a scene without a lead', JSON.stringify({ ...scene, input: { ...input, lead: null } })],
    [
      'a member with an unknown activity',
      JSON.stringify({
        ...scene,
        input: { ...input, members: [{ ...input.members[0], activity: 'dancing' }] }
      })
    ],
    [
      'a member without a site',
      JSON.stringify({
        ...scene,
        input: { ...input, members: [{ ...input.members[0], site: null }] }
      })
    ],
    [
      'a setup without colours',
      JSON.stringify({ ...scene, setup: { ...scene.setup, colors: {} } })
    ],
    [
      'a scene entry with a list as definition',
      JSON.stringify({
        ...scene,
        setup: { ...scene.setup, extension: { id: 'a/b', pluginId: 'a', definition: [] } }
      })
    ],
    [
      'a scene entry without a plugin id',
      JSON.stringify({
        ...scene,
        setup: { ...scene.setup, extension: { id: 'a/b', definition: {} } }
      })
    ],
    ['a scene without reducedMotion', JSON.stringify({ ...scene, reducedMotion: undefined })]
  ])('rejects %s', (_label, raw) => {
    expect(teamSceneEngineCommandOf(raw)).toBeNull()
  })
})

describe('teamSceneEngineEventOf', () => {
  it.each([
    [{ type: 'ready' }],
    [{ type: 'drawn', height: 126 }],
    [{ type: 'error', message: 'boom' }]
  ])('reads %j', (event) => {
    expect(teamSceneEngineEventOf(JSON.stringify(event))).toEqual(event)
  })

  it.each([
    ['not JSON', 'ready'],
    ['an unknown type', '{"type":"hello"}'],
    ['a drawn event without a height', '{"type":"drawn"}'],
    ['an error without a message', '{"type":"error"}']
  ])('rejects %s', (_label, raw) => {
    expect(teamSceneEngineEventOf(raw)).toBeNull()
  })
})
