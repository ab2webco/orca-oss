import { describe, expect, it } from 'vitest'
import { createTeamSceneDioramaEngine } from './team-scene-diorama-engine'
import type { TeamSceneEngineEvent } from './team-scene-engine-messages'

describe('the phone diorama camera (ORCA-1335)', () => {
  const engine = () => {
    const posted: TeamSceneEngineEvent[] = []
    const one = createTeamSceneDioramaEngine({
      canvas: {} as HTMLCanvasElement,
      width: () => 390,
      dark: () => true,
      scheduler: { request: () => 0, cancel: () => undefined },
      post: (event) => posted.push(event)
    })
    return { one, mode: () => posted.at(-1) }
  }

  it("takes the sheet's buttons, and a finger's pan or pinch frees the camera as on the desktop", () => {
    const { one, mode } = engine()
    one.camera({ kind: 'camera', mode: 'all' })
    expect(mode()).toEqual({ kind: 'camera', mode: 'all' })
    one.camera({ kind: 'camera', pan: [12, -4] })
    expect(mode()).toEqual({ kind: 'camera', mode: 'free' })
    one.camera({ kind: 'camera', mode: 'lead' })
    expect(mode()).toEqual({ kind: 'camera', mode: 'lead' })
    one.camera({ kind: 'camera', zoom: 1.5 })
    expect(mode()).toEqual({ kind: 'camera', mode: 'free' })
  })
})
