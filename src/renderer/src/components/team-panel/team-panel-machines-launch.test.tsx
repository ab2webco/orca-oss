// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameHostCapacity } from '../../../../shared/orchestrator-game-host-capacity'
import { gameHostLaunchOf } from '../../../../shared/orchestrator-game-member-repo-scope'
import type { OrchestratorGameState } from '../../../../shared/orchestrator-game-state'
import type { TeamPanelModel } from '../../../../shared/team-panel-model-types'
import { teamMachinesSectionOf } from '../../../../shared/team-panel-work-tabs'
import { TeamPanelMachinesTab } from './team-panel-machines-tab'

vi.mock('@/i18n/i18n', () => ({
  getIntlLocale: () => 'en-US',
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    Object.entries(options ?? {}).reduce(
      (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
      fallback
    )
}))

const GB = 1024 ** 3
const REFUSAL =
  "orca-oss on m1 names github.com/stablyai/orca, the upstream every fork of it shares, so Orca cannot tell it is orca-oss's clone."

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

const host = (name: string, launch?: GameHostCapacity['launch']): GameHostCapacity => ({
  host: name,
  running: 0,
  cap: 5,
  status: 'ok',
  cpuCoreCount: 8,
  totalMemory: 32 * GB,
  availableMemory: 28 * GB,
  loadAverage1m: 1,
  ...(launch ? { launch } : {})
})

// Why from game state: the row must say what the published field says, end to end.
function rowOf(one: GameHostCapacity): HTMLElement {
  const state = {
    role: 'lead',
    agents: [],
    hostCapacity: [one]
  } as unknown as OrchestratorGameState
  const section = teamMachinesSectionOf({ state, members: [] })
  if (section?.kind !== 'ready') {
    throw new Error(`expected ready, got ${section?.kind}`)
  }
  const container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  act(() =>
    root?.render(
      <TeamPanelMachinesTab
        value={section.value}
        model={{} as TeamPanelModel}
        selectTab={() => {}}
      />
    )
  )
  return container.querySelector(`[data-team-machine="${one.host}"]`)!
}

describe('TeamPanelMachinesTab launch eligibility (ORCA-1207)', () => {
  it("says a host without the project's repo is not registered, and what to do", () => {
    const row = rowOf(
      host('koombea', { kind: 'unregistered', project: 'orca-oss', reason: 'not on koombea' })
    )
    expect(row.textContent).toContain('Not registered')
    expect(row.textContent).not.toContain('Free')
    expect(row.textContent).toContain(
      "orca-oss is not registered here. With the owner's OK, clone and register it."
    )
  })

  it('quotes the refusal of a host the repo-scope check refuses', () => {
    const row = rowOf(host('m1', { kind: 'refused', reason: REFUSAL }))
    expect(row.textContent).toContain('Refused')
    expect(row.textContent).not.toContain('Free')
    expect(row.querySelector('[data-team-machine-launch="refused"]')?.textContent).toBe(REFUSAL)
  })

  it('shows in full why a partial clone with no remote identity cannot take members (ORCA-1250)', () => {
    const lead = {
      id: 'r',
      displayName: 'orca-oss',
      path: '/w',
      remoteKey: 'github.com/ab2webco/orca-oss'
    }
    const partial = { id: 'h', displayName: 'orca-oss', path: '/w', remoteKey: null }
    const launch = gameHostLaunchOf({ lead, host: 'koombea', repos: [partial] })
    const row = rowOf(host('koombea', launch))
    expect(row.textContent).not.toContain('Free')
    expect(row.querySelector('[data-team-machine-launch="refused"]')?.textContent).toBe(
      "orca-oss on koombea has no remote identity yet, so Orca cannot tell whether it is orca-oss's clone. See ORCA-1250."
    )
  })

  it('keeps showing a ready host as free, with no note', () => {
    const repo = { id: 'h', displayName: 'orca-oss', path: '/w', remoteKey: null }
    const row = rowOf(host('m1', { kind: 'ready', repo }))
    expect(row.textContent).toContain('Free')
    expect(row.querySelector('[data-team-machine-launch]')).toBeNull()
  })

  it("reads a host an older Orca's state says nothing about as unknown, never free", () => {
    const row = rowOf(host('m1'))
    expect(row.textContent).toContain('Unknown')
    expect(row.textContent).not.toContain('Free')
  })

  it('names a host that did not list its repos as not answering', () => {
    expect(rowOf(host('imac', { kind: 'unanswered' })).textContent).toContain('Not answering')
  })

  it('draws host names in the panel sans font, not mono', () => {
    expect(rowOf(host('m1')).querySelector('b')?.className).not.toContain('font-mono')
  })
})
