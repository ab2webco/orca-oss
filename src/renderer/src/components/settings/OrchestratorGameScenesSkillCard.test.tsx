// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOrcaGameScenesUsageExamples } from '@/lib/orca-game-scenes-usage-examples'
import { OrchestratorGameScenesSkillCard } from './OrchestratorGameScenesSkillCard'

const mocks = vi.hoisted(() => ({
  panelProps: [] as Record<string, unknown>[],
  detectionCalls: [] as { names: readonly string[]; options: Record<string, unknown> }[],
  runtime: 'host' as 'host' | 'wsl',
  installDisabledReason: null as string | null,
  skillInstalled: false,
  searchQuery: ''
}))

vi.mock('./AgentSkillSetupPanel', () => ({
  AgentSkillSetupPanel: (props: Record<string, unknown>) => {
    mocks.panelProps.push(props)
    return (
      <section>
        <h3>{String(props.title)}</h3>
        <span>{props.installed ? 'Installed' : 'Not installed'}</span>
      </section>
    )
  }
}))

vi.mock('./CliSkillRuntimeSetup', () => ({
  buildSkillCommandForRuntime: (command: string, runtime?: { runtime: string }) =>
    runtime?.runtime === 'wsl' ? `wsl ${command}` : command,
  ensureWslCliAvailableForAgentSkillTerminal: vi.fn(),
  getWslCliDistroRequest: () => undefined
}))

vi.mock('@/hooks/useInstalledAgentSkills', () => ({
  GLOBAL_AGENT_SKILL_SOURCE_KINDS: ['home'],
  useInstalledAgentSkillNames: (names: readonly string[], options: Record<string, unknown>) => {
    mocks.detectionCalls.push({ names, options })
    return {
      installed: mocks.skillInstalled,
      loading: false,
      error: null,
      skills: [],
      refresh: vi.fn()
    }
  }
}))

vi.mock('@/hooks/useActiveProjectSkillRuntime', () => ({
  useActiveProjectSkillRuntime: () => ({
    discoveryTarget: undefined,
    agentRuntime: { runtime: mocks.runtime },
    terminalShellOverride: undefined,
    installDisabledReason: mocks.installDisabledReason,
    canUseLocalSkillFreshness: mocks.runtime !== 'wsl'
  })
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: mocks.searchQuery })
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderCard(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<OrchestratorGameScenesSkillCard />)
  })
  return container
}

const INSTALL =
  'npx skills add https://github.com/ab2webco/orca-oss --skill orca-game-scenes --global'
const UPDATE = 'npx skills update orca-game-scenes --global'

describe('OrchestratorGameScenesSkillCard', () => {
  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    mocks.panelProps.length = 0
    mocks.detectionCalls.length = 0
    mocks.runtime = 'host'
    mocks.installDisabledReason = null
    mocks.skillInstalled = false
    mocks.searchQuery = ''
  })

  it('detects the orca-game-scenes skill among globally installed skills', async () => {
    await renderCard()

    expect(mocks.detectionCalls.at(-1)?.names).toEqual(['orca-game-scenes'])
    expect(mocks.detectionCalls.at(-1)?.options).toEqual(
      expect.objectContaining({ sourceKinds: ['home'] })
    )
  })

  it('reports the detected state to the install card', async () => {
    const missing = await renderCard()
    expect(mocks.panelProps.at(-1)?.installed).toBe(false)
    expect(missing.textContent).toContain('Not installed')
    await act(async () => {
      root?.unmount()
    })
    root = null

    mocks.skillInstalled = true
    const present = await renderCard()
    expect(mocks.panelProps.at(-1)?.installed).toBe(true)
    expect(present.textContent).toContain('Installed')
  })

  it('installs from the lab fork, updates in place and tracks freshness on the host', async () => {
    await renderCard()

    expect(mocks.panelProps.at(-1)).toEqual(
      expect.objectContaining({
        title: 'Game scenes skill',
        command: INSTALL,
        installedCommand: UPDATE,
        freshnessSkillName: 'orca-game-scenes',
        installDisabled: false
      })
    )
    expect(mocks.panelProps.at(-1)?.preInstallNotice).toBeTruthy()
  })

  it('builds WSL commands and drops freshness the local scan cannot vouch for', async () => {
    mocks.runtime = 'wsl'
    await renderCard()

    expect(mocks.panelProps.at(-1)).toEqual(
      expect.objectContaining({ command: `wsl ${INSTALL}`, installedCommand: `wsl ${UPDATE}` })
    )
    expect(mocks.panelProps.at(-1)?.freshnessSkillName).toBeUndefined()
  })

  it('disables install with the runtime reason instead of building a command for it', async () => {
    mocks.runtime = 'wsl'
    mocks.installDisabledReason = 'Repair the WSL runtime first.'
    await renderCard()

    expect(mocks.panelProps.at(-1)).toEqual(
      expect.objectContaining({
        command: INSTALL,
        installDisabled: true,
        error: 'Repair the WSL runtime first.'
      })
    )
  })

  it('shows the three usage examples with the slash command filled in', async () => {
    const rendered = await renderCard()
    const examples = getOrcaGameScenesUsageExamples()

    expect(examples.map((example) => example.id)).toEqual([
      'new-scene',
      'change-colors',
      'draws-quest'
    ])
    for (const example of examples) {
      expect(rendered.textContent).toContain(example.title)
      expect(example.prompt).toContain('/orca-game-scenes')
      expect(example.prompt).not.toContain('{{value0}}')
    }
    expect(examples[0]?.prompt).toContain('Super Smash Bros')
  })

  it('is found by a settings search for the skill', async () => {
    mocks.searchQuery = 'orca-game-scenes'
    const found = await renderCard()
    expect(found.textContent).toContain('Game scenes skill')
    await act(async () => {
      root?.unmount()
    })
    root = null

    mocks.searchQuery = 'bluetooth'
    const hidden = await renderCard()
    expect(hidden.textContent).toBe('')
  })
})
