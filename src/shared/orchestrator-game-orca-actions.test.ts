import { describe, expect, it } from 'vitest'
import { mergeGameOrcaActions, parseGameOrcaActions } from './orchestrator-game-orca-actions'

describe('parseGameOrcaActions', () => {
  it('takes enabled, label, icon and prompt per Orca action, as setup writes them', () => {
    expect(
      parseGameOrcaActions({
        wave: { enabled: false },
        sweep: { prompt: ' Close only with CI green. ', label: ' Close ', icon: 'scan' }
      })
    ).toEqual({
      value: {
        wave: { enabled: false },
        sweep: { prompt: 'Close only with CI green.', label: 'Close', icon: 'scan' }
      },
      warnings: []
    })
  })

  it('refuses turning stop off, a command, unknown actions and bad fields, keeping the rest', () => {
    const parsed = parseGameOrcaActions({
      stop: { enabled: false, label: 'Halt' },
      push: { command: 'resume', icon: 'rocket', enabled: 'no', prompt: 'Go {ticket}' },
      status: { label: 'A label that is far too long to fit' },
      deploy: { enabled: false },
      sweep: 'off'
    })
    expect(parsed.value).toEqual({ stop: { label: 'Halt' }, push: {}, status: {} })
    expect(parsed.warnings).toEqual([
      'orchestratorGame.orcaActions.stop cannot be turned off',
      'orchestratorGame.orcaActions.push.command is fixed',
      'orchestratorGame.orcaActions.push.icon must be one of ship, flask, tag, review, scan, list, pulse, launch, play, check, stop',
      'orchestratorGame.orcaActions.push.enabled must be true or false',
      'orchestratorGame.orcaActions.push.prompt cannot use placeholders',
      'orchestratorGame.orcaActions.status.label must be 1 to 24 characters',
      'orchestratorGame.orcaActions.deploy is not an Orca action: wave, status, push, sweep, stop',
      'orchestratorGame.orcaActions.sweep must be a mapping'
    ])
    expect(parseGameOrcaActions(['wave']).warnings).toEqual([
      'orchestratorGame.orcaActions must be a mapping'
    ])
  })
})

describe('mergeGameOrcaActions', () => {
  it('merges field by field, a later layer winning', () => {
    expect(
      mergeGameOrcaActions([
        { wave: { enabled: false }, sweep: { prompt: 'a', icon: 'scan' } },
        undefined,
        { wave: { enabled: true }, sweep: { prompt: 'b' } }
      ])
    ).toEqual({ wave: { enabled: true }, sweep: { prompt: 'b', icon: 'scan' } })
  })
})
