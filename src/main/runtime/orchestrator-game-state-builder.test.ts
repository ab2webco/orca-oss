import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sceneFile } from '../../shared/__fixtures__/orchestrator-game-scene'
import {
  registerSshFilesystemProvider,
  unregisterSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'
import type { IFilesystemProvider } from '../providers/types'
import { GameActivityMemory } from './orchestrator-game-activity-memory'
import { buildOrchestratorGameState } from './orchestrator-game-state-builder'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  unregisterSshFilesystemProvider('ssh-1')
})

// Why: only readFile is reached; the rest of the contract stays unimplemented on purpose.
function remoteHost(files: Record<string, string>, reads: string[]): IFilesystemProvider {
  return {
    readFile: async (filePath: string) => {
      reads.push(filePath)
      const content = files[filePath]
      if (content === undefined) {
        throw new Error('ENOENT')
      }
      return { content, isBinary: false }
    }
  } as IFilesystemProvider
}

function checkout(orcaYaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-game-state-'))
  dirs.push(dir)
  if (orcaYaml) {
    writeFileSync(join(dir, 'orca.yaml'), orcaYaml)
  }
  return dir
}

const none = async () => null

function worktree(path: string) {
  return {
    id: 'wt1',
    repoId: 'repo1',
    path,
    branch: 'feat/game',
    displayName: 'Game',
    linkedWorkItem: null
  }
}

describe('buildOrchestratorGameState', () => {
  it('collects config, fleet, review and the Plane work item', async () => {
    const state = await buildOrchestratorGameState({
      settings: { orchestratorGame: { hud: false } },
      worktree: worktree(checkout('orchestratorGame:\n  mode: zen\n  scene: 7\n')),
      agents: [
        {
          paneKey: 'tab:a',
          state: 'working',
          agentType: 'claude',
          displayName: null,
          taskTitle: null,
          toolName: 'Edit'
        }
      ],
      leaderPaneKey: 'tab:a',
      readReview: async () => ({
        provider: 'github',
        number: 12,
        title: 'Game',
        url: 'https://github.com/o/r/pull/12',
        state: 'open',
        status: 'success'
      }),
      readPlane: async () => ({
        identifier: 'ORCA-580',
        title: 'Orchestrator game',
        url: 'https://plane.example/ORCA-580',
        stateName: 'In Review',
        stateGroup: 'started'
      }),
      readLinear: none
    })

    expect(state.config).toMatchObject({ mode: 'zen', hud: false })
    expect(state.sources).toMatchObject({ mode: 'project', hud: 'global' })
    expect(state.warnings).toEqual(['orchestratorGame.scene must be a non-empty scene id'])
    expect(state.agents).toEqual([
      {
        paneKey: 'tab:a',
        displayName: null,
        agentType: 'claude',
        state: 'working',
        toolName: 'Edit',
        isLeader: true
      }
    ])
    expect(state.review?.ci).toBe('success')
    expect(state.workItem).toEqual({
      provider: 'plane',
      identifier: 'ORCA-580',
      title: 'Orchestrator game',
      url: 'https://plane.example/ORCA-580',
      status: 'In Review',
      statusGroup: 'review'
    })
    expect(state.links?.map((link) => [link.kind, link.url])).toEqual([
      ['review', 'https://github.com/o/r/pull/12'],
      ['ci', 'https://github.com/o/r/pull/12/checks'],
      ['workItem', 'https://plane.example/ORCA-580']
    ])
  })

  it('hands out the terminal handle of each agent pane that maps to one', async () => {
    const row = {
      state: 'working' as const,
      agentType: 'claude',
      displayName: 'dev',
      taskTitle: null,
      toolName: null
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab:a' },
        { ...row, paneKey: 'tab:gone' }
      ],
      leaderPaneKey: null,
      terminalHandleOf: (paneKey) => (paneKey === 'tab:a' ? 'term_a' : null),
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents[0]?.terminalHandle).toBe('term_a')
    // Why: an absent key, not null, keeps the row identical to what older hosts send.
    expect(state.agents[1]).not.toHaveProperty('terminalHandle')
  })

  // Why: one worktree can host several Teams; a band counting another Team's agents misleads.
  it("keeps only the calling team's panes when the team is known", async () => {
    const row = {
      state: 'done' as const,
      agentType: 'claude',
      displayName: null,
      taskTitle: null,
      toolName: null
    }
    const handles: Record<string, string> = {
      'tab-1:lead': 'term_lead',
      'tab-1:mate': 'term_mate',
      'tab-2:other-lead': 'term_other',
      'tab-3:moved-mate': 'term_moved'
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: Object.keys(handles).map((paneKey) => ({ ...row, paneKey })),
      leaderPaneKey: 'tab-1:lead',
      terminalHandleOf: (paneKey) => handles[paneKey] ?? null,
      teamHandles: new Set(['term_lead', 'term_mate', 'term_moved']),
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.agents.map((agent) => agent.paneKey)).toEqual([
      'tab-1:lead',
      'tab-1:mate',
      'tab-3:moved-mate'
    ])
  })

  it('counts the members the lead launched, in its worktree or in their own, as the fleet', async () => {
    const row = {
      state: 'working' as const,
      agentType: 'claude',
      displayName: null,
      taskTitle: null,
      toolName: null
    }
    const handles: Record<string, string> = {
      'tab-1:lead': 'term_lead',
      'tab-1:mate': 'term_mate',
      'tab-4:here': 'term_here',
      'tab-5:stranger': 'term_stranger'
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [
        { ...row, paneKey: 'tab-1:lead' },
        { ...row, paneKey: 'tab-1:mate' },
        { ...row, paneKey: 'tab-4:here', parentPaneKey: 'tab-1:lead', taskTitle: 'CIN-7 Login' },
        { ...row, paneKey: 'tab-5:stranger', parentPaneKey: 'tab-9:other-lead' }
      ],
      members: [
        {
          row: { ...row, paneKey: 'tab-6:away', taskTitle: 'CIN-8 Seats', state: 'blocked' },
          worktree: { id: 'wt-cin-8', branch: 'feat/cin-8', displayName: 'cin-8' }
        }
      ],
      leaderPaneKey: 'tab-1:lead',
      terminalHandleOf: (paneKey) =>
        handles[paneKey] ?? (paneKey === 'tab-6:away' ? 'term_away' : null),
      teamHandles: new Set(['term_lead', 'term_mate']),
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(
      state.agents.map((agent) => [agent.paneKey, agent.displayName, agent.isMember ?? false])
    ).toEqual([
      ['tab-1:lead', null, false],
      ['tab-1:mate', null, false],
      ['tab-4:here', 'CIN-7 Login', true],
      ['tab-6:away', 'CIN-8 Seats', true]
    ])
    expect(state.agents[3]).toMatchObject({
      state: 'waiting',
      terminalHandle: 'term_away',
      worktree: { id: 'wt-cin-8', branch: 'feat/cin-8', displayName: 'cin-8' }
    })
  })

  it('falls back to a linked item without status when no tracker answers', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: {
        ...worktree(checkout()),
        linkedWorkItem: {
          provider: 'jira',
          type: 'issue',
          number: 0,
          title: 'Checkout flow',
          url: 'https://jira.example/browse/CIN-9',
          jiraIdentifier: 'CIN-9'
        }
      },
      agents: [],
      leaderPaneKey: null,
      readReview: async () => {
        throw new Error('gh not authenticated')
      },
      readPlane: async () => {
        throw new Error('plane offline')
      },
      readLinear: none
    })

    expect(state.review).toBeNull()
    expect(state.workItem).toEqual({
      provider: 'jira',
      identifier: 'CIN-9',
      title: 'Checkout flow',
      url: 'https://jira.example/browse/CIN-9',
      status: '',
      statusGroup: 'unknown'
    })
  })

  it('reads the live status of a linked Jira issue', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: {
        ...worktree(checkout()),
        linkedWorkItem: {
          provider: 'jira',
          type: 'issue',
          number: 0,
          title: 'Checkout flow',
          url: 'https://jira.example/browse/CIN-9',
          jiraIdentifier: 'CIN-9'
        }
      },
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none,
      readLinkedStatus: async (linked) =>
        linked.jiraIdentifier === 'CIN-9' ? { name: 'QA', group: 'review' } : null
    })

    expect(state.workItem).toMatchObject({
      identifier: 'CIN-9',
      status: 'QA',
      statusGroup: 'review'
    })
  })

  it('leaves the work item out when the project turns the tracker off', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: worktree(checkout('orchestratorGame:\n  tracker: false\n')),
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: async () => ({
        identifier: 'ORCA-1',
        title: 'x',
        url: '',
        stateName: 'Todo',
        stateGroup: 'unstarted'
      }),
      readLinear: none
    })

    expect(state.workItem).toBeNull()
  })

  it("hands the project's To Do source and the worktree's item to the project work reader", async () => {
    const asked: unknown[] = []
    const project = {
      reviews: null,
      todo: {
        provider: 'plane',
        total: 1,
        url: null,
        items: [{ id: 'ORCA-9', title: 'Mine', url: 'https://app.plane.so/w/browse/ORCA-9/' }]
      }
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: worktree(
        checkout('orchestratorGame:\n  todo:\n    provider: plane\n    project: p1\n')
      ),
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: async () => ({
        identifier: 'ORCA-1',
        title: 'x',
        url: '',
        stateName: 'Todo',
        stateGroup: 'unstarted'
      }),
      readLinear: none,
      readProjectWork: async (args) => {
        asked.push(args)
        return project
      }
    })

    expect(asked).toEqual([
      {
        todo: { provider: 'plane', project: 'p1' },
        workItem: expect.objectContaining({ provider: 'plane', identifier: 'ORCA-1' })
      }
    ])
    expect(state.project?.todo?.items).toEqual([
      {
        id: 'ORCA-9',
        title: 'Mine',
        url: 'https://app.plane.so/w/browse/ORCA-9/',
        prompt: 'Work on ORCA-9: Mine\nhttps://app.plane.so/w/browse/ORCA-9/'
      }
    ])
    expect(state.actions).toBeUndefined()
  })

  it("sends the project's actions filled for this worktree and each ticket's work prompt", async () => {
    const yaml = [
      'orchestratorGame:',
      '  todo:',
      '    provider: jira',
      '    project: CIN',
      "    workPrompt: '/o:launch {id}'",
      '  actions:',
      '    - label: Ship',
      "      prompt: 'Open the PR for {branch}'",
      '    - label: Runs',
      '      mcp:',
      '        server: tambora',
      '        tool: list_test_run_cases',
      ''
    ].join('\n')
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: worktree(checkout(yaml)),
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none,
      readProjectWork: async () => ({
        reviews: null,
        todo: {
          provider: 'jira',
          total: 1,
          url: null,
          items: [{ id: 'CIN-7', title: 'Login', url: 'https://jira.example/browse/CIN-7' }]
        }
      })
    })

    expect(state.actions).toEqual([
      { id: 'action-0', label: 'Ship', prompt: `Open the PR for ${state.worktree?.branch}` },
      { id: 'action-1', label: 'Runs', mcp: { server: 'tambora', tool: 'list_test_run_cases' } }
    ])
    expect(state.project?.todo?.items[0]?.prompt).toBe('/o:launch CIN-7')
  })

  it('reads no project work when the tracker is off or there is no worktree', async () => {
    let reads = 0
    const readProjectWork = async () => {
      reads += 1
      return { reviews: null, todo: null }
    }
    const off = await buildOrchestratorGameState({
      settings: undefined,
      worktree: worktree(checkout('orchestratorGame:\n  tracker: false\n')),
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none,
      readProjectWork
    })
    const outside = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none,
      readProjectWork
    })

    expect(reads).toBe(0)
    expect(off.project).toBeUndefined()
    expect(outside.project).toBeUndefined()
  })

  it('answers with defaults outside a worktree', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.worktree).toBeNull()
    expect(state.config.mode).toBe('on')
    expect(state.extensions).toEqual({ scenes: [] })
  })

  it('serves contributed scenes namespaced by plugin and warns about the ones it drops', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: worktree(checkout('orchestratorGame:\n  scene: acme.space/orbit\n')),
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none,
      readScenes: async () => [
        { pluginId: 'acme.space', id: 'orbit', text: JSON.stringify(sceneFile()) },
        { pluginId: 'acme.space', id: 'flat', text: JSON.stringify(sceneFile({ band: {} })) }
      ]
    })

    expect(state.config.scene).toBe('acme.space/orbit')
    expect(state.extensions?.scenes.map((one) => [one.id, one.pluginId])).toEqual([
      ['acme.space/orbit', 'acme.space']
    ])
    expect(state.extensions?.scenes[0]?.definition.id).toBe('acme.space/orbit')
    expect(state.warnings).toEqual([expect.stringContaining('game scene acme.space/flat dropped')])
  })

  it('keeps the rest of the state when reading scenes fails', async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: null,
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none,
      readScenes: async () => {
        throw new Error('plugin service gone')
      }
    })

    expect(state.extensions).toEqual({ scenes: [] })
    expect(state.config.mode).toBe('on')
  })

  it('reads the project layer of an SSH worktree from its host, not the local disk', async () => {
    const reads: string[] = []
    registerSshFilesystemProvider(
      'ssh-1',
      remoteHost({ '/srv/repo/orca.yaml': 'orchestratorGame:\n  mode: zen\n' }, reads)
    )
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: { ...worktree('/srv/repo'), connectionId: 'ssh-1' },
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(reads).toEqual(['/srv/repo/orca.yaml'])
    expect(state.config.mode).toBe('zen')
    expect(state.sources.mode).toBe('project')
  })

  it('falls back to the other layers while the SSH host is disconnected', async () => {
    const state = await buildOrchestratorGameState({
      settings: { orchestratorGame: { hud: false } },
      worktree: { ...worktree('/srv/repo'), connectionId: 'ssh-1' },
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.config).toMatchObject({ mode: 'on', hud: false })
  })

  it("shows each agent's latest matched MCP activity as a row field, the leader's and a link", async () => {
    const row = {
      state: 'working' as const,
      agentType: 'claude',
      displayName: 'tester',
      taskTitle: null,
      toolName: null
    }
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: worktree(
        checkout(`orchestratorGame:
  activity:
    - name: Tambora run
      tools: mcp__tambora__*
      match: 'TR-([A-Z]+)-\\d+'
      url: https://tambora.example/projects/{1}/testruns/{0}
`)
      ),
      agents: [
        { ...row, paneKey: 'tab:lead' },
        { ...row, paneKey: 'tab:qa' }
      ],
      leaderPaneKey: 'tab:qa',
      mcpCallsOf: (paneKey) =>
        paneKey === 'tab:qa'
          ? [
              {
                toolName: 'mcp__tambora__create_test_run',
                input: '{"project_key":"CIN"}',
                result: 'Created TR-CIN-12',
                running: true,
                at: 5
              }
            ]
          : [],
      readReview: none,
      readPlane: none,
      readLinear: none
    })
    const activity = {
      name: 'Tambora run',
      id: 'TR-CIN-12',
      url: 'https://tambora.example/projects/CIN/testruns/TR-CIN-12',
      at: 5,
      running: true
    }

    expect(state.agents[0]).not.toHaveProperty('activity')
    expect(state.agents[1]?.activity).toEqual(activity)
    expect(state.activity).toEqual(activity)
    expect(state.links).toEqual([
      {
        id: 'activity:tab:qa',
        kind: 'activity',
        provider: 'Tambora run',
        label: 'TR-CIN-12',
        url: activity.url,
        status: 'running',
        tone: 'pending'
      }
    ])
  })

  it('keeps showing an agent activity after its call leaves the recent MCP calls', async () => {
    const row = {
      state: 'working' as const,
      agentType: 'claude',
      displayName: 'tester',
      taskTitle: null,
      toolName: null,
      paneKey: 'tab:qa'
    }
    const memory = new GameActivityMemory()
    let calls = [
      {
        toolName: 'mcp__tambora__create_test_run',
        input: '{"project_key":"CIN"}',
        result: 'Created TR-CIN-12',
        running: true,
        at: 5
      }
    ]
    const build = () =>
      buildOrchestratorGameState({
        settings: undefined,
        worktree: worktree(
          checkout(`orchestratorGame:
  activity:
    - name: Tambora run
      tools: mcp__tambora__*
      match: 'TR-([A-Z]+)-\\d+'
      url: https://tambora.example/projects/{1}/testruns/{0}
`)
        ),
        agents: [row],
        leaderPaneKey: 'tab:qa',
        mcpCallsOf: () => calls,
        activityMemory: memory,
        readReview: none,
        readPlane: none,
        readLinear: none
      })
    expect((await build()).agents[0]?.activity?.id).toBe('TR-CIN-12')

    calls = [{ ...calls[0]!, toolName: 'mcp__plane__list', result: 'nothing', at: 9 }]
    const later = await build()

    expect(later.agents[0]?.activity).toMatchObject({ id: 'TR-CIN-12', running: false })
    expect(later.activity).toMatchObject({ id: 'TR-CIN-12', running: false })
    expect(later.links?.map((link) => link.id)).toEqual(['activity:tab:qa'])
  })

  it("adds the project's links, dropping one whose placeholder has no value here", async () => {
    const state = await buildOrchestratorGameState({
      settings: undefined,
      worktree: worktree(
        checkout(`orchestratorGame:
  links:
    - label: Branch CI
      url: https://ci.example/branches/{branch}
    - label: Ticket
      url: https://jira.example/browse/{workItem.identifier}
`)
      ),
      agents: [],
      leaderPaneKey: null,
      readReview: none,
      readPlane: none,
      readLinear: none
    })

    expect(state.links).toEqual([
      {
        id: 'project:0',
        kind: 'project',
        provider: 'project',
        label: 'Branch CI',
        url: 'https://ci.example/branches/feat%2Fgame'
      }
    ])
  })
})
