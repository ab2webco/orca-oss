import type { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MOBILE_AGENT_TEAMS_SETTINGS_RUNTIME_CAPABILITY,
  MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY,
  MOBILE_TEAM_LEVEL_RUNTIME_CAPABILITY,
  MOBILE_TEAM_SCENE_RUNTIME_CAPABILITY
} from '../../src/shared/protocol-version'
import { teamMachineGaugesOf, teamMachineWarningsOf } from '../../src/shared/team-machine-board'
import { claudeTokenAccountStatusOf } from './accounts/claude-token-account'
import { agentTeamsSettingsOf } from './agent-teams-settings/agent-teams-settings-model'
import { AccountsSnapshotSchema } from './components/accounts-snapshot'
import { startFreshLeadFromPhone } from './new-tab-team/fresh-lead-start'
import { readNewTabTeam } from './new-tab-team/new-tab-team-read'
import { reopenTeamLeadFromPhone } from './new-tab-team/new-tab-team-reopen'
import { readLeadXp } from './team-drawer/team-drawer-rpc'
import { teamLeadViewOf } from './team-drawer/team-drawer-model'
import { teamSheetWorkOf } from './team-drawer/team-sheet-work'
import { isTerminalSendRpcAccepted } from './terminal/terminal-send-rpc-response'
import type { RpcClient } from './transport/rpc-client'
import type { RpcResponse } from './transport/types'
import { handleRequest } from '../scripts/mock-server-rpc-handlers'

// Why through mobile's own readers: a mock shape the phone cannot read hid #1238 and #1240.
const ask = (method: string, params?: Record<string, unknown>): Promise<RpcResponse> =>
  new Promise((resolve) => {
    handleRequest({ id: method, method, params }, (one) => resolve(one as RpcResponse), {
      send: () => undefined
    } as unknown as WebSocket)
  })

const client = {
  sendRequest: (method: string, params?: Record<string, unknown>) => ask(method, params)
} as unknown as RpcClient

const resultOf = async (method: string, params?: Record<string, unknown>) => {
  const response = await ask(method, params)
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result as Record<string, unknown>
}

async function activeWorktreeId(): Promise<string> {
  const { worktrees } = (await resultOf('worktree.ps')) as {
    worktrees: { worktreeId: string; isActive?: boolean }[]
  }
  return (worktrees.find((one) => one.isActive) ?? worktrees[0]).worktreeId
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('mock host answers in the host shapes mobile reads', () => {
  it('advertises the mobile Agent Teams capabilities the phone gates on', async () => {
    const { capabilities } = await resultOf('status.get')

    expect(capabilities).toEqual(
      expect.arrayContaining([
        MOBILE_TEAM_CONTROL_RUNTIME_CAPABILITY,
        MOBILE_TEAM_SCENE_RUNTIME_CAPABILITY,
        MOBILE_TEAM_LEVEL_RUNTIME_CAPABILITY,
        MOBILE_AGENT_TEAMS_SETTINGS_RUNTIME_CAPABILITY
      ])
    )
  })

  it('nests Agent Teams under settings and keeps a phone update', async () => {
    expect(agentTeamsSettingsOf(await resultOf('settings.get'))).toEqual({
      scene: 'quest',
      style: 'pixel',
      dark: {}
    })

    await resultOf('settings.update', {
      agentTeamsPanel: { style: 'office' },
      statusColors: { dark: { attention: '#ff00aa' } }
    })

    expect(agentTeamsSettingsOf(await resultOf('settings.get'))).toEqual({
      scene: 'quest',
      style: 'office',
      dark: { attention: '#ff00aa' }
    })
  })

  it('accepts terminal.send the way the host does, so the phone does not refuse its own prompt', async () => {
    expect(
      isTerminalSendRpcAccepted(await ask('terminal.send', { terminal: 'term-1', text: 'hi' }))
    ).toBe(true)
  })

  it('lists a live lead whose pane the + sheet can open, with its To Do and hosts', async () => {
    const team = await readNewTabTeam(client, {
      supported: true,
      worktreeId: await activeWorktreeId()
    })

    expect(team).toMatchObject({ kind: 'lead-live', lead: { terminal: 'term-1' } })
    const roster = team.kind === 'lead-live' ? team.roster : null
    expect(roster?.todo.map((one) => one.identifier)).toEqual(['ACME-221', 'ACME-224', 'ACME-230'])
    expect(roster?.hosts).toEqual([
      { on: null, running: 3, cap: 5 },
      { on: 'mac-studio', running: 2, cap: 4 },
      { on: 'render-node', running: 2, cap: 3 },
      { on: 'atelier', running: 0, cap: 4 },
      { on: 'veteran', running: 0, cap: 2 }
    ])
  })

  it('draws a calm, a busy, a refused, an older and an offline host in the Hosts tab', async () => {
    const state = await resultOf('game.state', { worktreeId: await activeWorktreeId() })
    const { machines } = teamSheetWorkOf(state, [], 'en', Date.now())
    const list = machines?.kind === 'ready' ? machines.value : []
    const shapes = list.map((one) => ({
      name: one.host.kind === 'local' ? 'local' : one.host.name,
      reading: one.reading.kind,
      launch: one.launch.kind,
      gauges: teamMachineGaugesOf(one),
      warnings: teamMachineWarningsOf(one)
    }))

    expect(shapes).toEqual([
      {
        name: 'local',
        reading: 'ok',
        launch: 'ready',
        gauges: { cpu: 58, memory: 67, disk: 58 },
        warnings: []
      },
      {
        name: 'mac-studio',
        reading: 'ok',
        launch: 'ready',
        gauges: { cpu: 14, memory: 38, disk: 30 },
        warnings: []
      },
      {
        name: 'render-node',
        reading: 'ok',
        launch: 'ready',
        gauges: { cpu: 96, memory: 93, disk: 70 },
        warnings: ['busy', 'lowMemory']
      },
      {
        name: 'atelier',
        reading: 'ok',
        launch: 'unregistered',
        gauges: { cpu: 7, memory: 38, disk: 36 },
        warnings: []
      },
      // Why null: an Orca older than ORCA-1252 sends no CPU or disk, and the tab must say unknown, not 0.
      {
        name: 'veteran',
        reading: 'ok',
        launch: 'unknown',
        gauges: { cpu: null, memory: 38, disk: null },
        warnings: []
      },
      {
        name: 'build-box-linux-02',
        reading: 'unreachable',
        launch: 'unknown',
        gauges: null,
        warnings: []
      }
    ])
  })

  it('names the kept lead account when no lead is live', async () => {
    vi.stubEnv('MOCK_LEADS', 'none')
    vi.stubEnv('MOCK_LEAD_STORED', 'claude-team')

    await expect(
      readNewTabTeam(client, { supported: true, worktreeId: await activeWorktreeId() })
    ).resolves.toEqual({ kind: 'lead-closed', accountEmail: 'dev@example.com' })
  })

  it('waits on a lead pane a restart has not brought back', async () => {
    vi.stubEnv('MOCK_LEADS', 'restoring')

    await expect(
      readNewTabTeam(client, { supported: true, worktreeId: await activeWorktreeId() })
    ).resolves.toEqual({ kind: 'pending' })
  })

  it('reopens the kept lead, or says why it could not', async () => {
    const args = { worktreeId: await activeWorktreeId(), project: 'acme-web' }

    await expect(reopenTeamLeadFromPhone(client, args)).resolves.toEqual({
      kind: 'failed',
      reason: 'the kept conversation is no longer on this computer'
    })
    vi.stubEnv('MOCK_REOPEN', 'ok')
    await expect(reopenTeamLeadFromPhone(client, args)).resolves.toEqual({ kind: 'lead' })
  })

  it('marks a long-lived token account checked or rejected', async () => {
    const statusFor = async (token: string) => {
      vi.stubEnv('MOCK_TOKEN', token)
      const snapshot = AccountsSnapshotSchema.parse(await resultOf('accounts.list'))
      const personal = snapshot.claude.accounts.find((one) => one.id === 'claude-personal')
      return personal && claudeTokenAccountStatusOf(personal, snapshot.rateLimits, Date.now())
    }

    expect(await statusFor('a')).toMatchObject({ tone: 'positive' })
    expect(await statusFor('b')).toMatchObject({ tone: 'negative' })
  })

  it("sums the project's characters for the Team level bar", async () => {
    await expect(readLeadXp(client, { worktreeId: 'w', terminalHandle: 'term-1' })).resolves.toBe(
      1840 + 1210 + 655
    )
  })

  it("draws a plugin scene's Figures art in the Team sheet band", async () => {
    vi.stubEnv('MOCK_CUSTOM_SCENE', '1')
    vi.stubEnv('MOCK_PANEL_STYLE', 'figures')
    const state = await resultOf('game.state', { worktreeId: await activeWorktreeId() })
    const view = teamLeadViewOf(state, new Set(), null, Date.now(), { sceneArt: true })

    expect(view?.scene).toMatchObject({
      kind: 'stage',
      art: { kind: 'scene', style: 'figures', sceneId: 'mock/neon-heist' }
    })
  })

  it("starts a fresh lead and opens the host's new pane", async () => {
    const worktreeId = await activeWorktreeId()

    await expect(
      startFreshLeadFromPhone(client, { worktreeId, accountId: null, operationId: '1-ab' })
    ).resolves.toEqual({
      kind: 'started',
      lead: { worktreeId, terminal: 'term-1', tabId: 'tab-1' }
    })
  })
})
