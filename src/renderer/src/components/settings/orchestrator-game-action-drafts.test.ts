import { describe, expect, it } from 'vitest'
import {
  EMPTY_ACTION_DRAFT,
  actionDraftOf,
  actionsOfDrafts,
  type ActionDraft
} from './orchestrator-game-action-drafts'

const prompt = (patch: Partial<ActionDraft> = {}): ActionDraft => ({
  ...EMPTY_ACTION_DRAFT,
  label: 'Test runs',
  command: 'test-runs',
  prompt: 'Run the QA test runs',
  ...patch
})

describe('action drafts', () => {
  it('round-trips a prompt action and an MCP action with its arguments as JSON', () => {
    const actions = [
      { label: 'Test runs', command: 'test-runs', prompt: 'Run the QA test runs' },
      { label: 'Runs', mcp: { server: 'tambora', tool: 'list', args: { project: 'CIN' } } }
    ]
    const drafts = actions.map(actionDraftOf)
    expect(drafts[1]).toEqual({
      ...EMPTY_ACTION_DRAFT,
      label: 'Runs',
      kind: 'mcp',
      server: 'tambora',
      tool: 'list',
      args: '{"project":"CIN"}'
    })
    expect(actionsOfDrafts(drafts)).toEqual({ actions, problems: [null, null] })
  })

  it('names the field each row gets wrong, with the shared parser', () => {
    const { actions, problems } = actionsOfDrafts([
      prompt({ label: '' }),
      prompt({ command: 'Bad Name' }),
      prompt({ prompt: 'Work on {ticket}' }),
      prompt({ kind: 'mcp', server: 'tambora', tool: 'has space' }),
      prompt({ kind: 'mcp', server: 'tambora', tool: 'list', args: '{nope' }),
      prompt({ kind: 'mcp', server: 'tambora', tool: 'list', args: '[1]' })
    ])
    expect(actions).toBeNull()
    expect(problems).toEqual(['label', 'command', 'prompt', 'mcp', 'args', 'args'])
  })

  it('refuses a command a lead button or another row already uses', () => {
    expect(actionsOfDrafts([prompt({ command: 'wave' }), prompt(), prompt()]).problems).toEqual([
      'commandTaken',
      null,
      'commandTaken'
    ])
  })

  it('leaves out an empty command', () => {
    expect(actionsOfDrafts([prompt({ command: '  ' })]).actions).toEqual([
      { label: 'Test runs', prompt: 'Run the QA test runs' }
    ])
  })
})
