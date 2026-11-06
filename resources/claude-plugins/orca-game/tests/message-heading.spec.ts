import { describe, expect, it } from 'vitest'

import { MESSAGE_HEADING_WORDS } from '../hooks/message-heading-words'
import {
  headingNameOf,
  isQuestionToPerson,
  messageHeadingOf,
  toolSummaryOf
} from '../hooks/message-heading'

const EN = MESSAGE_HEADING_WORDS.en
const ES = MESSAGE_HEADING_WORDS.es

describe('message heading', () => {
  it('names the speaker, then the phase word', () => {
    expect(messageHeadingOf('Castillo', 'verify', false, ES)).toBe('Castillo · revisando')
    expect(messageHeadingOf('Castillo', 'verify', false, EN)).toBe('Castillo · reviewing')
  })

  it('a question to the person says so in place of the phase', () => {
    expect(messageHeadingOf('Castillo', 'build', true, EN)).toBe('Castillo · asks you')
    expect(messageHeadingOf('Castillo', 'build', true, ES)).toBe('Castillo · te pregunta')
  })

  it('every phase has a word in both languages', () => {
    for (const text of [EN, ES]) {
      for (const phase of ['working', 'docs', 'build', 'verify', 'pr', 'handoff'] as const) {
        expect(text.phases[phase]).toMatch(/\S/)
      }
    }
  })

  it("a member speaks as its character, a lead by its title, else the phase card's name", () => {
    expect(headingNameOf('Castillo · ORCA-1047 Game panes', 'Squire')).toBe('Castillo')
    expect(headingNameOf('Lead', 'Squire')).toBe('Lead')
    expect(headingNameOf(undefined, 'Squire')).toBe('Squire')
  })
})

describe('question to the person', () => {
  it('a block whose last line ends in a question mark is one', () => {
    expect(isQuestionToPerson('Done with the tests.\n\nShould I open the PR?')).toBe(true)
    expect(isQuestionToPerson('¿Abro el PR?  \n')).toBe(true)
    expect(isQuestionToPerson('Should I merge it? **')).toBe(true)
  })

  it('a question earlier in the block, or none, is not', () => {
    expect(isQuestionToPerson('Why did it fail? The cache was stale.')).toBe(false)
    expect(isQuestionToPerson('All green.')).toBe(false)
    expect(isQuestionToPerson('')).toBe(false)
  })
})

describe('collapsed tool summary', () => {
  const call = (tool: string) => ({ tool })

  it('counts each kind of call, in the order first seen', () => {
    const calls = [call('Read'), call('Read'), call('Bash'), call('Read'), call('Grep')]
    expect(toolSummaryOf(calls, EN)).toBe('Read 3 files, ran 1 command, searched 1 pattern')
    expect(toolSummaryOf(calls, ES)).toBe('Leyó 3 archivos, ejecutó 1 comando, buscó 1 patrón')
  })

  it('web lookups and any other tool get their own counts', () => {
    const calls = [call('WebFetch'), call('WebSearch'), call('mcp__plane__get_issue')]
    expect(toolSummaryOf(calls, EN)).toBe('Looked up 2 pages, used 1 tool')
  })

  it('no calls draw no line', () => {
    expect(toolSummaryOf([], EN)).toBe('')
  })
})
