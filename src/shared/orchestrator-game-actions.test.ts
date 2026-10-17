import { describe, expect, it } from 'vitest'
import { gameActionsOf, parseGameActions, renderGameWorkPrompt } from './orchestrator-game-actions'

describe('parseGameActions', () => {
  it('takes prompt and MCP actions, trimming labels and keeping MCP arguments', () => {
    expect(
      parseGameActions([
        { label: ' QA board ', prompt: 'List my CIN tickets in QA' },
        {
          label: 'Test runs',
          mcp: { server: 'tambora', tool: 'list_test_run_cases', args: { run: 'TR-CIN-1' } }
        }
      ])
    ).toEqual({
      value: [
        { label: 'QA board', prompt: 'List my CIN tickets in QA' },
        {
          label: 'Test runs',
          mcp: { server: 'tambora', tool: 'list_test_run_cases', args: { run: 'TR-CIN-1' } }
        }
      ],
      warnings: []
    })
  })

  it('drops an action that is neither or both kinds, or names an unknown placeholder', () => {
    const parsed = parseGameActions([
      { label: 'Nothing' },
      { label: 'Both', prompt: 'x', mcp: { server: 's', tool: 't' } },
      { label: 'Bad tool', mcp: { server: 'tambora', tool: 'list runs' } },
      { label: 'Bad args', mcp: { server: 'tambora', tool: 'x', args: ['a'] } },
      { label: 'Unknown', prompt: 'Work on {ticket}' },
      { label: 'A label that is far too long to fit', prompt: 'x' }
    ])
    expect(parsed.value).toEqual([])
    expect(parsed.warnings).toEqual([
      'orchestratorGame.actions[0] must have either prompt or mcp',
      'orchestratorGame.actions[1] must have either prompt or mcp',
      'orchestratorGame.actions[2].mcp must name a server and a tool like list_test_runs',
      'orchestratorGame.actions[3].mcp.args must be a mapping',
      'orchestratorGame.actions[4].prompt uses an unknown placeholder {ticket}',
      'orchestratorGame.actions[5].label must be 1 to 24 characters'
    ])
  })

  it('takes an optional slash command name, refusing one that is not a short lowercase word', () => {
    const parsed = parseGameActions([
      { label: 'Test runs', command: ' test-runs ', prompt: 'Run the QA test runs' },
      { label: 'Runs', command: 'runs', mcp: { server: 'tambora', tool: 'list' } },
      { label: 'Bad', command: '/Wave', prompt: 'x' },
      { label: 'Long', command: 'a-command-name-far-too-long', prompt: 'x' },
      { label: 'Number', command: 3, prompt: 'x' }
    ])
    expect(parsed.value).toEqual([
      { label: 'Test runs', command: 'test-runs', prompt: 'Run the QA test runs' },
      { label: 'Runs', command: 'runs', mcp: { server: 'tambora', tool: 'list' } }
    ])
    expect(parsed.warnings).toEqual([
      'orchestratorGame.actions[2].command must be a lowercase name like test-runs, up to 24 characters',
      'orchestratorGame.actions[3].command must be a lowercase name like test-runs, up to 24 characters',
      'orchestratorGame.actions[4].command must be a lowercase name like test-runs, up to 24 characters'
    ])
  })

  it('takes a Panel key per action, dropping one the Panel reserves or another action took', () => {
    const parsed = parseGameActions([
      { label: 'Runs', key: ' x ', prompt: 'a' },
      { label: 'Digit', key: '0', prompt: 'b' },
      { label: 'Refresh', key: 'r', prompt: 'c' },
      { label: 'Tile', key: '3', prompt: 'd' },
      { label: 'Twice', key: 'x', prompt: 'e' },
      { label: 'Word', key: 'xy', prompt: 'f' }
    ])
    // Why kept: a bad key costs the action its key, never its button.
    expect(parsed.value).toEqual([
      { label: 'Runs', key: 'x', prompt: 'a' },
      { label: 'Digit', key: '0', prompt: 'b' },
      { label: 'Refresh', prompt: 'c' },
      { label: 'Tile', prompt: 'd' },
      { label: 'Twice', prompt: 'e' },
      { label: 'Word', prompt: 'f' }
    ])
    expect(parsed.warnings).toEqual([
      'orchestratorGame.actions[2].key r is taken by the Panel',
      'orchestratorGame.actions[3].key 3 is taken by the Panel',
      "orchestratorGame.actions[4].key x is already another action's",
      'orchestratorGame.actions[5].key must be one lowercase letter or digit'
    ])
  })

  it('keeps the first six and refuses a non-list', () => {
    const many = Array.from({ length: 8 }, (_, at) => ({ label: `A${at}`, prompt: 'x' }))
    expect(parseGameActions(many).value).toHaveLength(6)
    expect(parseGameActions('nope').warnings).toEqual(['orchestratorGame.actions must be a list'])
  })
})

describe('gameActionsOf', () => {
  it("fills a prompt from the worktree and leaves out one whose value it doesn't have", () => {
    expect(
      gameActionsOf(
        [
          { label: 'Ship', prompt: 'Open the PR for {workItem.identifier} on {branch}' },
          { label: 'Review', prompt: 'Review #{review.number}' },
          { label: 'Runs', command: 'runs', mcp: { server: 'tambora', tool: 'list' } }
        ],
        { 'workItem.identifier': 'CIN-12', branch: 'feat/cin-12' }
      )
    ).toEqual([
      { id: 'action-0', label: 'Ship', prompt: 'Open the PR for CIN-12 on feat/cin-12' },
      { id: 'action-2', label: 'Runs', command: 'runs', mcp: { server: 'tambora', tool: 'list' } }
    ])
  })
})

describe('renderGameWorkPrompt', () => {
  it('fills the ticket into the template, or into the default one', () => {
    const item = { id: 'CIN-7', title: 'Login', url: 'https://jira/CIN-7', status: 'QA' }
    expect(renderGameWorkPrompt(undefined, item)).toBe('Work on CIN-7: Login\nhttps://jira/CIN-7')
    expect(renderGameWorkPrompt('/o:launch {id} ({status})', item)).toBe('/o:launch CIN-7 (QA)')
  })
})
