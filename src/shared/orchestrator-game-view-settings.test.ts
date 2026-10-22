import { describe, expect, it } from 'vitest'

import { orchestratorGameViewSettingsOf } from './orchestrator-game-view-settings'

describe('writing a view to a settings layer', () => {
  it('stores every project as the global layer, keeping its other keys', () => {
    const settings = { orchestratorGame: { scene: 'jrpg', render: 'hd-compact' as const } }

    expect(orchestratorGameViewSettingsOf(settings, { view: '2d-hd', scope: 'global' })).toEqual({
      orchestratorGame: { scene: 'jrpg', render: 'hd-compact', mode: 'on' }
    })
    expect(orchestratorGameViewSettingsOf(settings, { view: 'flat', scope: 'global' })).toEqual({
      orchestratorGame: { scene: 'jrpg', render: 'hd-compact', mode: 'flat' }
    })
  })

  it("stores this project in the repo's own layer and leaves other repos alone", () => {
    const settings = {
      orchestratorGame: { render: 'hd' as const },
      orchestratorGameProjects: { other: { mode: 'zen' as const } }
    }

    expect(
      orchestratorGameViewSettingsOf(settings, {
        view: '2d-classic',
        scope: 'project',
        repoId: 'r1'
      })
    ).toEqual({
      orchestratorGameProjects: {
        other: { mode: 'zen' },
        r1: { mode: 'on', render: 'classic' }
      }
    })
  })

  it('keeps an hd-compact look the project inherits when 2D hd is picked', () => {
    const settings = { orchestratorGame: { render: 'hd-compact' as const } }

    expect(
      orchestratorGameViewSettingsOf(settings, { view: '2d-hd', scope: 'project', repoId: 'r1' })
    ).toEqual({ orchestratorGameProjects: { r1: { mode: 'on', render: 'hd-compact' } } })
  })

  it('shows a hidden game again when a view other than off is picked for that scope', () => {
    const settings = { orchestratorGame: { show: false, mode: 'zen' as const } }

    expect(orchestratorGameViewSettingsOf(settings, { view: 'zen', scope: 'global' })).toEqual({
      orchestratorGame: { show: true, mode: 'zen' }
    })
    expect(orchestratorGameViewSettingsOf(settings, { view: 'off', scope: 'global' })).toEqual({
      orchestratorGame: { show: false, mode: 'off' }
    })
    expect(
      orchestratorGameViewSettingsOf(settings, { view: 'flat', scope: 'project', repoId: 'r1' })
    ).toEqual({ orchestratorGameProjects: { r1: { mode: 'flat', show: true } } })
  })

  it("shows a game the project's orca.yaml hides when this project picks a view", () => {
    expect(
      orchestratorGameViewSettingsOf(
        {},
        { view: 'flat', scope: 'project', repoId: 'r1', project: { show: false } }
      )
    ).toEqual({ orchestratorGameProjects: { r1: { mode: 'flat', show: true } } })
  })

  it("keeps the hd-compact look the project's orca.yaml sets when 2D hd is picked", () => {
    expect(
      orchestratorGameViewSettingsOf(
        {},
        { view: '2d-hd', scope: 'project', repoId: 'r1', project: { render: 'hd-compact' } }
      )
    ).toEqual({ orchestratorGameProjects: { r1: { mode: 'on', render: 'hd-compact' } } })
  })

  it('refuses this project without a repo to key it on', () => {
    expect(() => orchestratorGameViewSettingsOf({}, { view: 'flat', scope: 'project' })).toThrow(
      /no project/
    )
  })
})
