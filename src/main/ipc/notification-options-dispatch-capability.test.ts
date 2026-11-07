import { describe, expect, it } from 'vitest'
import { buildNotificationOptions } from './notification-options'

const CAPABILITY = `dcap_${'C'.repeat(43)}`

describe('notification text never carries a dispatch capability', () => {
  it.each([
    [
      'assistant message',
      { agentLastAssistantMessage: `Sent --dispatch-capability ${CAPABILITY}` }
    ],
    [
      'tool input',
      { agentToolName: 'Bash', agentToolInput: `orca ask --dispatch-capability=${CAPABILITY}` }
    ]
  ])('an agent notification body from its %s', (_name, fields) => {
    const options = buildNotificationOptions({
      source: 'agent-task-complete',
      agentType: 'claude',
      agentState: 'done',
      worktreeLabel: 'orca-1125',
      terminalTitle: `zsh ${CAPABILITY}`,
      ...fields
    })
    expect(options.body).toContain('[redacted]')
    expect(`${options.title} ${options.body}`).not.toContain('dcap_')
  })

  it('an owner question body keeps its words around the token', () => {
    const options = buildNotificationOptions({
      source: 'game-owner-question',
      repoLabel: 'orca-oss',
      ownerQuestion: `Is ${CAPABILITY} still valid?`
    })
    expect(options.body).toBe('Is [redacted] still valid?')
  })
})
