import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudePaneScreenOf, gameWaitingStateOnScreen } from './orchestrator-game-pane-prompt'

// Captured from Orca's own terminal reader on Claude Code 2.1.325 (ORCA-1231).
const tail = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', 'claude-permission-prompt', `${name}.txt`), 'utf8')

const RULE = '─'.repeat(80)

describe('claudePaneScreenOf', () => {
  it('reads an open permission dialog', () => {
    expect(claudePaneScreenOf(tail('dialog-pending'))).toEqual({
      kind: 'dialog',
      prompt: 'permission'
    })
  })

  it('reads an open AskUserQuestion dialog as a question', () => {
    expect(claudePaneScreenOf(tail('question-pending'))).toEqual({
      kind: 'dialog',
      prompt: 'question'
    })
  })

  it.each(['after-esc', 'after-no', 'after-auto-block'])(
    'reads the input box once the prompt is gone (%s)',
    (name) => {
      expect(claudePaneScreenOf(tail(name))).toEqual({ kind: 'input', turnEnded: true })
    }
  )

  it('reads a turn still running under the input box', () => {
    const screen = [
      '❯ fix the flake',
      '⏺ Bash(npm test)',
      '✻ Pontificating… (1m 43s · thinking)',
      RULE,
      '❯ ',
      RULE,
      '  ⏵⏵ auto mode on (shift+tab to cycle)'
    ].join('\n')
    expect(claudePaneScreenOf(screen)).toEqual({ kind: 'input', turnEnded: false })
  })

  it('keeps an input box when status lines follow it', () => {
    const screen = [
      '✻ Crunched for 7s · done 12:43 PM',
      RULE,
      '❯',
      RULE,
      '  orca-1231 · Sonnet 5.5 · ctx ▌░░░░ 13%',
      '  ⏵⏵ bypass permissions on (shift+tab to cycle)'
    ].join('\n')
    expect(claudePaneScreenOf(screen)).toEqual({ kind: 'input', turnEnded: true })
  })

  it('ignores a dialog quoted in the scrollback above the input box', () => {
    const screen = [
      '⏺ The dialog read:',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
      ' Esc to cancel · Tab to amend',
      '✻ Crunched for 2s · done 12:40 PM',
      RULE,
      '❯ ',
      RULE
    ].join('\n')
    expect(claudePaneScreenOf(screen)).toEqual({ kind: 'input', turnEnded: true })
  })

  it('says nothing for a screen it cannot read', () => {
    expect(claudePaneScreenOf('$ ls\nREADME.md\n$ ')).toEqual({ kind: 'unknown' })
    expect(claudePaneScreenOf('')).toEqual({ kind: 'unknown' })
  })
})

describe('gameWaitingStateOnScreen', () => {
  const waiting = { state: 'waiting' as const, agentType: 'claude' }

  it('keeps a waiting Claude member waiting while its dialog is open', () => {
    expect(gameWaitingStateOnScreen({ ...waiting, terminalTail: tail('dialog-pending') })).toBe(
      'waiting'
    )
  })

  it('drops the wait once a denied, cancelled or auto-blocked prompt is gone', () => {
    for (const name of ['after-esc', 'after-no', 'after-auto-block']) {
      expect(gameWaitingStateOnScreen({ ...waiting, terminalTail: tail(name) })).toBe('done')
    }
  })

  it('reads a resolved prompt whose turn goes on as working', () => {
    const screen = ['✻ Pontificating… (12s · thinking)', RULE, '❯ ', RULE].join('\n')
    expect(gameWaitingStateOnScreen({ ...waiting, terminalTail: screen })).toBe('working')
  })

  it('keeps the hook state when the screen proves nothing', () => {
    expect(gameWaitingStateOnScreen({ ...waiting, terminalTail: null })).toBe('waiting')
    expect(gameWaitingStateOnScreen({ ...waiting, terminalTail: '$ ' })).toBe('waiting')
    // Why: only Claude's dialogs are known; another agent's wait stands as its hooks said.
    expect(
      gameWaitingStateOnScreen({
        state: 'waiting',
        agentType: 'codex',
        terminalTail: tail('after-esc')
      })
    ).toBe('waiting')
  })

  it('leaves every other state alone', () => {
    expect(
      gameWaitingStateOnScreen({
        state: 'working',
        agentType: 'claude',
        terminalTail: tail('dialog-pending')
      })
    ).toBe('working')
  })
})
