import { describe, expect, it } from 'vitest'
import { findCodexReadyPromptIndex } from './codex-ready-prompt'

const lower = (lines: string[]): string => lines.join('\n').toLowerCase()

describe('findCodexReadyPromptIndex', () => {
  it('finds the pre-0.166 header with model and directory lines', () => {
    const text = lower([
      ' >_ OpenAI Codex (v0.131.0)',
      ' model:       gpt-5.5 high   /model to change',
      ' directory:   ~/orca/workspaces/orca/cli-debug'
    ])
    expect(findCodexReadyPromptIndex(text)).toBe(text.indexOf('openai codex'))
  })

  // Why (ORCA-936): 0.166.0 dropped the model/directory lines; its ready screen is the composer.
  it('finds the Codex 0.166.0 composer, which has no model or directory line', () => {
    const text = lower([
      ' >_ OpenAI Codex (v0.166.0)',
      '    /tmp/worktree-a',
      '› Ask Codex to do anything',
      '',
      '  ? for shortcuts'
    ])
    expect(findCodexReadyPromptIndex(text)).toBe(text.lastIndexOf('? for shortcuts'))
  })

  it('finds the 0.166.0 composer once the placeholder is gone', () => {
    const text = lower([' >_ OpenAI Codex (v0.166.0)', '› ', '', '  ? for shortcuts'])
    expect(findCodexReadyPromptIndex(text)).not.toBeNull()
  })

  it('ignores a 0.166.0 header still loading, before the composer is drawn', () => {
    expect(findCodexReadyPromptIndex(lower([' >_ OpenAI Codex (v0.166.0)', ' loading']))).toBeNull()
  })

  it('ignores the trust prompt, whose selected option also starts with ›', () => {
    const text = lower([
      ' >_ OpenAI Codex (v0.166.0)',
      'Do you trust the contents of this directory?',
      '› 1. Yes, continue',
      '  2. No, quit',
      'Press enter to continue'
    ])
    expect(findCodexReadyPromptIndex(text)).toBeNull()
  })

  it('ignores composer text without the Codex header', () => {
    expect(findCodexReadyPromptIndex(lower(['› Ask Codex to do anything']))).toBeNull()
  })
})
