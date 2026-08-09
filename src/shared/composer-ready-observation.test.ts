import { describe, expect, it } from 'vitest'
import {
  createComposerReadyObservation,
  isProvableComposerReadySignal
} from './composer-ready-observation'

const BRACKETED_PASTE_ON = '\x1b[?2004h'
const BRACKETED_PASTE_OFF = '\x1b[?2004l'
const SHOW_CURSOR = '\x1b[?25h'

describe('createComposerReadyObservation (ORCA-191)', () => {
  describe('codex-composer-prompt', () => {
    it('starts unobserved: no bracketed paste is no evidence either way', () => {
      const observation = createComposerReadyObservation('codex-composer-prompt')
      observation.observe('booting codex\r\n')
      expect(observation.state()).toBe('unobserved')
      expect(observation.readyAt()).toBeNull()
    })

    it('reports awaiting-composer between bracketed paste and the prompt glyph', () => {
      const observation = createComposerReadyObservation('codex-composer-prompt')
      observation.observe(`${BRACKETED_PASTE_ON}\x1b[2J\x1b[H  Starting`)
      // Why: this is the exact window ORCA-171 measured tui-idle satisfying in.
      expect(observation.state()).toBe('awaiting-composer')
    })

    it('latches ready when the prompt glyph renders after bracketed paste', () => {
      let clock = 1_000
      const observation = createComposerReadyObservation('codex-composer-prompt', () => clock)
      observation.observe(BRACKETED_PASTE_ON)
      clock = 8_211
      observation.observe('\r\n› ')
      expect(observation.state()).toBe('ready')
      expect(observation.readyAt()).toBe(8_211)
      expect(observation.settled()).toBe(true)
    })

    it('ignores a prompt glyph that rendered before bracketed paste', () => {
      const observation = createComposerReadyObservation('codex-composer-prompt')
      observation.observe('› leftover from the previous program')
      expect(observation.state()).toBe('unobserved')
      observation.observe(BRACKETED_PASTE_ON)
      expect(observation.state()).toBe('awaiting-composer')
    })

    it('stays ready and stops advancing once latched', () => {
      let clock = 100
      const observation = createComposerReadyObservation('codex-composer-prompt', () => clock)
      observation.observe(`${BRACKETED_PASTE_ON}›`)
      expect(observation.readyAt()).toBe(100)
      clock = 9_999
      observation.observe('›')
      expect(observation.readyAt()).toBe(100)
      expect(observation.state()).toBe('ready')
    })

    // Why: the shell enables bracketed paste for its own prompt, so a latch
    // reads every shell pane as mid-boot. Only the live toggle separates a
    // booting agent from a shell that already handed the pane to a child.
    it('drops back to unobserved when the pane gives the handshake back', () => {
      const observation = createComposerReadyObservation('codex-composer-prompt')
      observation.observe(BRACKETED_PASTE_ON)
      expect(observation.state()).toBe('awaiting-composer')
      observation.observe(`codex\r\n${BRACKETED_PASTE_OFF}`)
      expect(observation.state()).toBe('unobserved')
      // The agent's own handshake, ~120 ms later (measured 2026-08-09).
      observation.observe(BRACKETED_PASTE_ON)
      expect(observation.state()).toBe('awaiting-composer')
    })

    it('takes the last toggle when one chunk carries both', () => {
      const observation = createComposerReadyObservation('codex-composer-prompt')
      observation.observe(`${BRACKETED_PASTE_OFF}boot${BRACKETED_PASTE_ON}`)
      expect(observation.state()).toBe('awaiting-composer')
      observation.observe(`${BRACKETED_PASTE_ON}redraw${BRACKETED_PASTE_OFF}`)
      expect(observation.state()).toBe('unobserved')
    })

    it('sees a disable split across chunk boundaries', () => {
      const observation = createComposerReadyObservation('codex-composer-prompt')
      observation.observe(BRACKETED_PASTE_ON)
      observation.observe('\x1b[?2004')
      observation.observe('l')
      expect(observation.state()).toBe('unobserved')
    })

    it('stays ready once latched even after the handshake goes back', () => {
      const observation = createComposerReadyObservation('codex-composer-prompt')
      observation.observe(`${BRACKETED_PASTE_ON}› `)
      observation.observe(BRACKETED_PASTE_OFF)
      expect(observation.state()).toBe('ready')
    })

    it('sees a marker split across chunk boundaries', () => {
      const observation = createComposerReadyObservation('codex-composer-prompt')
      observation.observe('\x1b[?2004')
      observation.observe('h')
      expect(observation.state()).toBe('awaiting-composer')
      observation.observe('›')
      expect(observation.state()).toBe('ready')
    })
  })

  describe('render-cursor-after-bracketed-paste', () => {
    it('needs the show-cursor after bracketed paste, not before', () => {
      const observation = createComposerReadyObservation('render-cursor-after-bracketed-paste')
      observation.observe(SHOW_CURSOR)
      expect(observation.state()).toBe('unobserved')
      observation.observe(BRACKETED_PASTE_ON)
      expect(observation.state()).toBe('awaiting-composer')
      observation.observe(SHOW_CURSOR)
      expect(observation.state()).toBe('ready')
    })

    it('is not satisfied by codex’s prompt glyph', () => {
      const observation = createComposerReadyObservation('render-cursor-after-bracketed-paste')
      observation.observe(`${BRACKETED_PASTE_ON}› `)
      expect(observation.state()).toBe('awaiting-composer')
    })
  })

  describe('render-quiet-after-bracketed-paste', () => {
    it('never reaches ready: a quiet window is a timer, not evidence', () => {
      const observation = createComposerReadyObservation('render-quiet-after-bracketed-paste')
      observation.observe(`${BRACKETED_PASTE_ON}› ${SHOW_CURSOR}`)
      expect(observation.state()).toBe('awaiting-composer')
      expect(observation.settled()).toBe(false)
    })
  })
})

describe('isProvableComposerReadySignal', () => {
  it('accepts only the two marker-backed signals', () => {
    expect(isProvableComposerReadySignal('codex-composer-prompt')).toBe(true)
    expect(isProvableComposerReadySignal('render-cursor-after-bracketed-paste')).toBe(true)
    expect(isProvableComposerReadySignal('render-quiet-after-bracketed-paste')).toBe(false)
    expect(isProvableComposerReadySignal(undefined)).toBe(false)
  })
})
