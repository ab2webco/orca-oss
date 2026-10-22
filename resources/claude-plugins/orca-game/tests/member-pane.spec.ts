import { describe, expect, it } from 'vitest'

import { askedQuestionOf } from '../hooks/member-pane'

describe('askedQuestionOf', () => {
  it('reads a double-quoted question, escapes included', () => {
    expect(
      askedQuestionOf(
        'orca orchestration ask --from term_a --question "Merge \\"#607\\" now?" --timeout-ms 600000'
      )
    ).toBe('Merge "#607" now?')
  })

  it('reads single-quoted and bare questions from any CLI spelling', () => {
    expect(askedQuestionOf(`"$ORCA_GAME_CLI" orchestration ask --question 'Which base?'`)).toBe(
      'Which base?'
    )
    expect(askedQuestionOf('orca-dev orchestration ask --question=Rebase?')).toBe('Rebase?')
  })

  it('folds a multi-line question onto one line and caps it', () => {
    expect(askedQuestionOf('orca orchestration ask --question "a\n  b"')).toBe('a b')
    expect(askedQuestionOf(`orca orchestration ask --question "${'x'.repeat(300)}"`)).toHaveLength(
      200
    )
  })

  it('ignores other commands and an ask with no question', () => {
    expect(askedQuestionOf('orca orchestration send --type heartbeat')).toBeUndefined()
    expect(askedQuestionOf('grep -rn "orchestration ask" src')).toBeUndefined()
    expect(askedQuestionOf('orca orchestration ask --question ""')).toBeUndefined()
    expect(askedQuestionOf(undefined)).toBeUndefined()
  })
})
