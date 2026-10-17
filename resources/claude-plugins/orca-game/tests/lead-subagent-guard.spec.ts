import { describe, expect, it } from 'vitest'

import { leadSubagentDenyOf } from '../hooks/lead-subagent-guard'

const CLI = 'orca'

describe('leadSubagentDenyOf', () => {
  it.each(['Agent', 'Task'])('denies %s in a lead session, pointing to game launch', (tool) => {
    const reason = leadSubagentDenyOf({ role: 'lead', tool, cli: CLI })

    expect(reason).toContain('orca game launch <ticket>')
    expect(reason).toContain('--prompt')
  })

  it('names the CLI this session runs, so a dev build never falls back to a bare orca', () => {
    const reason = leadSubagentDenyOf({
      role: 'lead',
      tool: 'Agent',
      cli: '/opt/orca dev/orca-dev'
    })

    expect(reason).toContain("'/opt/orca dev/orca-dev' game launch <ticket>")
  })

  it('lets a member run its own subagents', () => {
    expect(leadSubagentDenyOf({ role: 'member', tool: 'Agent', cli: CLI })).toBeNull()
  })

  it('lets a plain session run them, when the role is unknown', () => {
    expect(leadSubagentDenyOf({ role: undefined, tool: 'Agent', cli: CLI })).toBeNull()
  })

  it('never denies a tool other than Agent or Task, even in a lead session', () => {
    expect(leadSubagentDenyOf({ role: 'lead', tool: 'Bash', cli: CLI })).toBeNull()
    expect(leadSubagentDenyOf({ role: 'lead', tool: 'mcp__plane__search', cli: CLI })).toBeNull()
  })
})
