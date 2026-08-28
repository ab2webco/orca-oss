import { describe, expect, it } from 'vitest'
import { classifyGoldenStubExit, composerLineFor } from './golden-stub-exit-verdict'

const EXIT_MARKER = 'GOLDEN_STUB_AGENT_EXITED'
const HELP_LINE = 'Shift+Enter inserts a newline. Type exit then Enter to quit.'

function classify(terminalText: string) {
  return classifyGoldenStubExit({ terminalText, command: 'exit', exitMarker: EXIT_MARKER })
}

describe('classifyGoldenStubExit', () => {
  it('passes once the exit marker is on screen', () => {
    expect(classify(`Golden Stub Agent\n> exit\n[${EXIT_MARKER}]`).kind).toBe('exited')
  })

  // The control: the replacement must still fail when the agent genuinely does
  // not exit, and must say so rather than blaming the input path.
  it('still fails when the agent received the command and did not exit', () => {
    const verdict = classify(`Golden Stub Agent\n${HELP_LINE}\n> exit`)
    expect(verdict.kind).toBe('agent-did-not-exit')
    expect(verdict.kind !== 'exited' && verdict.reason).toContain('never printed')
  })

  it('separates a lost keystroke from an agent that would not quit', () => {
    const verdict = classify(`Golden Stub Agent\n${HELP_LINE}\n> `)
    expect(verdict.kind).toBe('input-never-reached-agent')
  })

  it('does not read the help text as the agent having received the command', () => {
    // The stub's own help line contains the word "exit"; only the composer
    // prefix proves the process consumed the keystrokes.
    expect(classify(`Golden Stub Agent\n${HELP_LINE}`).kind).toBe('input-never-reached-agent')
  })

  it('builds the composer line the stub actually renders', () => {
    expect(composerLineFor('exit')).toBe('> exit')
  })
})
