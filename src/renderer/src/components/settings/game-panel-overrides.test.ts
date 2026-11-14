import { describe, expect, it } from 'vitest'
import type { OrchestratorGameLayer } from '../../../../shared/orchestrator-game-config'
import { gamePanelOverridesOf, withoutGamePanelProjectField } from './game-panel-overrides'

const ownerGlobal: OrchestratorGameLayer = { panel: { style: 'office', look: 'display' } }
const ownerLocal: OrchestratorGameLayer = {
  panel: { style: 'office', look: 'game' },
  mode: 'on',
  band: true
}

describe('gamePanelOverridesOf', () => {
  // ORCA-1203: the owner's layers, with Display picked globally.
  it("names this machine's project look that beats the global one", () => {
    expect(
      gamePanelOverridesOf('look', ownerGlobal, [{ repoId: 'oss', local: ownerLocal }])
    ).toEqual([{ repoId: 'oss', source: 'local', value: 'game' }])
  })

  it('names an orca.yaml look when this machine sets none', () => {
    expect(
      gamePanelOverridesOf('look', ownerGlobal, [
        { repoId: 'oss', project: { panel: { look: 'plain' } } }
      ])
    ).toEqual([{ repoId: 'oss', source: 'project', value: 'plain' }])
  })

  it("names this machine's layer when it sets the key over orca.yaml", () => {
    expect(
      gamePanelOverridesOf('look', ownerGlobal, [
        { repoId: 'oss', project: { panel: { look: 'plain' } }, local: ownerLocal }
      ])
    ).toEqual([{ repoId: 'oss', source: 'local', value: 'game' }])
  })

  it('names the Default view when an unset look follows a project mode', () => {
    expect(gamePanelOverridesOf('look', {}, [{ repoId: 'oss', local: { mode: 'zen' } }])).toEqual([
      { repoId: 'oss', source: 'view', value: 'display' }
    ])
  })

  it('says nothing when the project resolves to the global value', () => {
    expect(
      gamePanelOverridesOf('look', { panel: { look: 'game' } }, [
        { repoId: 'oss', local: ownerLocal }
      ])
    ).toEqual([])
    expect(
      gamePanelOverridesOf('style', ownerGlobal, [{ repoId: 'oss', local: ownerLocal }])
    ).toEqual([])
  })

  it('covers tabs, and skips a hand edit that does not parse', () => {
    const badLook = JSON.parse('{"panel":{"look":"neon"}}') as OrchestratorGameLayer
    expect(
      gamePanelOverridesOf('machines', {}, [
        { repoId: 'a', local: { panel: { tabs: { machines: false } } } },
        { repoId: 'b', local: badLook }
      ])
    ).toEqual([{ repoId: 'a', source: 'local', value: false }])
  })
})

describe('withoutGamePanelProjectField', () => {
  it("drops only that key from the repo's layer", () => {
    expect(withoutGamePanelProjectField({ oss: ownerLocal }, 'oss', 'look')).toEqual({
      oss: { panel: { style: 'office' }, mode: 'on', band: true }
    })
  })

  it('drops the repo entry once its layer is empty', () => {
    expect(
      withoutGamePanelProjectField({ oss: { panel: { look: 'game' } }, other: {} }, 'oss', 'look')
    ).toEqual({ other: {} })
  })
})
