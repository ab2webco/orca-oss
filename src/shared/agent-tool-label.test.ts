import { describe, expect, it } from 'vitest'
import { agentToolLabelOf } from './agent-tool-label'

describe('agentToolLabelOf', () => {
  // Why (ORCA-1130 D8): a raw MCP id reached rows and the scene bubble as written.
  it('names an MCP tool by its server and words, never its raw id', () => {
    expect(agentToolLabelOf('mcp__plugin_engram_engram__mem_current_project')).toBe(
      'engram: mem current project'
    )
    expect(agentToolLabelOf('mcp__plane__get_work_item')).toBe('plane: get work item')
    expect(agentToolLabelOf('mcp__claude_ai_Atlassian__getJiraIssue')).toBe(
      'claude ai Atlassian: getJiraIssue'
    )
    expect(agentToolLabelOf('mcp__plugin_orca_sonar_sonar__find')).toBe('orca sonar sonar: find')
  })

  it("keeps a built-in tool's name, which is already a word", () => {
    expect(agentToolLabelOf('Bash')).toBe('Bash')
    expect(agentToolLabelOf('mcp__')).toBe('mcp__')
  })
})
