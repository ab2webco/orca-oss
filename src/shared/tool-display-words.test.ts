import { describe, expect, it } from 'vitest'
import { toolDisplayWords } from './tool-display-words'

describe('toolDisplayWords', () => {
  it('reads a tool name as words', () => {
    expect(toolDisplayWords('PushNotification')).toBe('Push notification')
    expect(toolDisplayWords('exec_command')).toBe('Exec command')
    expect(toolDisplayWords('WebFetch')).toBe('Web fetch')
    expect(toolDisplayWords('Read')).toBe('Read')
  })

  it('drops an MCP server prefix', () => {
    expect(toolDisplayWords('mcp__plane__list_states')).toBe('List states')
  })

  it('keeps a name with no words as it is', () => {
    expect(toolDisplayWords('__')).toBe('__')
  })
})
