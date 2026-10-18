import { describe, expect, it } from 'vitest'

import { isTeammateSpawnOf, leadSubagentDenyOf } from '../hooks/lead-subagent-guard'

const CLI = 'orca'
const PLAIN = { isTeammateSpawn: false, cli: CLI }

describe('leadSubagentDenyOf', () => {
  it.each(['Agent', 'Task'])(
    'denies a plain %s subagent in the orchestrator lead, pointing to game launch',
    (tool) => {
      const reason = leadSubagentDenyOf({
        role: 'lead',
        isOrchestrator: true,
        tool,
        ...PLAIN
      })

      expect(reason).toContain('orca game launch <ticket>')
      expect(reason).toContain('--prompt')
    }
  )

  it('names the CLI this session runs, so a dev build never falls back to a bare orca', () => {
    const reason = leadSubagentDenyOf({
      role: 'lead',
      isOrchestrator: true,
      tool: 'Agent',
      isTeammateSpawn: false,
      cli: '/opt/orca dev/orca-dev'
    })

    expect(reason).toContain("'/opt/orca dev/orca-dev' game launch <ticket>")
  })

  it('allows a plain Agent Teams pane that never ran the lead rules', () => {
    expect(
      leadSubagentDenyOf({ role: 'lead', isOrchestrator: false, tool: 'Agent', ...PLAIN })
    ).toBeNull()
  })

  it('allows a teammate spawn in the orchestrator lead, since teammates are not subagents', () => {
    expect(
      leadSubagentDenyOf({
        role: 'lead',
        isOrchestrator: true,
        tool: 'Agent',
        isTeammateSpawn: true,
        cli: CLI
      })
    ).toBeNull()
  })

  it('lets a member run its own subagents', () => {
    expect(
      leadSubagentDenyOf({ role: 'member', isOrchestrator: true, tool: 'Agent', ...PLAIN })
    ).toBeNull()
  })

  it('lets a session run them, when the role is unknown', () => {
    expect(
      leadSubagentDenyOf({ role: undefined, isOrchestrator: true, tool: 'Agent', ...PLAIN })
    ).toBeNull()
  })

  it('never denies a tool other than Agent or Task, even in the orchestrator lead', () => {
    expect(
      leadSubagentDenyOf({ role: 'lead', isOrchestrator: true, tool: 'Bash', ...PLAIN })
    ).toBeNull()
    expect(
      leadSubagentDenyOf({
        role: 'lead',
        isOrchestrator: true,
        tool: 'mcp__plane__search',
        ...PLAIN
      })
    ).toBeNull()
  })
})

describe('isTeammateSpawnOf', () => {
  it('reads a team_name or a name on the Agent call as a teammate spawn', () => {
    expect(isTeammateSpawnOf({ tool: 'Agent', team_name: 'session-x' })).toBe(true)
    expect(isTeammateSpawnOf({ tool: 'Agent', name: 'reviewer' })).toBe(true)
  })

  it('treats a plain Agent call, or an empty name, as a subagent', () => {
    expect(isTeammateSpawnOf({ tool: 'Agent', description: 'audit' })).toBe(false)
    expect(isTeammateSpawnOf({ tool: 'Agent', team_name: '', name: '  ' })).toBe(false)
  })
})
