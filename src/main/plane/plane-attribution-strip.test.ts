import { describe, expect, it } from 'vitest'
import { stripAiAttribution } from './plane-attribution-strip'

describe('stripAiAttribution', () => {
  it('returns non-string input unchanged', () => {
    expect(stripAiAttribution(null as unknown as string)).toBe(null)
    expect(stripAiAttribution('')).toBe('')
  })

  it('removes the real NETSA-board provenance footers', () => {
    const body =
      'Plan de trabajo.\n\n' +
      '_Planeado con Claude Code (verificación read-only del modelo append-only + canvas)._\n' +
      '_Refinado con codex (read-only)._'
    expect(stripAiAttribution(body)).toBe('Plan de trabajo.')
  })

  it('removes a standalone "Plan generado con Claude Code" line', () => {
    const body = 'Detalle.\n\n_Plan generado con Claude Code (read-only + verificación en código)._'
    expect(stripAiAttribution(body)).toBe('Detalle.')
  })

  it('removes English provenance footers (Generated/Refined with ...)', () => {
    const body = 'Body.\n\n*Generated with Claude Code.*\n*Refined with Codex.*'
    expect(stripAiAttribution(body)).toBe('Body.')
  })

  it('leaves ordinary prose that merely mentions an AI tool', () => {
    const body = 'We should test the Claude Code hook events and the Codex resume path.'
    expect(stripAiAttribution(body)).toBe(body)
  })

  it('leaves an emphasized aside that is not a provenance note', () => {
    const body = 'Fix the bug.\n\n_This is important — do not skip it._'
    expect(stripAiAttribution(body)).toBe(body)
  })

  it('leaves an emphasized line naming a tool but with no provenance verb', () => {
    const body = 'Notes.\n\n_See the Claude Code docs for details._'
    expect(stripAiAttribution(body)).toBe(body)
  })

  it('keeps surrounding content and collapses the blank gap a removal leaves', () => {
    const body = '# Title\n\nReal content here.\n\n_Planeado con Claude Code._\n\nMore content.'
    expect(stripAiAttribution(body)).toBe('# Title\n\nReal content here.\n\nMore content.')
  })

  it('returns text unchanged when there is no attribution line', () => {
    const body = '# Title\n\nJust a normal description with a list:\n\n- one\n- two'
    expect(stripAiAttribution(body)).toBe(body)
  })
})
