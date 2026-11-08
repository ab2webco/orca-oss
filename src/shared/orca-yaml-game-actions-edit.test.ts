import { describe, expect, it } from 'vitest'
import { parseOrcaYaml } from './orca-yaml'
import { withOrcaYamlGameActions } from './orca-yaml-game-actions-edit'

const FILE = [
  '# Project hooks',
  'scripts:',
  '  setup: pnpm install # keep this',
  'orchestratorGame:',
  '  hud: false # the team likes it quiet',
  '  actions:',
  '    - label: Old',
  '      prompt: Old prompt',
  ''
].join('\n')

describe('withOrcaYamlGameActions', () => {
  it('replaces only orchestratorGame.actions and keeps every other line and comment', () => {
    const edited = withOrcaYamlGameActions(FILE, [
      { label: 'Deploy', command: 'deploy', icon: 'ship', pin: true, prompt: 'Ship it' }
    ])
    expect(edited).toEqual({
      ok: true,
      text: [
        '# Project hooks',
        'scripts:',
        '  setup: pnpm install # keep this',
        'orchestratorGame:',
        '  hud: false # the team likes it quiet',
        '  actions:',
        '    - label: Deploy',
        '      command: deploy',
        '      icon: ship',
        '      pin: true',
        '      prompt: Ship it',
        ''
      ].join('\n')
    })
    expect(parseOrcaYaml(edited.ok ? edited.text : '')?.scripts?.setup).toBe('pnpm install')
  })

  it('keeps an unchanged entry exactly as written, its comment and flow style included', () => {
    const file = [
      'orchestratorGame:',
      '  actions:',
      '    - label: Board # from the tracker',
      '      command: board',
      '      mcp: { server: plane, tool: list }',
      ''
    ].join('\n')
    const board = { label: 'Board', command: 'board', mcp: { server: 'plane', tool: 'list' } }
    const edited = withOrcaYamlGameActions(file, [{ label: 'A', command: 'a', prompt: 'B' }, board])
    expect(edited.ok && edited.text).toBe(
      [
        'orchestratorGame:',
        '  actions:',
        '    - label: A',
        '      command: a',
        '      prompt: B',
        '    - label: Board # from the tracker',
        '      command: board',
        '      mcp: { server: plane, tool: list }',
        ''
      ].join('\n')
    )
  })

  it('creates the keys in a missing file and drops an emptied list', () => {
    expect(withOrcaYamlGameActions('', [{ label: 'A', prompt: 'B' }])).toEqual({
      ok: true,
      text: 'orchestratorGame:\n  actions:\n    - label: A\n      prompt: B\n'
    })
    expect(withOrcaYamlGameActions('# keep\norchestratorGame:\n  actions: []\n', [])).toEqual({
      ok: true,
      text: '# keep\norchestratorGame: {}\n'
    })
  })

  it('refuses a file it cannot read as a mapping, or one that would pass the size limit', () => {
    expect(withOrcaYamlGameActions('scripts: [unclosed', [])).toEqual({
      ok: false,
      reason: 'invalid'
    })
    expect(withOrcaYamlGameActions('- a list\n', [])).toEqual({ ok: false, reason: 'invalid' })
    const big = [{ label: 'A', prompt: 'x'.repeat(2000) }]
    expect(withOrcaYamlGameActions(`# ${'y'.repeat(256 * 1024)}\n`, big)).toEqual({
      ok: false,
      reason: 'too-large'
    })
  })
})
